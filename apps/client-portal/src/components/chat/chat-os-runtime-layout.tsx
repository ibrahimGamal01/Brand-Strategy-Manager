"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  FileText,
  Library,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRight,
  RefreshCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRuntimeWorkspace } from "@/hooks/use-runtime-workspace";
import { ComposerBranchContext, LibraryCollection, ProcessFeedItem, SessionPreferences } from "@/types/chat";
import {
  applyRuntimeDocumentEdit,
  exportRuntimeDocument,
  fetchRuntimeUploadCapabilities,
  fetchRuntimeEvidence,
  fetchRuntimeLatestLedger,
  getRuntimeDocument,
  proposeRuntimeDocumentEdit,
  RuntimeEvidenceRefDto,
  RuntimeLedgerDto,
  RuntimeWorkspaceDocumentDto,
  uploadRuntimeDocuments,
} from "@/lib/runtime-api";
import {
  applyWorkspaceBrandDnaAutofill,
  createViralStudioIngestion,
  fetchViralStudioSuggestedSources,
  fetchViralStudioWorkflowStatus,
  previewWorkspaceBrandDnaAutofill,
} from "@/lib/viral-studio-api";
import { ChatComposer } from "./chat-composer";
import { ChatThread } from "./chat-thread";
import { CommandPalette } from "./command-palette";
import { DocumentWorkspacePanel } from "./document-workspace-panel";
import { LiveActivityPanel } from "./live-activity-panel";
import { LibraryDrawer } from "@/components/library/library-drawer";
import type { UploadedDocumentChip } from "@/types/chat";
import type {
  ViralStudioBrandDnaAutofillPreview,
  ViralStudioSuggestedSource,
  ViralStudioWorkflowStatus,
} from "@/types/viral-studio";

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
    composerText:
      "Run the V3 competitor finder in standard mode and summarize direct plus adjacent competitors with evidence links.",
    steerPrompt: "Run a standard V3 competitor finder pass and summarize direct plus adjacent competitors.",
  },
  "Go deeper": {
    pref: ["tone", "detailed"],
    composerText:
      "Go deeper on competitor discovery (deep mode), enrich findings, and return a defensible ranked shortlist with evidence.",
    steerPrompt: "Go deeper with lane-by-lane recommendations and concrete competitor examples.",
  },
  "Show sources": {
    pref: ["transparency", true],
    composerText: "Show sources for your last answer and include direct evidence links.",
  },
  "Make it a PDF": {
    composerText: "Generate a deep business strategy PDF from the current workspace evidence.",
  },
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

function formatViralWorkflowStage(stage?: ViralStudioWorkflowStatus["workflowStage"] | null): string {
  const normalized = String(stage || "").trim().toLowerCase();
  if (normalized === "intake_pending") return "Intake pending";
  if (normalized === "intake_complete") return "Intake complete";
  if (normalized === "studio_autofill_review") return "Autofill review";
  if (normalized === "extraction") return "Extraction";
  if (normalized === "curation") return "Curation";
  if (normalized === "generation") return "Generation";
  if (normalized === "chat_execution") return "Chat execution";
  return "Not started";
}

const VIRAL_WORKFLOW_ORDER: Array<ViralStudioWorkflowStatus["workflowStage"]> = [
  "intake_pending",
  "intake_complete",
  "studio_autofill_review",
  "extraction",
  "curation",
  "generation",
  "chat_execution",
];

type ViralBridgePrimaryAction =
  | "open_intake"
  | "autofill_finalize"
  | "start_extraction"
  | "curate_in_studio"
  | "generate_in_studio"
  | "execute_in_chat";

function viralWorkflowStageIndex(stage?: ViralStudioWorkflowStatus["workflowStage"] | null): number {
  const index = VIRAL_WORKFLOW_ORDER.indexOf(
    (stage || "intake_pending") as ViralStudioWorkflowStatus["workflowStage"]
  );
  return index >= 0 ? index : 0;
}

function resolveViralBridgePrimaryAction(
  workflow: ViralStudioWorkflowStatus
): {
  action: ViralBridgePrimaryAction;
  title: string;
  body: string;
  cta: string;
} {
  if (workflow.workflowStage === "intake_pending") {
    return {
      action: "open_intake",
      title: "Complete Intake Context",
      body: "Capture website and social context first so Viral Studio can autofill Brand DNA with evidence-backed fields.",
      cta: "Open Intake",
    };
  }
  if (workflow.workflowStage === "intake_complete" || workflow.workflowStage === "studio_autofill_review") {
    return {
      action: "autofill_finalize",
      title: "Autofill + Finalize Brand DNA",
      body: "Apply smart suggestions and finalize DNA to unlock extraction and downstream generation quality.",
      cta: "Run Autofill",
    };
  }
  if (workflow.workflowStage === "extraction") {
    return {
      action: "start_extraction",
      title: "Start Data-Max Extraction",
      body: "Launch the highest-depth extraction from the best suggested source to seed curation with richer references.",
      cta: "Start Extraction",
    };
  }
  if (workflow.workflowStage === "curation") {
    return {
      action: "curate_in_studio",
      title: "Curate Winning References",
      body: "Pin and mark must-use references in Viral Studio to shape the generation pack with explainable winners.",
      cta: "Open Curation Board",
    };
  }
  if (workflow.workflowStage === "generation") {
    return {
      action: "generate_in_studio",
      title: "Generate Multi-Pack",
      body: "Create hooks, scripts, captions, and CTA variants from curated references and Brand DNA constraints.",
      cta: "Open Generation Studio",
    };
  }
  return {
    action: "execute_in_chat",
    title: "Execute In Core Chat",
    body: "Use Viral Studio context directly in chat to produce operational plans and client-ready actions.",
    cta: "Draft With Context",
  };
}

function mapParserStatusToUploadChipStatus(
  status: string | null | undefined
): UploadedDocumentChip["status"] {
  if (status === "READY") return "ready";
  if (status === "NEEDS_REVIEW") return "needs_review";
  if (status === "FAILED") return "failed";
  return "parsing";
}

function compactContextText(value: string, maxChars = 220): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function quoteBlock(value?: string | null): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildScopedComposerMessage(content: string, context?: ComposerBranchContext | null): string {
  const trimmed = content.trim();
  if (!context) return trimmed;

  const versionLabel =
    typeof context.versionNumber === "number" && context.versionNumber > 0 ? `v${context.versionNumber}` : "latest";
  const quoted = quoteBlock(context.quotedText);

  if (context.kind === "document_edit") {
    const instruction = trimmed || "Tighten this excerpt for clarity, strategic sharpness, and flow.";
    return [
      `Document edit branch: ${context.title} (${versionLabel}).`,
      context.subtitle ? `Context: ${context.subtitle}` : "",
      quoted ? `Quoted excerpt:\n${quoted}` : "",
      `Edit request: ${instruction}`,
      "Return revised wording first, then a brief explanation of what changed. Preserve meaning unless asked to change it.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (context.kind === "document_quote") {
    const instruction =
      trimmed || "Use this selected excerpt as a source in your response and keep the wording grounded in it.";
    return [
      `Document quote branch: ${context.title} (${versionLabel}).`,
      context.subtitle ? `Context: ${context.subtitle}` : "",
      quoted ? `Selected excerpt:\n${quoted}` : "",
      `Request: ${instruction}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    context.title,
    context.subtitle || "",
    trimmed,
  ]
    .filter(Boolean)
    .join("\n\n");
}

type RecentDocumentBranchActivity = {
  id: string;
  kind: "request" | "proposal" | "applied" | "export" | "artifact" | "ready";
  title: string;
  detail?: string;
  createdAt: string;
};

function RightRailPulse({
  runsCount,
  activeRunLabel,
  feedCount,
  docsCount,
  decisionsCount,
  mode,
  hasDocs,
  onSelectMode,
}: {
  runsCount: number;
  activeRunLabel: string;
  feedCount: number;
  docsCount: number;
  decisionsCount: number;
  mode: "activity" | "docs";
  hasDocs: boolean;
  onSelectMode: (mode: "activity" | "docs") => void;
}) {
  return (
    <div className="border-b border-zinc-200 bg-[linear-gradient(180deg,#ffffff_0%,#f7f8f9_100%)] px-3 py-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Live</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{runsCount ? `${runsCount} run${runsCount === 1 ? "" : "s"}` : "Idle"}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{activeRunLabel || "No active process right now."}</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Feed</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{feedCount}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{decisionsCount ? `${decisionsCount} decision${decisionsCount === 1 ? "" : "s"} waiting` : "No open approvals"}</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Docs</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{docsCount}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{hasDocs ? "Ready to inspect and edit" : "No runtime docs yet"}</p>
        </div>
      </div>
      <div className="mt-3 inline-flex w-full items-center rounded-full border border-zinc-200 bg-white p-1">
        <button
          type="button"
          onClick={() => onSelectMode("activity")}
          className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
            mode === "activity" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          Live Activity
        </button>
        {hasDocs ? (
          <button
            type="button"
            onClick={() => onSelectMode("docs")}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              mode === "docs" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            Documents
          </button>
        ) : null}
      </div>
    </div>
  );
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
  const [sidebarToolsOpen, setSidebarToolsOpen] = useState(false);
  const [commandPaletteOpenSignal, setCommandPaletteOpenSignal] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const [composerDraft, setComposerDraft] = useState("");
  const [composerBranchContext, setComposerBranchContext] = useState<ComposerBranchContext | null>(null);
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
  const [viralWorkflow, setViralWorkflow] = useState<ViralStudioWorkflowStatus | null>(null);
  const [viralAutofillPreview, setViralAutofillPreview] = useState<ViralStudioBrandDnaAutofillPreview | null>(null);
  const [viralSuggestedSources, setViralSuggestedSources] = useState<ViralStudioSuggestedSource[]>([]);
  const [viralBridgeBusy, setViralBridgeBusy] = useState(false);
  const [viralBridgeError, setViralBridgeError] = useState<string | null>(null);
  const seenGeneratedDocumentIdsRef = useRef<Set<string>>(new Set());
  const generatedDocumentsSeededRef = useRef(false);
  const pendingGeneratedDocumentIdRef = useRef<string | null>(null);
  const sidebarToolsRef = useRef<HTMLDivElement | null>(null);
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

  const viralStageIndex = viralWorkflowStageIndex(viralWorkflow?.workflowStage || "intake_pending");
  const viralProgressPct = Math.round(((viralStageIndex + 1) / VIRAL_WORKFLOW_ORDER.length) * 100);
  const viralStageRail = useMemo(() => {
    if (!viralWorkflow) return [] as Array<{
      stage: ViralStudioWorkflowStatus["workflowStage"];
      label: string;
      state: "done" | "active" | "upcoming";
    }>;
    const flow: Array<ViralStudioWorkflowStatus["workflowStage"]> = [
      "intake_pending",
      ...(viralWorkflow.flow || []),
    ];
    const deduped = Array.from(new Set(flow));
    const currentIndex = deduped.indexOf(viralWorkflow.workflowStage);
    return deduped.map((stage, index) => ({
      stage,
      label: formatViralWorkflowStage(stage),
      state:
        index < currentIndex
          ? ("done" as const)
          : index === currentIndex
            ? ("active" as const)
            : ("upcoming" as const),
    }));
  }, [viralWorkflow]);
  const viralPrimaryAction = useMemo(
    () => (viralWorkflow ? resolveViralBridgePrimaryAction(viralWorkflow) : null),
    [viralWorkflow]
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
    if (!sidebarToolsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (sidebarToolsRef.current?.contains(event.target)) return;
      setSidebarToolsOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarToolsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [sidebarToolsOpen]);

  useEffect(() => {
    setComposerBranchContext(null);
  }, [activeBranchId, activeThreadId]);

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
  const selectedRuntimeDocument = useMemo(
    () => runtimeDocuments.find((document) => document.id === resolvedSelectedRuntimeDocumentId) || null,
    [resolvedSelectedRuntimeDocumentId, runtimeDocuments]
  );
  const activeDocumentContextId = composerBranchContext?.documentId || selectedRuntimeDocument?.id || null;
  const recentDocumentBranchActivity = useMemo<RecentDocumentBranchActivity[]>(() => {
    if (!activeDocumentContextId) return [];

    const items: RecentDocumentBranchActivity[] = [];
    for (const message of [...messages].reverse()) {
      if (message.role === "user" && message.documentIds?.includes(activeDocumentContextId)) {
        const summary = compactContextText(message.content, 140);
        items.push({
          id: `${message.id}-request`,
          kind: "request",
          title: "Branch request",
          ...(summary ? { detail: summary } : {}),
          createdAt: message.createdAt,
        });
      }

      for (const block of message.blocks || []) {
        if (
          block.type === "document_edit_proposal" &&
          block.documentId === activeDocumentContextId
        ) {
          const proposalDetail = String(block.changeSummary || block.instruction || "").trim();
          items.push({
            id: `${message.id}-${block.baseVersionId}-proposal`,
            kind: "proposal",
            title: "Edit proposal ready",
            ...(proposalDetail ? { detail: compactContextText(proposalDetail, 140) } : {}),
            createdAt: message.createdAt,
          });
        }
        if (
          block.type === "document_edit_applied" &&
          block.documentId === activeDocumentContextId
        ) {
          const appliedDetail = String(block.changeSummary || "").trim();
          items.push({
            id: `${message.id}-${block.versionId}-applied`,
            kind: "applied",
            title: `Version ${block.versionNumber} saved`,
            ...(appliedDetail ? { detail: compactContextText(appliedDetail, 140) } : {}),
            createdAt: message.createdAt,
          });
        }
        if (
          block.type === "document_export_result" &&
          block.documentId === activeDocumentContextId
        ) {
          items.push({
            id: `${message.id}-${block.exportId}-export`,
            kind: "export",
            title: `${block.format} export ready`,
            createdAt: message.createdAt,
          });
        }
        if (
          block.type === "document_artifact" &&
          block.documentId === activeDocumentContextId
        ) {
          const artifactTitle = String(block.title || "Document artifact").trim() || "Document artifact";
          items.push({
            id: `${message.id}-${block.versionId || artifactTitle}-artifact`,
            kind: "artifact",
            title: artifactTitle,
            ...(typeof block.versionNumber === "number" ? { detail: `Version ${block.versionNumber}` } : {}),
            createdAt: message.createdAt,
          });
        }
        if (
          (block.type === "document_ready" || block.type === "document_parse_needs_review") &&
          block.documentId === activeDocumentContextId
        ) {
          const readyTitle = String(block.title || "").trim();
          items.push({
            id: `${message.id}-${block.documentId}-ready`,
            kind: "ready",
            title: block.type === "document_ready" ? "Document ready" : "Needs review",
            ...(readyTitle ? { detail: compactContextText(readyTitle, 120) } : {}),
            createdAt: message.createdAt,
          });
        }
      }
    }
    return items.slice(0, 6);
  }, [activeDocumentContextId, composerBranchContext?.documentId, messages, selectedRuntimeDocument?.id]);

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

  useEffect(() => {
    let cancelled = false;
    const loadViralBridge = async () => {
      try {
        const [workflowPayload, sourcesPayload] = await Promise.all([
          fetchViralStudioWorkflowStatus(workspaceId),
          fetchViralStudioSuggestedSources(workspaceId),
        ]);
        if (cancelled) return;
        setViralWorkflow(workflowPayload.workflow);
        setViralSuggestedSources(sourcesPayload.items || []);
      } catch {
        if (cancelled) return;
      }
    };
    void loadViralBridge();
    const timer = window.setInterval(() => {
      void loadViralBridge();
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workspaceId]);

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
    const scopedContent = buildScopedComposerMessage(content, composerBranchContext);
    const scopedDocumentIds = Array.from(
      new Set([
        ...(Array.isArray(options?.documentIds) ? options?.documentIds.filter(Boolean) : []),
        ...(composerBranchContext?.documentId ? [composerBranchContext.documentId] : []),
      ])
    );
    runAsync(
      sendMessage(scopedContent, mode, {
        ...(Array.isArray(options?.attachmentIds) ? { attachmentIds: options.attachmentIds } : {}),
        ...(scopedDocumentIds.length ? { documentIds: scopedDocumentIds } : {}),
      })
    );
    setComposerBranchContext(null);
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

  const openComposerBranch = (context: ComposerBranchContext, nextDraft = "") => {
    setComposerBranchContext(context);
    setComposerDraft(nextDraft);
    setComposerFocusSignal((previous) => previous + 1);
  };

  const refreshViralBridgeNow = async () => {
    const [workflowPayload, sourcesPayload] = await Promise.all([
      fetchViralStudioWorkflowStatus(workspaceId),
      fetchViralStudioSuggestedSources(workspaceId),
    ]);
    setViralWorkflow(workflowPayload.workflow);
    setViralSuggestedSources(sourcesPayload.items || []);
  };

  const previewViralAutofill = () => {
    runAsync(
      (async () => {
        setViralBridgeError(null);
        setViralBridgeBusy(true);
        try {
          const payload = await previewWorkspaceBrandDnaAutofill(workspaceId);
          setViralAutofillPreview(payload.preview);
        } catch (error) {
          setViralBridgeError(String((error as Error)?.message || "Failed to load Viral Studio autofill preview."));
        } finally {
          setViralBridgeBusy(false);
        }
      })()
    );
  };

  const applyViralAutofill = () => {
    runAsync(
      (async () => {
        setViralBridgeError(null);
        setViralBridgeBusy(true);
        try {
          await applyWorkspaceBrandDnaAutofill(workspaceId, { finalizeIfReady: true });
          await refreshViralBridgeNow();
          injectComposerText(
            "Brand DNA autofill suggestions were applied. Use Viral Studio context from this workspace and prepare the next extraction/curation actions.",
            "replace"
          );
        } catch (error) {
          setViralBridgeError(String((error as Error)?.message || "Failed to apply Viral Studio autofill."));
        } finally {
          setViralBridgeBusy(false);
        }
      })()
    );
  };

  const launchViralExtractionFromSuggestion = () => {
    runAsync(
      (async () => {
        const source = viralSuggestedSources[0];
        if (!source) {
          setViralBridgeError("No suggested social source found yet.");
          return;
        }
        if (!viralWorkflow?.brandDnaReady) {
          setViralBridgeError("Finalize Brand DNA first (preview/apply autofill), then start extraction.");
          return;
        }
        setViralBridgeError(null);
        setViralBridgeBusy(true);
        try {
          await createViralStudioIngestion(workspaceId, {
            sourcePlatform: source.platform,
            sourceUrl: source.sourceUrl,
            preset: "data-max",
            sortBy: "engagement",
          });
          await refreshViralBridgeNow();
          injectComposerText(
            `A Viral Studio data-max extraction run was started from ${source.sourceUrl}. Track progress, then build a shortlist and execution plan.`,
            "replace"
          );
        } catch (error) {
          setViralBridgeError(String((error as Error)?.message || "Failed to start Viral Studio extraction run."));
        } finally {
          setViralBridgeBusy(false);
        }
      })()
    );
  };

  const runViralBridgePrimaryAction = () => {
    if (!viralWorkflow || !viralPrimaryAction) return;
    if (viralPrimaryAction.action === "open_intake") {
      router.push(`/app/w/${workspaceId}/intake`);
      return;
    }
    if (viralPrimaryAction.action === "autofill_finalize") {
      applyViralAutofill();
      return;
    }
    if (viralPrimaryAction.action === "start_extraction") {
      launchViralExtractionFromSuggestion();
      return;
    }
    if (viralPrimaryAction.action === "curate_in_studio") {
      router.push(`/app/w/${workspaceId}/viral-studio`);
      injectComposerText(
        "Open the Viral Studio curation board and finalize must-use + pin shortlist decisions, then summarize the top 3 strategic angles here.",
        "replace"
      );
      return;
    }
    if (viralPrimaryAction.action === "generate_in_studio") {
      router.push(`/app/w/${workspaceId}/viral-studio`);
      injectComposerText(
        "Generate the Viral Studio multi-pack (hooks/scripts/captions/CTAs), then return with execution sequencing for this workspace.",
        "replace"
      );
      return;
    }
    injectComposerText(
      "Use Viral Studio context from this workspace (brand DNA, prioritized references, and latest generation/doc refs) and produce the next execution actions.",
      "replace"
    );
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

  useEffect(() => {
    const documentId = composerBranchContext?.documentId;
    if (!documentId) return;
    if (selectedRuntimeDocumentId !== documentId) {
      setSelectedRuntimeDocumentId(documentId);
    }
    if (resolvedRightRailMode !== "docs" || rightRailCollapsed) {
      openRightRailMode("docs");
    }
  }, [composerBranchContext?.documentId, resolvedRightRailMode, rightRailCollapsed, selectedRuntimeDocumentId]);

  const onQuoteDocumentInChat = (input: { document: RuntimeWorkspaceDocumentDto; quotedText: string }) => {
    const sourceTitle = input.document.title || input.document.originalFileName || "Document";
    const versionNumber =
      typeof input.document.latestVersion?.versionNumber === "number" ? input.document.latestVersion.versionNumber : undefined;
    openComposerBranch(
      {
        kind: "document_quote",
        title: sourceTitle,
        subtitle: "Scoped to the selected document excerpt",
        documentId: input.document.id,
        ...(typeof versionNumber === "number" ? { versionNumber } : {}),
        quotedText: compactContextText(input.quotedText, 320),
        commandHint: "/quote-doc",
      },
      ""
    );
  };

  const onAskAiEditFromDocumentReader = (input: { document: RuntimeWorkspaceDocumentDto; quotedText: string }) => {
    const sourceTitle = input.document.title || input.document.originalFileName || "Document";
    const versionNumber =
      typeof input.document.latestVersion?.versionNumber === "number" ? input.document.latestVersion.versionNumber : undefined;
    openComposerBranch(
      {
        kind: "document_edit",
        title: sourceTitle,
        subtitle: "Reply with the change you want and BAT will draft the edit for this excerpt.",
        documentId: input.document.id,
        ...(typeof versionNumber === "number" ? { versionNumber } : {}),
        quotedText: compactContextText(input.quotedText, 320),
        commandHint: "/edit-doc",
      },
      ""
    );
  };

  const onQuoteArtifactInChat = (input: {
    title: string;
    quotedText: string;
    documentId?: string;
    versionNumber?: number;
  }) => {
    openComposerBranch(
      {
        kind: "document_quote",
        title: input.title,
        subtitle: "Scoped to the selected excerpt from the document preview",
        ...(input.documentId ? { documentId: input.documentId } : {}),
        ...(typeof input.versionNumber === "number" ? { versionNumber: input.versionNumber } : {}),
        quotedText: compactContextText(input.quotedText, 320),
        commandHint: "/quote-doc",
      },
      ""
    );
  };

  const onAskEditFromArtifact = (input: {
    title: string;
    quotedText: string;
    documentId?: string;
    versionNumber?: number;
  }) => {
    if (input.documentId) {
      openDocsRail(input.documentId);
    }
    openComposerBranch(
      {
        kind: "document_edit",
        title: input.title,
        subtitle: "Reply with the specific change and BAT will treat it like a scoped document branch.",
        ...(input.documentId ? { documentId: input.documentId } : {}),
        ...(typeof input.versionNumber === "number" ? { versionNumber: input.versionNumber } : {}),
        quotedText: compactContextText(input.quotedText, 320),
        commandHint: "/edit-doc",
      },
      ""
    );
  };

  const loadRuntimeDocumentMarkdown = async (documentId: string): Promise<string> => {
    const targetId = String(documentId || "").trim();
    if (!targetId || !activeBranchId) return "";
    const cached = runtimeDocuments.find((document) => document.id === targetId) || null;
    const cachedMarkdown = String(cached?.latestVersion?.contentMd || "").trim();
    if (cachedMarkdown) return cachedMarkdown;
    const payload = await getRuntimeDocument(workspaceId, activeBranchId, targetId);
    const latest = String(payload.document.latestVersion?.contentMd || "").trim();
    if (latest) return latest;
    const fallback = Array.isArray(payload.document.versions) ? String(payload.document.versions[0]?.contentMd || "").trim() : "";
    return fallback;
  };

  const onFeedItemAction = (item: ProcessFeedItem) => {
    if (item.actionTarget?.kind === "document") {
      openDocsRail(item.actionTarget.documentId);
      return;
    }
  };

  const resolvePayloadDocumentId = (payload?: Record<string, unknown>): string =>
    String(payload?.documentId || payload?.docId || "").trim();

  const buildDocumentGeneratePrompt = (payload?: Record<string, unknown>): string => {
    const rawType = String(payload?.docType || payload?.documentType || "BUSINESS_STRATEGY")
      .trim()
      .toUpperCase();
    const docType =
      rawType === "SWOT" || rawType === "SWOT_ANALYSIS"
        ? "SWOT"
        : rawType === "PLAYBOOK"
          ? "PLAYBOOK"
          : rawType === "COMPETITOR_AUDIT"
            ? "COMPETITOR_AUDIT"
            : rawType === "CONTENT_CALENDAR" || rawType === "CONTENT_CALENDAR_LEGACY"
              ? "CONTENT_CALENDAR"
              : rawType === "GO_TO_MARKET" || rawType === "GTM_PLAN"
                ? "GO_TO_MARKET"
                : "BUSINESS_STRATEGY";
    const depth = String(payload?.depth || "deep")
      .trim()
      .toLowerCase();
    const title = String(payload?.title || "").trim();
    const includeEvidenceLinks = payload?.includeEvidenceLinks !== false;
    const continueDeepening = payload?.continueDeepening === true;
    const resumeDocumentId = String(payload?.resumeDocumentId || "").trim();
    const audience = String(payload?.audience || "").trim();
    const timeframeDays = Number(payload?.timeframeDays);

    const lines: string[] = [];
    if (continueDeepening) {
      lines.push(
        `Continue deepening the ${docType.replace(/_/g, " ").toLowerCase()} deliverable and regenerate a PDF with stronger evidence density.`
      );
    } else {
      lines.push(`Generate a ${depth} ${docType.replace(/_/g, " ").toLowerCase()} PDF for this workspace.`);
    }
    if (title) lines.push(`Use this title: "${title}".`);
    if (audience) lines.push(`Audience: ${audience}.`);
    if (Number.isFinite(timeframeDays) && timeframeDays > 0) {
      lines.push(`Planning window: ${Math.floor(timeframeDays)} days.`);
    }
    lines.push(includeEvidenceLinks ? "Include source links and evidence ledger." : "Do not include source links.");
    if (resumeDocumentId) {
      lines.push(`Resume from document ID ${resumeDocumentId}.`);
    }
    return lines.join(" ");
  };

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
    const action = actionKey.trim().toLowerCase().replace(/^\/+/, "");
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
      runPriorityCommand(buildDocumentGeneratePrompt(payload));
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
          : action.replace(/[^a-z0-9_.-]+/g, "_");
    const payloadText = payload ? JSON.stringify(payload) : "";
    if (normalizedCommand === "generate_pdf") {
      runPriorityCommand("Generate a deep business strategy PDF using current workspace evidence and include citations.");
    } else if (normalizedCommand === "show_sources") {
      injectComposerText("Show sources and direct evidence links for your latest answer.", "replace");
    } else if (normalizedCommand.startsWith("document.")) {
      const readableAction = normalizedCommand.replace(/^document\./, "").replace(/[._-]+/g, " ");
      runPriorityCommand(
        payloadText
          ? `Run document ${readableAction} using this payload and return user-facing output only: ${payloadText}`
          : `Run document ${readableAction} and return user-facing output only.`
      );
    } else {
      injectComposerText(
        payloadText
          ? `Run action ${normalizedCommand} with payload ${payloadText}`
          : `Run action ${normalizedCommand}`,
        "append"
      );
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
    if (command === "/go-deeper") {
      onSteer("Go deeper");
      return;
    }
    if (command === "/make-pdf" || command === "/export-pdf") {
      injectComposerText("Generate a deep business strategy PDF deliverable from this workspace evidence.", "replace");
      return;
    }
    if (command === "/show-sources") {
      injectComposerText("Show the evidence sources and links used for your latest answer.", "replace");
      return;
    }
    if (command === "/focus-web") {
      onSteer("Focus on Web evidence");
      return;
    }
    if (command === "/focus-social") {
      onSteer("Focus on TikTok");
      return;
    }
    if (command === "/mode-fast") {
      setPreference("responseMode", "fast");
      return;
    }
    if (command === "/mode-balanced") {
      setPreference("responseMode", "balanced");
      return;
    }
    if (command === "/mode-deep") {
      setPreference("responseMode", "deep");
      return;
    }
    if (command === "/mode-pro") {
      setPreference("responseMode", "pro");
      return;
    }
    if (command === "/new-branch") {
      onForkBranch();
      return;
    }
    if (command === "/edit-doc" || command === "/rewrite-selection") {
      const target =
        composerBranchContext?.documentId || selectedRuntimeDocument?.id
          ? {
              id: composerBranchContext?.documentId || selectedRuntimeDocument?.id || "",
              title: composerBranchContext?.title || selectedRuntimeDocument?.title || selectedRuntimeDocument?.originalFileName || "Document",
              versionNumber:
                composerBranchContext?.versionNumber ||
                selectedRuntimeDocument?.latestVersion?.versionNumber ||
                undefined,
              quotedText: composerBranchContext?.quotedText,
            }
          : null;
      if (target) {
        openComposerBranch(
          {
            kind: "document_edit",
            title: target.title,
            subtitle: "Reply with the edit request for this document branch.",
            documentId: target.id,
            ...(typeof target.versionNumber === "number" ? { versionNumber: target.versionNumber } : {}),
            ...(target.quotedText ? { quotedText: target.quotedText } : {}),
            commandHint: command === "/rewrite-selection" ? "/rewrite-selection" : "/edit-doc",
          },
          command === "/rewrite-selection"
            ? "Rewrite this selection to be clearer, tighter, and more executive-ready without changing the meaning."
            : ""
        );
        return;
      }
      openDocsRail();
      setActionError("Select or open a document first, then run /edit-doc.");
      return;
    }
    if (command === "/quote-doc") {
      if (composerBranchContext?.documentId) {
        openComposerBranch(
          {
            ...composerBranchContext,
            kind: "document_quote",
            commandHint: "/quote-doc",
          },
          ""
        );
        return;
      }
      if (selectedRuntimeDocument) {
        openComposerBranch(
          {
            kind: "document_quote",
            title: selectedRuntimeDocument.title || selectedRuntimeDocument.originalFileName || "Document",
            subtitle: "Use the current document as scoped context in chat.",
            documentId: selectedRuntimeDocument.id,
            ...(typeof selectedRuntimeDocument.latestVersion?.versionNumber === "number"
              ? { versionNumber: selectedRuntimeDocument.latestVersion.versionNumber }
              : {}),
            commandHint: "/quote-doc",
          },
          ""
        );
        return;
      }
      openDocsRail();
      return;
    }
    if (command === "/export-pdf") {
      injectComposerText("Generate a deep business strategy PDF deliverable from this workspace evidence.", "replace");
      return;
    }
    if (command === "/show-sources") {
      injectComposerText("Show the evidence sources and links used for your latest answer.", "replace");
      return;
    }
    if (command === "/web") {
      injectComposerText("Search the web for additional evidence relevant to this workspace and summarize top findings.", "replace");
      return;
    }
    if (command === "/competitor-v3") {
      injectComposerText(
        "Run the V3 competitor finder in deep mode with enrichment and return a ranked shortlist backed by evidence.",
        "replace"
      );
      return;
    }
    if (command === "Open Viral Studio") {
      router.push(`/app/w/${workspaceId}/viral-studio`);
      return;
    }
    if (command === "Use Viral Studio context") {
      injectComposerText(
        "Use Viral Studio context from this workspace (brand DNA, shortlisted viral references, and latest generated pack) and convert it into a business execution plan.",
        "replace"
      );
      return;
    }
    if (command === "Viral Studio: Preview autofill") {
      previewViralAutofill();
      return;
    }
    if (command === "Viral Studio: Apply autofill") {
      applyViralAutofill();
      return;
    }
    if (command === "Viral Studio: Start data-max extraction") {
      launchViralExtractionFromSuggestion();
      return;
    }
    if (command === "Viral Studio: Run next step") {
      runViralBridgePrimaryAction();
      return;
    }
    if (command === "Viral Studio: Run website-first autopilot") {
      router.push(`/app/w/${workspaceId}/viral-studio?autopilot=website-first`);
      return;
    }
    if (command === "Run V3 competitor finder (standard)") {
      injectComposerText(
        "Run the V3 competitor finder in standard mode and summarize direct plus adjacent competitors with evidence.",
        "replace"
      );
      return;
    }
    if (command === "Run V3 competitor finder (deep)") {
      injectComposerText(
        "Run the V3 competitor finder in deep mode with enrichment and return a ranked shortlist backed by evidence.",
        "replace"
      );
      return;
    }
    if (command === "Run competitor discovery (legacy)") {
      injectComposerText(
        "Run competitor discovery across direct and adjacent players, then summarize positioning gaps and opportunities.",
        "replace"
      );
      return;
    }
    if (command === "Generate PDF deliverable") {
      injectComposerText("Generate a deep business strategy PDF deliverable from this workspace evidence.", "replace");
      return;
    }
    if (command === "Show sources") {
      injectComposerText("Show the evidence sources and links used for your latest answer.", "replace");
      return;
    }
    if (command === "Search web evidence") {
      injectComposerText("Search the web for additional evidence relevant to this workspace and summarize top findings.", "replace");
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
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{error || actionError}</p>
        </div>
      ) : null}

      <div className="relative h-full overflow-hidden bg-[#f6f7f8]">
        <div className="grid h-[calc(100dvh-5rem)] min-h-[34rem] w-full grid-cols-1 lg:grid-cols-[16.5rem_minmax(0,1fr)] xl:grid-cols-[17.25rem_minmax(0,1fr)]">
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
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-800"
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
                  className={`w-full rounded-md px-3 py-2 text-left transition ${
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
                    className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
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
                        className={`rounded-md border px-2.5 py-1 text-xs ${
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
                  onClick={() => {
                    setActiveLibraryCollection("all");
                    setLibraryOpen(true);
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  <Library className="h-3.5 w-3.5" />
                  Library
                </button>
                <div ref={sidebarToolsRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setSidebarToolsOpen((previous) => !previous)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                    aria-label="Workspace tools"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {sidebarToolsOpen ? (
                    <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-zinc-700 bg-[#1d1d1d] p-1.5 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => {
                          setSidebarToolsOpen(false);
                          runAsync(refreshNow());
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Refresh workspace
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSidebarToolsOpen(false);
                          setCommandPaletteOpenSignal((previous) => previous + 1);
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        <Command className="h-3.5 w-3.5" />
                        Command menu
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSidebarToolsOpen(false);
                          router.push(`/app/w/${workspaceId}/viral-studio`);
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Open Viral Studio
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.08em] text-zinc-400">Pinned context</p>
                  <span className="text-[11px] text-zinc-500">Cmd/Ctrl+K</span>
                </div>
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

          <section className="relative flex min-h-0 flex-col overflow-hidden bg-[#fbfbfc]">
            <header className="flex items-center justify-between gap-3 border-b border-zinc-200/90 bg-white/90 px-3 py-2.5 backdrop-blur sm:px-4 xl:px-5">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 lg:hidden"
                    onClick={() => setSidebarOpen((prev) => !prev)}
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                  <h1 className="truncate text-sm font-semibold text-zinc-900">{activeThread?.title || "New chat"}</h1>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                    {syncing ? "Syncing..." : activeBranch ? `Branch: ${activeBranch.name}` : "Main branch"}
                  </span>
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                    {isStreaming ? formatPhaseLabel(activeRun?.phase) : "Idle"}
                  </span>
                  {streamingInsight ? (
                    <span className="max-w-[28rem] truncate rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                      {streamingInsight}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setRightRailMode(resolvedRightRailMode);
                    setActivityOpen((previous) => !previous);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 xl:hidden"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                  Inspector
                </button>
                <button
                  type="button"
                  onClick={() => setRightRailCollapsed((previous) => !previous)}
                  className="hidden items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 xl:inline-flex"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                  {rightRailCollapsed ? "Open inspector" : "Hide inspector"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/app/w/${workspaceId}/viral-studio`)}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Studio
                </button>
              </div>
            </header>

            <div
              className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${
                rightRailCollapsed
                  ? "xl:grid-cols-1"
                  : "xl:grid-cols-[minmax(0,1fr)_25rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]"
              }`}
            >
              <div className="flex min-h-0 flex-col border-zinc-200 xl:border-r xl:border-zinc-200/80">
                {viralWorkflow ? (
                  <div className="mx-3 mt-3 rounded-[1.5rem] border border-sky-200 bg-gradient-to-br from-sky-50 via-cyan-50 to-white p-3 shadow-[0_20px_45px_-35px_rgba(14,165,233,0.55)] sm:mx-4 xl:mx-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sky-700">
                          Viral Studio Workflow Bridge
                        </p>
                        <p className="mt-1 text-xs text-zinc-700">
                          Intake {viralWorkflow.intakeCompleted ? "complete" : "pending"} • Brand DNA{" "}
                          {viralWorkflow.brandDnaReady ? "ready" : "not ready"} • Prioritized refs{" "}
                          {viralWorkflow.counts.prioritizedReferences}
                        </p>
                        <p className="mt-1 text-xs text-zinc-700">
                          Stage: <strong>{formatViralWorkflowStage(viralWorkflow.workflowStage)}</strong>
                        </p>
                      </div>
                      <div className="rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-right">
                        <p className="text-[10px] uppercase tracking-[0.08em] text-sky-700">Progress</p>
                        <strong className="text-sm text-sky-800">{viralProgressPct}%</strong>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-100">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-teal-500 transition-all"
                        style={{ width: `${viralProgressPct}%` }}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-7">
                      {(viralStageRail.length
                        ? viralStageRail
                        : VIRAL_WORKFLOW_ORDER.map((stage, index) => ({
                            stage,
                            label: formatViralWorkflowStage(stage),
                            state:
                              index < viralStageIndex
                                ? ("done" as const)
                                : index === viralStageIndex
                                  ? ("active" as const)
                                  : ("upcoming" as const),
                          }))
                      ).map((entry) => (
                        <div
                          key={entry.stage}
                          className={`rounded-md border px-2 py-1 ${
                            entry.state === "active"
                              ? "border-blue-300 bg-blue-50"
                              : entry.state === "done"
                                ? "border-teal-200 bg-teal-50"
                                : "border-sky-100 bg-white"
                          }`}
                        >
                          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-600">
                            {entry.label}
                          </p>
                          <span className="text-[10px] text-zinc-500">
                            {entry.state === "done" ? "Done" : entry.state === "active" ? "Now" : "Queued"}
                          </span>
                        </div>
                      ))}
                    </div>

                    {viralPrimaryAction ? (
                      <div className="mt-3 rounded-xl border border-sky-200 bg-white/90 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-700">
                          Recommended Next Step
                        </p>
                        <p className="mt-1 text-sm font-semibold text-zinc-900">{viralPrimaryAction.title}</p>
                        <p className="mt-1 text-xs text-zinc-700">{viralPrimaryAction.body}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={runViralBridgePrimaryAction}
                            disabled={viralBridgeBusy}
                            className="rounded-md border border-sky-200 bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                          >
                            {viralBridgeBusy ? "Working..." : viralPrimaryAction.cta}
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(`/app/w/${workspaceId}/viral-studio`)}
                            className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100"
                          >
                            Open Viral Studio
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(`/app/w/${workspaceId}/viral-studio?autopilot=website-first`)}
                            className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100"
                          >
                            Run website-first autopilot
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              injectComposerText(
                                "Use Viral Studio context from this workspace (brand DNA, prioritized references, and latest generation/doc refs) and produce the next execution actions.",
                                "replace"
                              )
                            }
                            className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100"
                          >
                            Draft with context
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {viralAutofillPreview ? (
                      <p className="mt-2 text-xs text-zinc-600">
                        Autofill preview: {viralAutofillPreview.coverage.suggestedCount} field(s) • Confidence{" "}
                        {Math.round((viralAutofillPreview.suggestionConfidence || 0) * 100)}%
                      </p>
                    ) : null}
                    {viralSuggestedSources[0] ? (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-600">
                        Suggested source: {viralSuggestedSources[0].label} • {viralSuggestedSources[0].sourceUrl}
                      </p>
                    ) : null}
                    {viralBridgeError ? (
                      <p className="mt-1 text-xs text-red-700">{viralBridgeError}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={previewViralAutofill}
                        disabled={viralBridgeBusy}
                        className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                      >
                        Manual: Preview autofill
                      </button>
                      <button
                        type="button"
                        onClick={applyViralAutofill}
                        disabled={viralBridgeBusy}
                        className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                      >
                        Manual: Apply autofill
                      </button>
                      <button
                        type="button"
                        onClick={launchViralExtractionFromSuggestion}
                        disabled={viralBridgeBusy || !viralWorkflow.brandDnaReady || viralSuggestedSources.length === 0}
                        className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                      >
                        Manual: Start data-max extraction
                      </button>
                    </div>
                  </div>
                ) : null}
                <ChatThread
                  messages={messages}
                  onForkFromMessage={onForkBranch}
                  onOpenEvidence={onOpenEvidence}
                  onResolveDecision={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
                  onRunAction={onRunMessageAction}
                  onLoadDocumentMarkdown={loadRuntimeDocumentMarkdown}
                  onQuoteArtifact={onQuoteArtifactInChat}
                  onAskEditArtifact={onAskEditFromArtifact}
                  onStarterAction={(action) => {
                    if (action === "audit") {
                      injectComposerText(
                        "Run a full workspace intelligence audit now and summarize the highest-impact opportunities.",
                        "replace"
                      );
                      return;
                    }
                    if (action === "sources") {
                      injectComposerText("Show sources and evidence links for the latest assistant response.", "replace");
                      return;
                    }
                    if (action === "deliverable") {
                      injectComposerText("Generate a deep business strategy PDF from current workspace evidence.", "replace");
                      return;
                    }
                    injectComposerText(
                      "Run the V3 competitor finder in standard mode and summarize direct plus adjacent competitors.",
                      "replace"
                    );
                  }}
                  showInlineReasoning={false}
                  isStreaming={isStreaming}
                  streamingInsight={streamingInsight}
                    contentWidthClassName="max-w-none"
                  />

                {!activeBranchId ? (
                  <div className="mx-3 mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:mx-4 xl:mx-5">
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
                  onCommandSelect={onCommand}
                  branchContext={composerBranchContext}
                  onClearBranchContext={() => setComposerBranchContext(null)}
                  contentWidthClassName="max-w-none"
                />
              </div>

              {!rightRailCollapsed ? (
                <div className="hidden min-h-0 border-l border-zinc-200 bg-white xl:flex xl:flex-col">
                  <RightRailPulse
                    runsCount={processRuns.filter((run) => run.status === "running" || run.status === "waiting_input").length}
                    activeRunLabel={activeRun ? `${activeRun.label} • ${formatPhaseLabel(activeRun.phase)}` : visibleFeed[0]?.message || ""}
                    feedCount={feedItems.length}
                    docsCount={runtimeDocuments.length}
                    decisionsCount={decisions.length}
                    mode={resolvedRightRailMode}
                    hasDocs={hasDocsContext}
                    onSelectMode={openRightRailMode}
                  />
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
                        branchContext={composerBranchContext}
                        recentBranchActivity={recentDocumentBranchActivity}
                        onSelectDocument={setSelectedRuntimeDocumentId}
                        onQuoteInChat={onQuoteDocumentInChat}
                        onAskAiEdit={onAskAiEditFromDocumentReader}
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
            className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 shadow-sm hover:bg-zinc-100 xl:inline-flex"
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
            <div className="flex h-full w-11/12 max-w-lg flex-col border-l border-zinc-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
                <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  Inspector
                </div>
                <button
                  type="button"
                  onClick={() => setActivityOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <RightRailPulse
                runsCount={processRuns.filter((run) => run.status === "running" || run.status === "waiting_input").length}
                activeRunLabel={activeRun ? `${activeRun.label} • ${formatPhaseLabel(activeRun.phase)}` : visibleFeed[0]?.message || ""}
                feedCount={feedItems.length}
                docsCount={runtimeDocuments.length}
                decisionsCount={decisions.length}
                mode={resolvedRightRailMode}
                hasDocs={hasDocsContext}
                onSelectMode={setRightRailMode}
              />
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
                    branchContext={composerBranchContext}
                    recentBranchActivity={recentDocumentBranchActivity}
                    onSelectDocument={setSelectedRuntimeDocumentId}
                    onQuoteInChat={onQuoteDocumentInChat}
                    onAskAiEdit={onAskAiEditFromDocumentReader}
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

      <CommandPalette onSelect={onCommand} showTrigger={false} openSignal={commandPaletteOpenSignal} />

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
