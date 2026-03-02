"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Library, Menu, PanelRight, MessageSquarePlus, RefreshCcw, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRuntimeWorkspace } from "@/hooks/use-runtime-workspace";
import { LibraryCollection, ProcessFeedItem, SessionPreferences } from "@/types/chat";
import {
  applyRuntimeDocumentEdit,
  exportRuntimeDocument,
  fetchRuntimeUploadCapabilities,
  fetchRuntimeEvidence,
  fetchRuntimeLatestLedger,
  proposeRuntimeDocumentEdit,
  RuntimeEvidenceRefDto,
  RuntimeLedgerDto,
  RuntimeWorkspaceDocumentDto,
  uploadRuntimeDocuments,
} from "@/lib/runtime-api";
import { ChatComposer } from "./chat-composer";
import { ChatThread } from "./chat-thread";
import { CommandPalette } from "./command-palette";
import { DocumentWorkspacePanel } from "./document-workspace-panel";
import { LiveActivityPanel } from "./live-activity-panel";
import { LibraryDrawer } from "@/components/library/library-drawer";
import type { UploadedDocumentChip } from "@/types/chat";

const steerSystemPrompts: Record<
  string,
  {
    pref?: [keyof SessionPreferences, SessionPreferences[keyof SessionPreferences]];
    sourceScopePatch?: Partial<SessionPreferences["sourceScope"]>;
    composerText?: string;
    steerPrompt?: string;
  }
> = {
  "Run V3 finder": {
    composerText: '/competitors.discover_v3 {"mode":"standard","maxCandidates":140,"maxEnrich":10}',
    steerPrompt: "Run a standard V3 competitor finder pass and summarize direct plus adjacent competitors.",
  },
  "Go deeper": {
    pref: ["tone", "detailed"],
    composerText: '/competitors.discover_v3 {"mode":"deep","maxCandidates":200,"maxEnrich":20}',
    steerPrompt: "Go deeper with lane-by-lane recommendations and concrete competitor examples.",
  },
  "Show sources": { pref: ["transparency", true], composerText: "/show_sources" },
  "Make it a PDF": { composerText: "/generate_pdf" },
  "Focus on TikTok": {
    sourceScopePatch: {
      socialIntel: true,
      webSearch: false,
      liveWebsiteCrawl: false,
    },
    composerText: "Prioritize TikTok and social evidence in the next response.",
    steerPrompt: "Prioritize TikTok and social evidence in this run.",
  },
  "Focus on Web evidence": {
    sourceScopePatch: {
      socialIntel: false,
      webSearch: true,
      liveWebsiteCrawl: true,
    },
    composerText: "Prioritize web evidence and cite page URLs first.",
    steerPrompt: "Prioritize web evidence and cite page URLs first.",
  },
  "Ask me questions first": { pref: ["askQuestionsFirst", true] },
};

function formatThreadTime(iso?: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatPhaseLabel(phase?: string | null): string {
  const normalized = String(phase || "").trim().toLowerCase();
  if (!normalized) return "Running";
  if (normalized === "waiting_input") return "Waiting input";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function mapParserStatusToUploadChipStatus(
  status: string | null | undefined
): UploadedDocumentChip["status"] {
  if (status === "READY") return "ready";
  if (status === "NEEDS_REVIEW") return "needs_review";
  if (status === "FAILED") return "failed";
  return "parsing";
}

export function ChatOsRuntimeLayout({ workspaceId }: { workspaceId: string }) {
  const [rightRailMode, setRightRailMode] = useState<"activity" | "docs">(() => {
    if (typeof window === "undefined") return "activity";
    const stored = window.localStorage.getItem(`bat.runtime.rightRailMode.${workspaceId}`);
    return stored === "docs" ? "docs" : "activity";
  });
  const [rightRailCollapsed, setRightRailCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`bat.runtime.rightRailCollapsed.${workspaceId}`) === "1";
  });
  const [selectedRuntimeDocumentId, setSelectedRuntimeDocumentId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [activeLibraryCollection, setActiveLibraryCollection] = useState<LibraryCollection | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [composerDraft, setComposerDraft] = useState("");
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const [evidenceDrawerLoading, setEvidenceDrawerLoading] = useState(false);
  const [evidenceDrawerError, setEvidenceDrawerError] = useState<string | null>(null);
  const [evidenceRows, setEvidenceRows] = useState<RuntimeEvidenceRefDto[]>([]);
  const [evidenceLedger, setEvidenceLedger] = useState<RuntimeLedgerDto | null>(null);
  const [evidenceMessageId, setEvidenceMessageId] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<
    | { mode: "thread"; title: string }
    | { mode: "branch"; title: string; forkedFromMessageId?: string }
    | null
  >(null);
  const [nameInput, setNameInput] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [uploadCapabilities, setUploadCapabilities] = useState<{
    maxFiles: number;
    maxFileSizeBytes: number;
    acceptedExtensions: string[];
    acceptedMimePrefixes: string[];
    imageUploadsEnabled: boolean;
  } | null>(null);
  const seenGeneratedDocumentIdsRef = useRef<Set<string>>(new Set());
  const generatedDocumentsSeededRef = useRef(false);
  const pendingGeneratedDocumentIdRef = useRef<string | null>(null);
  const router = useRouter();

  const {
    loading,
    syncing,
    error,
    threads,
    activeThreadId,
    activeBranchId,
    branches,
    messages,
    processRuns,
    feedItems,
    decisions,
    queuedMessages,
    isStreaming,
    libraryItems,
    runtimeDocuments,
    preferences,
    setActiveThreadId,
    createThread,
    createBranch,
    pinBranch,
    sendMessage,
    interruptRun,
    reorderQueue,
    removeQueued,
    steerQueued,
    resolveDecision,
    steerRun,
    setPreference,
    refreshRuntimeDocuments,
    refreshNow,
  } = useRuntimeWorkspace(workspaceId);

  const visibleFeed = useMemo(() => feedItems.slice(0, 8), [feedItems]);
  const branchNeedsDecision = processRuns.some((run) => run.status === "waiting_input");
  const activeRun =
    processRuns.find((run) => run.status === "running" || run.status === "waiting_input") ||
    processRuns[0] ||
    null;
  const streamingInsight = activeRun
    ? `${activeRun.label} • ${formatPhaseLabel(activeRun.phase)} • ${activeRun.stage}`
    : visibleFeed[0]?.message || "";

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || threads[0] || null,
    [threads, activeThreadId]
  );

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) || branches[0] || null,
    [branches, activeBranchId]
  );

  const filteredThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => thread.title.toLowerCase().includes(query));
  }, [threadSearch, threads]);

  const quickLibraryItems = useMemo(
    () =>
      libraryItems
        .filter((item) => item.collection === "deliverables" || item.collection === "web" || item.collection === "social")
        .slice(0, 6),
    [libraryItems]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!(sidebarOpen || activityOpen)) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [sidebarOpen, activityOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `bat.runtime.rightRailCollapsed.${workspaceId}`;
    window.localStorage.setItem(storageKey, rightRailCollapsed ? "1" : "0");
  }, [rightRailCollapsed, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    if (!activeBranchId) return;
    void fetchRuntimeUploadCapabilities(workspaceId, activeBranchId)
      .then((payload) => {
        if (cancelled) return;
        if (!payload?.ok) return;
        setUploadCapabilities(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setUploadCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, activeBranchId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `bat.runtime.rightRailMode.${workspaceId}`;
    window.localStorage.setItem(storageKey, rightRailMode);
  }, [rightRailMode, workspaceId]);

  const resolvedSelectedRuntimeDocumentId = useMemo(() => {
    if (!runtimeDocuments.length) return null;
    if (selectedRuntimeDocumentId && runtimeDocuments.some((document) => document.id === selectedRuntimeDocumentId)) {
      return selectedRuntimeDocumentId;
    }
    return runtimeDocuments[0].id;
  }, [runtimeDocuments, selectedRuntimeDocumentId]);

  const hasDocsContext = runtimeDocuments.length > 0;
  const resolvedRightRailMode: "activity" | "docs" =
    rightRailMode === "docs" && !hasDocsContext ? "activity" : rightRailMode;
  const generatedDocumentIds = useMemo(
    () =>
      feedItems
        .map((item) =>
          item.toolName === "document.generate" && item.actionTarget?.kind === "document"
            ? String(item.actionTarget.documentId || "").trim()
            : ""
        )
        .filter(Boolean),
    [feedItems]
  );

  useEffect(() => {
    if (!generatedDocumentsSeededRef.current) {
      for (const documentId of generatedDocumentIds) {
        seenGeneratedDocumentIdsRef.current.add(documentId);
      }
      generatedDocumentsSeededRef.current = true;
      return;
    }

    for (const documentId of generatedDocumentIds) {
      if (seenGeneratedDocumentIdsRef.current.has(documentId)) continue;
      seenGeneratedDocumentIdsRef.current.add(documentId);
      pendingGeneratedDocumentIdRef.current = documentId;
      break;
    }

    const pendingDocumentId = pendingGeneratedDocumentIdRef.current;
    if (!pendingDocumentId || !hasDocsContext) return;

    pendingGeneratedDocumentIdRef.current = null;
    setSelectedRuntimeDocumentId(pendingDocumentId);
    setRightRailMode("docs");
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setActivityOpen(true);
      return;
    }
    setRightRailCollapsed(false);
  }, [generatedDocumentIds, hasDocsContext]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
      if (window.innerWidth >= 1280) {
        setActivityOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const runAsync = (work: Promise<void>) => {
    setActionError(null);
    void work.catch((workError) => {
      setActionError(String((workError as Error)?.message || "Action failed"));
    });
  };

  const onSend = (
    content: string,
    mode: "send" | "queue" | "interrupt",
    options?: { attachmentIds?: string[]; documentIds?: string[] }
  ) => {
    runAsync(sendMessage(content, mode, options));
  };

  const runPriorityCommand = (command: string, options?: { attachmentIds?: string[]; documentIds?: string[] }) => {
    const next = command.trim();
    if (!next) return;
    runAsync(sendMessage(next, "interrupt", options));
  };

  const onUploadDocuments = async (files: File[]) => {
    if (!activeBranchId) {
      throw new Error("Open a branch before uploading documents.");
    }
    setActionError(null);
    try {
      const payload = await uploadRuntimeDocuments(workspaceId, activeBranchId, { files });
      const docs = Array.isArray(payload.documents) ? payload.documents : [];
      await refreshNow();
      setActionError(null);
      return docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        fileName: doc.originalFileName || doc.title,
        status: mapParserStatusToUploadChipStatus(doc.parserStatus),
        qualityScore: doc.parserQualityScore ?? null,
        warnings: doc.warnings,
        attachmentId: doc.attachmentId,
      }));
    } catch (error) {
      const code =
        typeof (error as { code?: unknown })?.code === "string"
          ? String((error as { code?: unknown }).code)
          : "";
      let message = String((error as Error)?.message || "Upload failed");
      if (code === "UPLOAD_UNSUPPORTED_TYPE") {
        message =
          "Unsupported file type. Upload PDF, DOCX, XLSX, CSV, TXT, MD, HTML, PPTX, PNG, JPG, WEBP, or GIF.";
      } else if (code === "UPLOAD_TOO_LARGE") {
        message = "One of the selected files is larger than the 25MB limit.";
      } else if (code === "UPLOAD_NO_FILES") {
        message = "No files were selected.";
      } else if (code === "UPLOAD_BRANCH_NOT_READY") {
        message = "Open or select a branch before uploading files.";
      }
      const nextError = new Error(message) as Error & { code?: string };
      if (code) {
        nextError.code = code;
      }
      throw nextError;
    }
  };

  const uploadAccept =
    uploadCapabilities?.acceptedExtensions?.length
      ? uploadCapabilities.acceptedExtensions.join(",")
      : ".pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.html,.htm,.pptx,.png,.jpg,.jpeg,.webp,.gif";

  const injectComposerText = (value: string, mode: "replace" | "append" = "append") => {
    const next = value.trim();
    if (!next) return;
    setComposerDraft((current) => {
      if (mode === "replace" || !current.trim()) {
        return next;
      }
      const separator = current.endsWith("\n") ? "" : "\n";
      return `${current}${separator}${next}`;
    });
    setComposerFocusSignal((previous) => previous + 1);
  };

  const onSteer = (chip: string) => {
    const mapping = steerSystemPrompts[chip];
    if (!mapping) return;

    if (mapping.pref) {
      const [key, value] = mapping.pref;
      if (key === "tone" && (value === "balanced" || value === "detailed" || value === "concise")) {
        setPreference("tone", value);
      }
      if (key === "transparency" && typeof value === "boolean") {
        setPreference("transparency", value);
      }
      if (key === "askQuestionsFirst" && typeof value === "boolean") {
        setPreference("askQuestionsFirst", value);
      }
    }

    if (mapping.sourceScopePatch) {
      setPreference("sourceScope", {
        ...preferences.sourceScope,
        ...mapping.sourceScopePatch,
      });
    }

    if (isStreaming && mapping.steerPrompt) {
      runAsync(steerRun(mapping.steerPrompt));
      return;
    }

    if (mapping.composerText) {
      injectComposerText(mapping.composerText, "replace");
    }
  };

  const onUseLibraryItem = (item: { id: string; libraryRef?: string; title: string }) => {
    const ref = String(item.libraryRef || item.id || "").trim();
    if (!ref) return;
    injectComposerText(`@libraryRef[${ref}|${item.title}]`, "append");
    setLibraryOpen(false);
  };

  const openRightRailMode = (mode: "activity" | "docs") => {
    setRightRailMode(mode);
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setActivityOpen(true);
      return;
    }
    setRightRailCollapsed(false);
  };

  const toggleRightRailMode = (mode: "activity" | "docs") => {
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      if (activityOpen && rightRailMode === mode) {
        setActivityOpen(false);
        return;
      }
      setRightRailMode(mode);
      setActivityOpen(true);
      return;
    }
    if (!rightRailCollapsed && rightRailMode === mode) {
      setRightRailCollapsed(true);
      return;
    }
    setRightRailMode(mode);
    setRightRailCollapsed(false);
  };

  const openDocsRail = (documentId?: string) => {
    if (!hasDocsContext) {
      setRightRailMode("activity");
      setActiveLibraryCollection("deliverables");
      setLibraryOpen(true);
      return;
    }
    if (documentId) {
      setSelectedRuntimeDocumentId(documentId);
    }
    openRightRailMode("docs");
  };

  const onQuoteDocumentInChat = (input: { document: RuntimeWorkspaceDocumentDto; quotedText: string }) => {
    const quoteLines = input.quotedText
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join("\n");
    if (!quoteLines) return;
    const sourceTitle = input.document.title || input.document.originalFileName || "Document";
    const versionLabel =
      typeof input.document.latestVersion?.versionNumber === "number" && input.document.latestVersion.versionNumber > 0
        ? `v${input.document.latestVersion.versionNumber}`
        : "latest";
    injectComposerText(
      `${quoteLines}\n\nSource: ${sourceTitle} (${versionLabel})`,
      "append"
    );
  };

  const onFeedItemAction = (item: ProcessFeedItem) => {
    if (item.actionTarget?.kind === "document") {
      openDocsRail(item.actionTarget.documentId);
      return;
    }
  };

  const resolvePayloadDocumentId = (payload?: Record<string, unknown>): string =>
    String(payload?.documentId || payload?.docId || "").trim();

  const resolveDocumentHrefFromPayload = (payload?: Record<string, unknown>): string | null => {
    if (!payload) return null;
    const fields = ["downloadHref", "storageHref", "href", "storagePath"] as const;
    for (const field of fields) {
      const value = String(payload[field] || "").trim();
      if (!value) continue;
      if (value.startsWith("/storage/")) return value;
      if (value.startsWith("storage/")) return `/${value}`;
      if (value.startsWith("./storage/")) return `/${value.slice(2)}`;
      return value;
    }
    return null;
  };

  const onRunMessageAction = (
    _actionLabel: string,
    actionKey: string,
    payload?: Record<string, unknown>
  ) => {
    const action = actionKey.trim().toLowerCase();
    if (action === "open_library") {
      const requestedCollection = String(payload?.collection || "").trim().toLowerCase();
      if (
        requestedCollection === "web" ||
        requestedCollection === "competitors" ||
        requestedCollection === "social" ||
        requestedCollection === "community" ||
        requestedCollection === "news" ||
        requestedCollection === "deliverables"
      ) {
        setActiveLibraryCollection(requestedCollection as LibraryCollection);
      } else {
        setActiveLibraryCollection("all");
      }
      setLibraryOpen(true);
      setActionError(null);
      return;
    }

    if (action === "fork_branch") {
      onForkBranch();
      setActionError(null);
      return;
    }

    if (action === "document.open" || action === "document.download") {
      const href = resolveDocumentHrefFromPayload(payload);
      const payloadDocId = resolvePayloadDocumentId(payload);
      if (payloadDocId) {
        setSelectedRuntimeDocumentId(payloadDocId);
      }
      if (href) {
        if (typeof window !== "undefined") {
          window.open(href, "_blank", "noopener,noreferrer");
        }
      } else {
        setActiveLibraryCollection("deliverables");
        setLibraryOpen(true);
      }
      setActionError(null);
      return;
    }

    if (action === "document.generate") {
      setActionError(null);
      const payloadText = payload ? ` ${JSON.stringify(payload)}` : "";
      runPriorityCommand(`/document.generate${payloadText}`);
      return;
    }

    if (action === "document.read" || action === "document.propose_edit" || action === "document.apply_edit" || action === "document.export") {
      if (!activeBranchId) {
        setActionError("Open a branch first to run this document action.");
        return;
      }
      const documentId = resolvePayloadDocumentId(payload);
      if (!documentId) {
        setActionError("Document action is missing documentId.");
        return;
      }
      setSelectedRuntimeDocumentId(documentId);
      if (action === "document.propose_edit") {
        const instruction = String(payload?.instruction || "").trim();
        if (!instruction) {
          injectComposerText("Propose an edit for the selected document: ", "replace");
          setActionError(null);
          return;
        }
        runAsync(
          proposeRuntimeDocumentEdit(workspaceId, activeBranchId, documentId, { instruction }).then(async () => {
            await Promise.all([refreshNow(), refreshRuntimeDocuments()]);
          })
        );
        return;
      }
      if (action === "document.apply_edit") {
        const proposedContentMd = String(payload?.proposedContentMd || "");
        if (!proposedContentMd.trim()) {
          setActionError("Apply edit is missing proposed content.");
          return;
        }
        runAsync(
          applyRuntimeDocumentEdit(workspaceId, activeBranchId, documentId, {
            proposedContentMd,
            ...(typeof payload?.changeSummary === "string" && payload.changeSummary.trim()
              ? { changeSummary: payload.changeSummary.trim() }
              : {}),
            ...(typeof payload?.baseVersionId === "string" && payload.baseVersionId.trim()
              ? { baseVersionId: payload.baseVersionId.trim() }
              : {}),
          }).then(async () => {
            await Promise.all([refreshNow(), refreshRuntimeDocuments()]);
          })
        );
        return;
      }
      if (action === "document.export") {
        const formatRaw = String(payload?.format || "PDF").trim().toUpperCase();
        const format = formatRaw === "DOCX" || formatRaw === "MD" ? formatRaw : "PDF";
        runAsync(
          exportRuntimeDocument(workspaceId, activeBranchId, documentId, {
            format,
            ...(typeof payload?.versionId === "string" && payload.versionId.trim()
              ? { versionId: payload.versionId.trim() }
              : {}),
          }).then(async () => {
            await Promise.all([refreshNow(), refreshRuntimeDocuments()]);
          })
        );
        return;
      }
      if (action === "document.read") {
        openDocsRail(documentId);
        setActionError(null);
        return;
      }
    }

    const normalizedCommand =
      action === "show_sources"
        ? "show_sources"
        : action === "generate_pdf"
          ? "generate_pdf"
          : action.replace(/[^a-z0-9_./-]+/g, "_");
    const payloadText = payload ? ` ${JSON.stringify(payload)}` : "";
    const command = `/${normalizedCommand}${payloadText}`;
    if (normalizedCommand === "generate_pdf" || normalizedCommand.startsWith("document.")) {
      runPriorityCommand(command);
    } else {
      injectComposerText(command, "append");
    }
    setActionError(null);
  };

  const onOpenEvidence = (messageId: string) => {
    if (!activeBranchId) return;
    const message = messages.find((entry) => entry.id === messageId) || null;
    const runId = message?.reasoning?.runId;

    setEvidenceMessageId(messageId);
    setEvidenceDrawerOpen(true);
    setEvidenceDrawerLoading(true);
    setEvidenceDrawerError(null);

    void Promise.all([
      fetchRuntimeEvidence(workspaceId, activeBranchId, {
        ...(runId ? { runId } : {}),
        limit: 120,
      }),
      fetchRuntimeLatestLedger(workspaceId, activeBranchId, runId ? { runId } : undefined),
    ])
      .then(([evidencePayload, ledgerPayload]) => {
        setEvidenceRows(Array.isArray(evidencePayload.evidence) ? evidencePayload.evidence : []);
        setEvidenceLedger(ledgerPayload.ledger || null);
      })
      .catch((error) => {
        setEvidenceRows([]);
        setEvidenceLedger(null);
        setEvidenceDrawerError(String((error as Error)?.message || "Failed to load evidence."));
      })
      .finally(() => {
        setEvidenceDrawerLoading(false);
      });
  };

  const onNewThread = () => {
    setNameDialog({ mode: "thread", title: "Create new chat" });
    setNameInput("New strategy chat");
  };

  const onForkBranch = (forkedFromMessageId?: string) => {
    setNameDialog({ mode: "branch", title: "Create branch", forkedFromMessageId });
    setNameInput(`What-if ${new Date().toLocaleTimeString()}`);
  };

  const submitNameDialog = () => {
    if (!nameDialog) return;
    const value = nameInput.trim();
    if (!value) return;
    if (nameDialog.mode === "thread") {
      runAsync(createThread(value));
    } else {
      runAsync(createBranch(value, nameDialog.forkedFromMessageId));
    }
    setNameDialog(null);
    setNameInput("");
  };

  const onCommand = (command: string) => {
    if (command === "Run V3 competitor finder (standard)") {
      injectComposerText('/competitors.discover_v3 {"mode":"standard","maxCandidates":140,"maxEnrich":10}', "replace");
      return;
    }
    if (command === "Run V3 competitor finder (deep)") {
      injectComposerText('/competitors.discover_v3 {"mode":"deep","maxCandidates":220,"maxEnrich":20}', "replace");
      return;
    }
    if (command === "Run competitor discovery (legacy)") {
      injectComposerText("/orchestration.run", "replace");
      return;
    }
    if (command === "Generate PDF deliverable") {
      injectComposerText("/generate_pdf", "replace");
      return;
    }
    if (command === "Show sources") {
      injectComposerText("/show_sources", "replace");
      return;
    }
    if (command === "Search web evidence") {
      injectComposerText('/search.web {"query":"", "count":10, "provider":"auto"}', "replace");
      return;
    }
    if (command === "Open library: Web") {
      setLibraryOpen(true);
      setActiveLibraryCollection("web");
      return;
    }
    if (command === "Open library: Competitors") {
      setLibraryOpen(true);
      setActiveLibraryCollection("competitors");
      return;
    }
    if (command === "Switch workspace") {
      router.push("/app");
      return;
    }

    if (command === "Add constraint") {
      injectComposerText("Add this new constraint to my workspace context: ", "replace");
      return;
    }

    injectComposerText(command, "replace");
  };

  const onRunAudit = () => {
    runAsync(
      sendMessage(
        "Run a full workspace intelligence audit now. Use tools across web snapshots/sources, competitors, social evidence, community insights, and news, then summarize findings with next actions.",
        "send"
      )
    );
  };

  if (loading) {
    return (
      <section className="bat-surface p-6">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Initializing workspace runtime...
        </p>
      </section>
    );
  }

  return (
    <>
      {error || actionError ? (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{error || actionError}</p>
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-3xl border border-zinc-200 bg-[#f3f4f6] shadow-2xl">
        <div className="grid h-[86dvh] min-h-[32rem] w-full grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]">
          <aside
            className={`${
              sidebarOpen ? "absolute inset-y-0 left-0 z-30 flex w-11/12 max-w-sm" : "hidden"
            } min-h-0 flex-col border-r border-zinc-800/70 bg-[#171717] text-zinc-200 lg:static lg:z-auto lg:flex lg:w-auto`}
          >
            <div className="border-b border-zinc-800 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Chats</p>
                <button
                  type="button"
                  onClick={onNewThread}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-800"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  New
                </button>
              </div>
              <label className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                <Search className="h-3.5 w-3.5" />
                <input
                  value={threadSearch}
                  onChange={(event) => setThreadSearch(event.target.value)}
                  placeholder="Search chats"
                  className="w-full border-none bg-transparent text-sm text-zinc-100 outline-none"
                />
              </label>
            </div>

            <div className="bat-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
              {filteredThreads.map((thread) => {
                const active = thread.id === activeThreadId;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => {
                      setComposerDraft("");
                      setActiveThreadId(thread.id);
                      setSidebarOpen(false);
                    }}
                    className={`w-full rounded-xl px-3 py-2 text-left transition ${
                      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/70"
                    }`}
                  >
                    <p className="truncate text-sm font-medium">{thread.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Updated {formatThreadTime(thread.updatedAt) || "recently"}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="bat-scrollbar max-h-[38%] shrink-0 space-y-3 overflow-y-auto border-t border-zinc-800 px-3 py-3">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.08em] text-zinc-400">Branches</p>
                  <button
                    type="button"
                    onClick={() => onForkBranch()}
                    className="rounded-full border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
                  >
                    New
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((branch) => {
                    const active = branch.id === activeBranchId;
                    return (
                      <button
                        key={branch.id}
                        type="button"
                        onClick={() => {
                          setComposerDraft("");
                          runAsync(pinBranch(branch.id));
                        }}
                        className={`rounded-full border px-2.5 py-1 text-xs ${
                          active
                            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                            : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        {branch.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                  onClick={() => runAsync(refreshNow())}
                >
                  <span className="inline-flex items-center gap-1">
                    <RefreshCcw className="h-3.5 w-3.5" /> Refresh
                  </span>
                </button>
                <CommandPalette onSelect={onCommand} />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveLibraryCollection("all");
                    setLibraryOpen(true);
                  }}
                  className="mb-2 inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  <Library className="h-3.5 w-3.5" />
                  Open library
                </button>
                <div className="space-y-1.5">
                  {quickLibraryItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onUseLibraryItem(item)}
                      className="w-full rounded-lg border border-zinc-700/80 px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      <p className="line-clamp-1 font-medium text-zinc-200">{item.title}</p>
                      <p className="line-clamp-2 text-zinc-400">{item.summary}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="relative flex min-h-0 flex-col overflow-hidden bg-white">
            <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-5 py-3 sm:px-8 xl:px-10">
              <div className="min-w-0">
                <div className="mb-0.5 flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 lg:hidden"
                    onClick={() => setSidebarOpen((prev) => !prev)}
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                  <h1 className="truncate text-sm font-semibold text-zinc-900">{activeThread?.title || "New chat"}</h1>
                </div>
                <p className="text-xs text-zinc-500">
                  {syncing ? "Syncing..." : activeBranch ? `Branch: ${activeBranch.name}` : "Main branch"}
                  {" • "}
                  {isStreaming ? formatPhaseLabel(activeRun?.phase) : "Idle"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onRunAudit}
                  className="hidden rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 md:inline-flex"
                >
                  Audit
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  <Library className="h-3.5 w-3.5" />
                  Library
                </button>
                <button
                  type="button"
                  onClick={() => toggleRightRailMode("activity")}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 xl:hidden"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                  Activity
                </button>
                {hasDocsContext ? (
                  <button
                    type="button"
                    onClick={() => toggleRightRailMode("docs")}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 xl:hidden"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Docs
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => toggleRightRailMode("activity")}
                  className="hidden items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 xl:inline-flex"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                  {rightRailCollapsed ? "Activity" : resolvedRightRailMode === "activity" ? "Hide activity" : "Activity"}
                </button>
                {hasDocsContext ? (
                  <button
                    type="button"
                    onClick={() => toggleRightRailMode("docs")}
                    className="hidden items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 xl:inline-flex"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {rightRailCollapsed ? "Docs" : resolvedRightRailMode === "docs" ? "Hide docs" : "Docs"}
                  </button>
                ) : null}
                {queuedMessages.length > 0 ? (
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600">
                    Queue {queuedMessages.length}
                  </span>
                ) : null}
                {branchNeedsDecision ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                    Needs approval
                  </span>
                ) : null}
                {preferences.askQuestionsFirst ? (
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600">
                    Question first
                  </span>
                ) : null}
              </div>
            </header>

            <div
              className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${
                rightRailCollapsed
                  ? "xl:grid-cols-1"
                  : "xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]"
              }`}
            >
              <div className="flex min-h-0 flex-col border-zinc-200 xl:border-r">
                <ChatThread
                  messages={messages}
                  onForkFromMessage={onForkBranch}
                  onOpenEvidence={onOpenEvidence}
                  onResolveDecision={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
                  onRunAction={onRunMessageAction}
                  onStarterAction={(action) => {
                    if (action === "audit") {
                      injectComposerText("/audit", "replace");
                      return;
                    }
                    if (action === "sources") {
                      injectComposerText("/show_sources", "replace");
                      return;
                    }
                    if (action === "deliverable") {
                      injectComposerText("/generate_pdf", "replace");
                      return;
                    }
                    injectComposerText('/competitors.discover_v3 {"mode":"standard","maxCandidates":140,"maxEnrich":10}', "replace");
                  }}
                  showInlineReasoning={false}
                  isStreaming={isStreaming}
                  streamingInsight={streamingInsight}
                  contentWidthClassName="max-w-none"
                />

                {!activeBranchId ? (
                  <div className="mx-5 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:mx-8 xl:mx-10">
                    Open/select a branch to attach files.
                  </div>
                ) : null}

                <ChatComposer
                  draft={composerDraft}
                  onDraftChange={setComposerDraft}
                  focusSignal={composerFocusSignal}
                  isStreaming={isStreaming}
                  responseMode={preferences.responseMode}
                  sourceScope={preferences.sourceScope}
                  onResponseModeChange={(mode) => setPreference("responseMode", mode)}
                  onSourceScopeChange={(key, value) =>
                    setPreference("sourceScope", {
                      ...preferences.sourceScope,
                      [key]: value,
                    })
                  }
                  queuedMessages={queuedMessages}
                  onSend={onSend}
                  onUploadDocuments={onUploadDocuments}
                  onUploadError={(message) => setActionError(message)}
                  canAttach={Boolean(activeBranchId)}
                  attachDisabledReason={activeBranchId ? undefined : "Open/select a branch to attach files."}
                  uploadAccept={uploadAccept}
                  onSteerRun={(note) => runAsync(steerRun(note))}
                  onSteerQueued={(id, input) => runAsync(steerQueued(id, input))}
                  onStop={() => runAsync(interruptRun())}
                  onReorderQueue={(from, to) => runAsync(reorderQueue(from, to))}
                  onDeleteQueued={(id) => runAsync(removeQueued(id))}
                  onSteer={onSteer}
                  contentWidthClassName="max-w-none"
                />
              </div>

              {!rightRailCollapsed ? (
                <div className="hidden min-h-0 border-l border-zinc-200 bg-[#f8fafc] xl:flex xl:flex-col">
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {resolvedRightRailMode === "activity" ? (
                      <LiveActivityPanel
                        runs={processRuns}
                        feedItems={feedItems}
                        decisions={decisions}
                        onResolve={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
                        onRunAudit={onRunAudit}
                        onSteer={(instruction) => runAsync(steerRun(instruction))}
                        onFeedItemAction={onFeedItemAction}
                      />
                    ) : (
                      <DocumentWorkspacePanel
                        workspaceId={workspaceId}
                        branchId={activeBranchId}
                        documents={runtimeDocuments}
                        selectedDocumentId={resolvedSelectedRuntimeDocumentId}
                        onSelectDocument={setSelectedRuntimeDocumentId}
                        onQuoteInChat={onQuoteDocumentInChat}
                        onRefreshDocuments={refreshRuntimeDocuments}
                        onRefreshRuntime={refreshNow}
                      />
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {rightRailCollapsed ? (
          <button
            type="button"
            onClick={() => openRightRailMode(resolvedRightRailMode)}
            className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 shadow-sm hover:bg-zinc-100 xl:inline-flex"
          >
            <PanelRight className="mr-1 h-3.5 w-3.5" />
            Open {resolvedRightRailMode}
          </button>
        ) : null}

        {sidebarOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/35 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close chats sidebar"
          />
        ) : null}

        {activityOpen ? (
          <div className="absolute inset-0 z-40 flex justify-end bg-black/35 xl:hidden">
            <div className="flex h-full w-11/12 max-w-lg flex-col border-l border-zinc-200 bg-[#f8fafc] shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
                <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  {resolvedRightRailMode === "activity" ? (
                    <>
                      <PanelRight className="h-3.5 w-3.5" />
                      Activity
                    </>
                  ) : (
                    <>
                      <FileText className="h-3.5 w-3.5" />
                      Docs
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActivityOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {resolvedRightRailMode === "activity" ? (
                  <LiveActivityPanel
                    runs={processRuns}
                    feedItems={feedItems}
                    decisions={decisions}
                    onResolve={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
                    onRunAudit={onRunAudit}
                    onSteer={(instruction) => runAsync(steerRun(instruction))}
                    onFeedItemAction={onFeedItemAction}
                  />
                ) : (
                  <DocumentWorkspacePanel
                    workspaceId={workspaceId}
                    branchId={activeBranchId}
                    documents={runtimeDocuments}
                    selectedDocumentId={resolvedSelectedRuntimeDocumentId}
                    onSelectDocument={setSelectedRuntimeDocumentId}
                    onQuoteInChat={onQuoteDocumentInChat}
                    onRefreshDocuments={refreshRuntimeDocuments}
                    onRefreshRuntime={refreshNow}
                  />
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close activity panel"
              className="h-full flex-1"
              onClick={() => setActivityOpen(false)}
            />
          </div>
        ) : null}
      </div>

      <LibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        items={libraryItems}
        activeCollection={activeLibraryCollection}
        onCollectionChange={setActiveLibraryCollection}
        onUseInChat={(item) => onUseLibraryItem(item)}
      />

      {evidenceDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
          <section className="bat-scrollbar flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">Evidence Drawer</p>
                  <p className="text-sm font-semibold text-zinc-900">
                    {evidenceMessageId ? "Selected assistant evidence" : "Assistant evidence"}
                  </p>
                  {evidenceLedger ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      Evidence snapshot • {new Date(evidenceLedger.createdAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setEvidenceDrawerOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700"
                  aria-label="Close evidence drawer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              {evidenceDrawerLoading ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                  Loading evidence...
                </div>
              ) : null}

              {evidenceDrawerError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {evidenceDrawerError}
                </div>
              ) : null}

              {!evidenceDrawerLoading && !evidenceRows.length && !evidenceDrawerError ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                  No persisted evidence found for this run yet.
                </div>
              ) : null}

              {evidenceRows.map((row) => (
                <article key={row.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                      {row.kind}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                      {row.status}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                      confidence {Math.round((Number(row.confidence || 0) || 0) * 100)}%
                    </span>
                    {row.provider ? (
                      <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                        {row.provider}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-zinc-900">{row.label || "Evidence item"}</p>
                  {row.snippet ? <p className="mt-1 text-xs text-zinc-600">{row.snippet}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                    <span>{new Date(row.createdAt).toLocaleString()}</span>
                  </div>
                  {row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      Open source
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
          <button
            type="button"
            className="h-full flex-1"
            onClick={() => setEvidenceDrawerOpen(false)}
            aria-label="Close evidence backdrop"
          />
        </div>
      ) : null}

      {nameDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/40 pt-[18vh]">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
            <p className="text-lg font-semibold text-zinc-900">{nameDialog.title}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.08em] text-zinc-500">
              {nameDialog.mode === "thread" ? "Chat name" : "Branch name"}
            </p>
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitNameDialog();
                }
                if (event.key === "Escape") {
                  setNameDialog(null);
                  setNameInput("");
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={() => {
                  setNameDialog(null);
                  setNameInput("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                onClick={submitNameDialog}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
