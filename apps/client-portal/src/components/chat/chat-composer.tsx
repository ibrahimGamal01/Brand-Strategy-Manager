"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Command,
  FileText,
  GitBranch,
  ListOrdered,
  MoreHorizontal,
  Paperclip,
  SendHorizontal,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  ChatInputOptions,
  ChatInputSourceScope,
  ComposerBranchContext,
  QueuedMessage,
  UploadedDocumentChip,
} from "@/types/chat";

const sourceScopeOptions: Array<{ key: keyof ChatInputSourceScope; label: string }> = [
  { key: "workspaceData", label: "Workspace" },
  { key: "libraryPinned", label: "Pinned" },
  { key: "uploadedDocs", label: "Docs" },
  { key: "webSearch", label: "Web" },
  { key: "liveWebsiteCrawl", label: "Crawl" },
  { key: "socialIntel", label: "Social" },
];

type SlashCommandItem = {
  id: string;
  label: string;
  description: string;
  insertText?: string;
  category: "Document" | "Research" | "Workspace" | "Mode" | "Focus";
  badge?: string;
  aliases?: string[];
  pill?: boolean;
  requiresDocument?: boolean;
};

const slashCommands: SlashCommandItem[] = [
  {
    id: "/go-deeper",
    label: "Go deeper",
    description: "Push the current task into a more comprehensive and higher-depth response.",
    category: "Mode",
    badge: "Deep",
    aliases: ["deep", "detailed", "expand"],
    pill: true,
  },
  {
    id: "/show-sources",
    label: "Show sources",
    description: "Reveal direct evidence and links behind the latest answer.",
    insertText: "Show the evidence sources and links used for your latest answer.",
    category: "Research",
    badge: "Evidence",
    aliases: ["sources", "citations", "evidence"],
    pill: true,
  },
  {
    id: "/make-pdf",
    label: "Make it a PDF",
    description: "Generate a premium PDF deliverable from the current workspace evidence.",
    insertText: "Generate a deep business strategy PDF deliverable from this workspace evidence.",
    category: "Workspace",
    badge: "Deliverable",
    aliases: ["pdf", "export", "document"],
    pill: true,
  },
  {
    id: "/focus-web",
    label: "Focus on Web evidence",
    description: "Bias the next answer toward web evidence and live site citations.",
    category: "Focus",
    badge: "Web",
    aliases: ["web", "crawl", "site"],
    pill: true,
  },
  {
    id: "/edit-doc",
    label: "Edit Document",
    description: "Open document-edit mode for the selected excerpt or active doc.",
    category: "Document",
    badge: "Doc",
    aliases: ["edit", "doc"],
    requiresDocument: true,
  },
  {
    id: "/rewrite-selection",
    label: "Rewrite Selection",
    description: "Tighten, elevate, or simplify the quoted passage without changing intent.",
    category: "Document",
    badge: "Doc",
    aliases: ["rewrite", "selection"],
    requiresDocument: true,
  },
  {
    id: "/quote-doc",
    label: "Use Selection In Chat",
    description: "Bring the selected passage into the conversation as a scoped reference.",
    category: "Document",
    badge: "Doc",
    aliases: ["quote", "reference"],
    requiresDocument: true,
  },
  {
    id: "/export-pdf",
    label: "Generate PDF",
    description: "Create a premium PDF deliverable from the current workspace evidence.",
    insertText: "Generate a deep business strategy PDF deliverable from this workspace evidence.",
    category: "Workspace",
    badge: "Deliverable",
    aliases: ["pdf", "export"],
  },
  {
    id: "/mode-fast",
    label: "Mode: Fast",
    description: "Switch to a quick response mode with shorter output.",
    category: "Mode",
    badge: "Fast",
    aliases: ["fast", "quick"],
  },
  {
    id: "/mode-balanced",
    label: "Mode: Balanced",
    description: "Switch to the middle-ground response mode.",
    category: "Mode",
    badge: "Balanced",
    aliases: ["balanced", "normal"],
  },
  {
    id: "/mode-deep",
    label: "Mode: Deep",
    description: "Switch to a thorough, longer-form answer mode.",
    category: "Mode",
    badge: "Deep",
    aliases: ["deep", "thorough"],
  },
  {
    id: "/mode-pro",
    label: "Mode: Pro",
    description: "Use the highest validation and most demanding response mode.",
    category: "Mode",
    badge: "Pro",
    aliases: ["pro", "strict"],
  },
  {
    id: "/web",
    label: "Search Web",
    description: "Pull in fresh web evidence for the current problem.",
    insertText: "Search the web for additional evidence relevant to this workspace and summarize top findings.",
    category: "Research",
    badge: "Research",
    aliases: ["web", "search"],
  },
  {
    id: "/competitor-v3",
    label: "Run Competitor V3",
    description: "Run the V3 competitor finder with evidence-backed synthesis.",
    insertText: "Run the V3 competitor finder in deep mode with enrichment and return a ranked shortlist backed by evidence.",
    category: "Research",
    badge: "Research",
    aliases: ["competitor", "v3"],
  },
  {
    id: "/focus-social",
    label: "Focus on TikTok",
    description: "Bias the next answer toward social intelligence and TikTok evidence.",
    category: "Focus",
    badge: "Social",
    aliases: ["tiktok", "social"],
  },
  {
    id: "/new-branch",
    label: "New Branch",
    description: "Fork a what-if branch from this conversation.",
    category: "Workspace",
    badge: "Branch",
    aliases: ["branch", "fork"],
  },
];

interface ChatComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  focusSignal?: number;
  isStreaming: boolean;
  responseMode: "fast" | "balanced" | "deep" | "pro";
  sourceScope: ChatInputSourceScope;
  onResponseModeChange: (mode: "fast" | "balanced" | "deep" | "pro") => void;
  onSourceScopeChange: (key: keyof ChatInputSourceScope, value: boolean) => void;
  queuedMessages: QueuedMessage[];
  onSend: (
    content: string,
    mode: "send" | "queue" | "interrupt",
    options?: { attachmentIds?: string[]; documentIds?: string[] }
  ) => void;
  onUploadDocuments: (files: File[]) => Promise<UploadedDocumentChip[]>;
  onUploadError?: (message: string, code?: string) => void;
  canAttach?: boolean;
  attachDisabledReason?: string;
  uploadAccept?: string;
  onSteerRun: (note: string) => void;
  onSteerQueued: (
    id: string,
    input: {
      content?: string;
      inputOptions?: ChatInputOptions;
      steerNote?: string;
      runNow?: boolean;
    }
  ) => void;
  onStop: () => void;
  onReorderQueue: (from: number, to: number) => void;
  onDeleteQueued: (id: string) => void;
  onSteer: (chip: string) => void;
  onCommandSelect?: (commandId: string) => void;
  branchContext?: ComposerBranchContext | null;
  onClearBranchContext?: () => void;
  contentWidthClassName?: string;
}

function defaultTargetLengthForMode(mode: "fast" | "balanced" | "deep" | "pro"): "short" | "medium" | "long" {
  if (mode === "fast") return "short";
  if (mode === "deep" || mode === "pro") return "long";
  return "medium";
}

function compactScopeBadges(scope: ChatInputSourceScope): string[] {
  const labels: string[] = [];
  if (scope.workspaceData) labels.push("Workspace");
  if (scope.uploadedDocs) labels.push("Docs");
  if (scope.webSearch) labels.push("Web");
  if (scope.socialIntel) labels.push("Social");
  if (scope.liveWebsiteCrawl) labels.push("Crawl");
  if (scope.libraryPinned) labels.push("Pinned");
  return labels.slice(0, 4);
}

function summarizeScope(scope: ChatInputSourceScope): string {
  const badges = compactScopeBadges(scope);
  if (!badges.length) return "Scope";
  if (badges.length === 1) return badges[0];
  return `${badges[0]} +${badges.length - 1}`;
}

function resolveComposerPlaceholder(context?: ComposerBranchContext | null): string {
  if (context?.kind === "document_edit") {
    return "Describe how you want this passage or document changed...";
  }
  if (context?.kind === "document_quote") {
    return "Ask BAT to use, rewrite, or build on this selection...";
  }
  if (context?.kind === "message_reply") {
    return "Continue this branch...";
  }
  return "Message BAT... Type / for commands";
}

function branchKindLabel(context?: ComposerBranchContext | null): string {
  if (context?.kind === "document_edit") return "Editing document branch";
  if (context?.kind === "document_quote") return "Replying to document excerpt";
  if (context?.kind === "message_reply") return "Reply branch";
  return "Conversation";
}

function branchQuickActions(context?: ComposerBranchContext | null): Array<{ label: string; value: string }> {
  if (context?.kind === "document_edit") {
    return [
      { label: "Tighten", value: "Tighten this excerpt and remove filler while keeping the meaning intact." },
      { label: "Executive", value: "Rewrite this excerpt to sound more executive, decisive, and client-ready." },
      { label: "Sharper", value: "Make this excerpt more strategic, specific, and commercially useful." },
    ];
  }
  if (context?.kind === "document_quote") {
    return [
      { label: "Use in reply", value: "Use this excerpt directly in the answer and build on it." },
      { label: "Summarize", value: "Summarize the point of this excerpt in sharper language." },
      { label: "Challenge", value: "Challenge the assumptions in this excerpt and suggest a stronger angle." },
    ];
  }
  return [];
}

function pickSlashCommands(ids: string[]): SlashCommandItem[] {
  return ids
    .map((id) => slashCommands.find((command) => command.id === id) || null)
    .filter((command): command is SlashCommandItem => Boolean(command));
}

export function ChatComposer({
  draft,
  onDraftChange,
  focusSignal,
  isStreaming,
  responseMode,
  sourceScope,
  onResponseModeChange,
  onSourceScopeChange,
  queuedMessages,
  onSend,
  onUploadDocuments,
  onUploadError,
  canAttach = true,
  attachDisabledReason,
  uploadAccept = ".pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.html,.htm,.pptx,.png,.jpg,.jpeg,.webp,.gif",
  onSteerRun,
  onSteerQueued,
  onStop,
  onReorderQueue,
  onDeleteQueued,
  onSteer,
  onCommandSelect,
  branchContext,
  onClearBranchContext,
  contentWidthClassName = "max-w-3xl",
}: ChatComposerProps) {
  const [showControls, setShowControls] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [expandedSteerId, setExpandedSteerId] = useState<string | null>(null);
  const [steerEdits, setSteerEdits] = useState<Record<string, string>>({});
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocumentChip[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showIdleSlashSurface, setShowIdleSlashSurface] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const optionsMenuRef = useRef<HTMLDivElement | null>(null);

  const currentInputOptions = useMemo<ChatInputOptions>(
    () => ({
      modeLabel: responseMode,
      sourceScope,
      targetLength: defaultTargetLengthForMode(responseMode),
      strictValidation: responseMode === "pro",
    }),
    [responseMode, sourceScope]
  );

  const slashQuery = useMemo(() => {
    const trimmedStart = draft.trimStart();
    if (!trimmedStart.startsWith("/")) return null;
    return trimmedStart.split(/\s+/)[0].toLowerCase();
  }, [draft]);

  const slashMatches = useMemo(() => {
    if (!slashQuery) return [];
    const normalizedQuery = slashQuery.replace(/^\//, "");
    return slashCommands.filter((command) => {
      if (command.requiresDocument && !branchContext?.documentId) return false;
      return (
        !normalizedQuery ||
        command.id.includes(slashQuery) ||
        command.label.toLowerCase().includes(normalizedQuery) ||
        command.description.toLowerCase().includes(normalizedQuery) ||
        (command.aliases || []).some((alias) => alias.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [branchContext?.documentId, slashQuery]);

  const slashPills = useMemo(() => slashCommands.filter((command) => command.pill), []);
  const idleSlashCommands = useMemo(
    () =>
      pickSlashCommands(
        branchContext?.documentId
          ? [
              "/go-deeper",
              "/show-sources",
              "/make-pdf",
              "/focus-web",
              "/edit-doc",
              "/rewrite-selection",
              "/quote-doc",
              "/mode-balanced",
              "/mode-deep",
              "/mode-pro",
            ]
          : [
              "/go-deeper",
              "/show-sources",
              "/make-pdf",
              "/focus-web",
              "/mode-fast",
              "/mode-balanced",
              "/mode-deep",
              "/mode-pro",
              "/web",
              "/new-branch",
            ]
      ),
    [branchContext?.documentId]
  );
  const showSlashSurface = (!showControls && slashMatches.length > 0) || (!showControls && showIdleSlashSurface && draft.trim().length === 0);
  const visibleSlashCommands = slashMatches.length > 0 ? slashMatches.slice(0, 10) : idleSlashCommands;

  useEffect(() => {
    setActiveSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (draft.trim().length > 0 && showIdleSlashSurface) {
      setShowIdleSlashSurface(false);
      return;
    }
    if (draft.trim().length === 0 && document.activeElement === textareaRef.current) {
      setShowIdleSlashSurface(true);
    }
  }, [draft, showIdleSlashSurface]);

  useEffect(() => {
    if (!showControls) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (optionsMenuRef.current?.contains(event.target)) return;
      setShowControls(false);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setShowControls(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showControls]);

  useEffect(() => {
    if (typeof focusSignal !== "number") return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const cursor = textarea.value.length;
    textarea.setSelectionRange(cursor, cursor);
  }, [focusSignal]);

  const dispatchMessage = (modeOverride?: "send" | "queue" | "interrupt") => {
    const content = draft.trim();
    if (!content && uploadedDocs.length === 0 && !branchContext) {
      return false;
    }

    onSend(content, modeOverride || (isStreaming ? "queue" : "send"), {
      attachmentIds: uploadedDocs.map((item) => item.attachmentId).filter((value): value is string => Boolean(value)),
      documentIds: [
        ...uploadedDocs.map((item) => item.id).filter(Boolean),
        ...(branchContext?.documentId ? [branchContext.documentId] : []),
      ],
    });
    onDraftChange("");
    setUploadedDocs([]);
    setShowIdleSlashSurface(false);
    return true;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatchMessage();
  };

  const applySlashCommand = (command: SlashCommandItem) => {
    onCommandSelect?.(command.id);
    setShowIdleSlashSurface(false);
    if (command.insertText) {
      onDraftChange(command.insertText);
      textareaRef.current?.focus();
      return;
    }
    onDraftChange("");
    textareaRef.current?.focus();
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActiveSlashIndex((current) => {
        if (!slashMatches.length) return 0;
        if (event.key === "ArrowDown") return (current + 1) % slashMatches.length;
        return (current - 1 + slashMatches.length) % slashMatches.length;
      });
      return;
    }
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.nativeEvent.isComposing) return;
    if (slashMatches.length && draft.trimStart().startsWith("/")) {
      event.preventDefault();
      const selected = slashMatches[Math.max(0, Math.min(activeSlashIndex, slashMatches.length - 1))] || slashMatches[0];
      if (selected) applySlashCommand(selected);
      return;
    }
    event.preventDefault();

    if (event.metaKey || event.ctrlKey) {
      dispatchMessage("interrupt");
      return;
    }

    dispatchMessage();
  };

  const steerRunNow = () => {
    if (!isStreaming) return;
    const content = draft.trim();
    if (!content) return;
    onSteerRun(content);
    onDraftChange("");
  };

  const uploadFiles = async (files: File[]) => {
    if (!canAttach) {
      const message = attachDisabledReason || "Open or select a branch to attach files.";
      setUploadError(message);
      onUploadError?.(message, "UPLOAD_BRANCH_NOT_READY");
      return;
    }
    const valid = files.filter((file) => file.size > 0);
    if (!valid.length) return;
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await onUploadDocuments(valid);
      setUploadedDocs((previous) => {
        const next = [...previous];
        for (const item of uploaded) {
          if (next.some((existing) => existing.id === item.id)) continue;
          next.push(item);
        }
        return next.slice(0, 10);
      });
    } catch (error) {
      const message = String((error as Error)?.message || "Upload failed");
      const code =
        typeof (error as { code?: unknown })?.code === "string"
          ? String((error as { code?: unknown }).code)
          : undefined;
      setUploadError(message);
      onUploadError?.(message, code);
    } finally {
      setUploading(false);
    }
  };

  const openFilePicker = () => {
    if (!canAttach) {
      const message = attachDisabledReason || "Open or select a branch to attach files.";
      setUploadError(message);
      onUploadError?.(message, "UPLOAD_BRANCH_NOT_READY");
      return;
    }
    const input = fileInputRef.current;
    if (!input) return;
    setUploadError(null);
    try {
      const maybePicker = input as HTMLInputElement & { showPicker?: () => void };
      if (typeof maybePicker.showPicker === "function") {
        maybePicker.showPicker();
        return;
      }
      input.click();
    } catch (error) {
      const message = String((error as Error)?.message || "Could not open file picker");
      setUploadError(message);
      onUploadError?.(message, "UPLOAD_PICKER_FAILED");
      try {
        input.click();
      } catch {
        // no-op
      }
    }
  };

  const readSteerDraft = (item: QueuedMessage): string => {
    const edited = steerEdits[item.id];
    if (typeof edited === "string") return edited;
    return item.steer?.note || "";
  };

  const branchActions = branchQuickActions(branchContext);
  const showComposerStatusRow = isStreaming || queuedMessages.length > 0;

  return (
    <section className="bat-composer-shell sticky bottom-0 z-20 border-t border-zinc-200/80 bg-white/96 px-0 pb-2 pt-2 backdrop-blur-xl">
      <div className={`mx-auto w-full ${contentWidthClassName} px-2 sm:px-3 xl:px-4`}>
        {showComposerStatusRow ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-zinc-500">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 ${isStreaming ? "text-emerald-700" : "text-zinc-500"}`}>
                <span className={`h-2 w-2 rounded-full ${isStreaming ? "bg-emerald-500" : "bg-zinc-300"}`} />
                {isStreaming ? "Generating response" : "Ready"}
              </span>
              <span className="hidden text-zinc-400 sm:inline">Type `/` for actions</span>
            </div>
            {queuedMessages.length ? (
              <button
                type="button"
                onClick={() => setShowQueue((previous) => !previous)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-zinc-600 shadow-sm hover:bg-zinc-50"
              >
                <ListOrdered className="h-3.5 w-3.5" />
                Queue {queuedMessages.length}
              </button>
            ) : null}
          </div>
        ) : null}

        {showQueue && queuedMessages.length > 0 ? (
          <div className="bat-composer-queue mb-2 rounded-2xl border border-zinc-200 bg-zinc-50/85 p-2.5">
            <div className="bat-scrollbar max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {queuedMessages.map((item, index) => {
                const options = item.inputOptions || currentInputOptions;
                const badges = compactScopeBadges(options.sourceScope);
                const steerDraft = readSteerDraft(item);
                const showSteerEditor = expandedSteerId === item.id;
                return (
                  <div key={item.id} className="bat-composer-queue-item rounded-xl border border-zinc-200 bg-white p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Queued {item.position || index + 1}</p>
                        <p className="text-sm text-zinc-700">{item.content}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                            {options.modeLabel}
                          </span>
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                            {options.targetLength}
                          </span>
                          {item.documentIds?.length ? (
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                              Docs {item.documentIds.length}
                            </span>
                          ) : null}
                          {item.attachmentIds?.length ? (
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                              Files {item.attachmentIds.length}
                            </span>
                          ) : null}
                          {badges.map((badge) => (
                            <span key={`${item.id}-${badge}`} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                              {badge}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Move up"
                          onClick={() => onReorderQueue(index, index - 1)}
                          className="rounded-md border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-100"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          onClick={() => onReorderQueue(index, index + 1)}
                          className="rounded-md border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-100"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove"
                          onClick={() => onDeleteQueued(item.id)}
                          className="rounded-md border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Steer queued message"
                          onClick={() => {
                            setExpandedSteerId((current) => (current === item.id ? null : item.id));
                            if (steerEdits[item.id] === undefined) {
                              setSteerEdits((prev) => ({
                                ...prev,
                                [item.id]: item.steer?.note || "",
                              }));
                            }
                          }}
                          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                        >
                          Steer
                        </button>
                      </div>
                    </div>

                    {showSteerEditor ? (
                      <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                        <textarea
                          value={steerDraft}
                          onChange={(event) =>
                            setSteerEdits((prev) => ({
                              ...prev,
                              [item.id]: event.target.value,
                            }))
                          }
                          placeholder="Add steer note for this queued message"
                          className="min-h-16 w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onSteerQueued(item.id, {
                                steerNote: steerDraft,
                                inputOptions: options,
                              })
                            }
                            className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
                          >
                            Save steer
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onSteerQueued(item.id, {
                                steerNote: steerDraft,
                                inputOptions: options,
                                runNow: true,
                              })
                            }
                            className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-800"
                          >
                            Steer + run now
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <form
          onSubmit={submit}
          className="relative"
          onDrop={(event) => {
            event.preventDefault();
            const dropped = Array.from(event.dataTransfer?.files || []);
            void uploadFiles(dropped);
          }}
          onDragOver={(event) => event.preventDefault()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={uploadAccept}
            className="hidden"
            onChange={(event) => {
              const nextFiles = Array.from(event.target.files || []);
              void uploadFiles(nextFiles);
              event.currentTarget.value = "";
            }}
          />

          <div className="bat-composer-card overflow-hidden rounded-[1.5rem] border border-zinc-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] shadow-[0_18px_42px_-28px_rgba(15,23,42,0.45)]">
            {branchContext ? (
              <div className="bat-composer-branch border-b border-zinc-200/90 bg-[linear-gradient(180deg,#fafafa_0%,#f4f5f6_100%)] px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="flex shrink-0 flex-col items-center">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-zinc-900" />
                    <span className="mt-1 h-8 w-px bg-zinc-300" />
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 shadow-sm">
                    {branchContext.kind === "document_edit" ? <Sparkles className="h-4 w-4" /> : <GitBranch className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-zinc-200 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white">
                        {branchKindLabel(branchContext)}
                      </span>
                      <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700">
                        {branchContext.commandHint || (branchContext.kind === "document_edit" ? "/edit-doc" : "/quote-doc")}
                      </span>
                      {typeof branchContext.versionNumber === "number" && branchContext.versionNumber > 0 ? (
                        <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-500">
                          v{branchContext.versionNumber}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-zinc-900">{branchContext.title}</p>
                    {branchContext.subtitle ? <p className="text-xs text-zinc-500">{branchContext.subtitle}</p> : null}
                    {branchContext.quotedText ? (
                      <p className="mt-1 line-clamp-2 border-l-2 border-zinc-300 pl-2 text-xs text-zinc-600">
                        {branchContext.quotedText}
                      </p>
                    ) : null}
                    {branchActions.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {branchActions.map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            onClick={() => onDraftChange(action.value)}
                            className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={onClearBranchContext}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100"
                    aria-label="Clear scoped document context"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}

            <div className="relative">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  onDraftChange(nextValue);
                  setShowIdleSlashSurface(nextValue.trim().length === 0);
                }}
                onKeyDown={onComposerKeyDown}
                onFocus={() => {
                  if (!draft.trim()) {
                    setShowIdleSlashSurface(true);
                  }
                }}
                onBlur={() => setShowIdleSlashSurface(false)}
                onPaste={(event) => {
                  const pastedFiles = Array.from(event.clipboardData?.files || []);
                  if (pastedFiles.length > 0) {
                    event.preventDefault();
                    void uploadFiles(pastedFiles);
                  }
                }}
                placeholder={resolveComposerPlaceholder(branchContext)}
                className="bat-composer-input min-h-[7.2rem] w-full resize-none border-0 bg-transparent px-4 pb-16 pt-3.5 text-[15px] leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 sm:min-h-[8.2rem]"
              />

              {uploadedDocs.length > 0 ? (
                <div className="pointer-events-auto absolute left-4 right-4 top-3 flex flex-wrap gap-2">
                  {uploadedDocs.map((doc) => (
                    <span
                      key={doc.id}
                      className="bat-composer-upload-pill inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 shadow-sm"
                    >
                      <FileText className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="max-w-[180px] truncate">{doc.fileName}</span>
                      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                        {doc.status === "needs_review" ? "review" : doc.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => setUploadedDocs((previous) => previous.filter((item) => item.id !== doc.id))}
                        className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        aria-label="Remove attached document"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {showSlashSurface ? (
                <div className="bat-composer-slash-surface absolute bottom-[4.6rem] left-2 right-2 z-10 rounded-[1.75rem] border border-zinc-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,248,248,0.98)_100%)] p-2.5 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                  <div className="mb-2 flex items-center justify-between px-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      {slashMatches.length ? "Slash Commands" : "Start With An Action"}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {slashMatches.length ? "Modes, focus, docs, exports" : "Pick the lane before you write"}
                    </p>
                  </div>
                  <div className="bat-scrollbar mb-2 flex flex-wrap gap-2.5 px-1.5 pb-1">
                    {slashPills.map((command) => (
                      <button
                        key={command.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applySlashCommand(command)}
                        className="bat-composer-slash-pill min-h-11 whitespace-nowrap rounded-full border border-zinc-200/90 bg-white px-5 py-2.5 text-[15px] font-medium text-zinc-700 shadow-[0_1px_0_rgba(255,255,255,0.9),0_8px_20px_-18px_rgba(15,23,42,0.35)] transition hover:border-zinc-300 hover:bg-zinc-50"
                      >
                        {command.label}
                      </button>
                    ))}
                  </div>
                  <div className="mb-2 flex items-center justify-between px-1.5">
                    <p className="text-[11px] text-zinc-500">
                      {slashMatches.length
                        ? "Modes, focus presets, document actions, and deliverables."
                        : "Pick a mode, focus, or deliverable before you start writing."}
                    </p>
                    <p className="text-[11px] text-zinc-400">{slashMatches.length ? "Enter to run" : "Click to start"}</p>
                  </div>
                  <div className="space-y-1">
                    {visibleSlashCommands.map((command, index) => (
                      <button
                        key={command.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applySlashCommand(command)}
                        className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
                          slashMatches.length && index === activeSlashIndex
                            ? "border-zinc-200 bg-zinc-100/90"
                            : "border-transparent bg-white/65 hover:border-zinc-200 hover:bg-white"
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                              {command.id}
                            </span>
                            <span className="text-xs font-medium text-zinc-900">{command.label}</span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">{command.description}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                            {command.category}
                          </span>
                          {command.badge ? (
                            <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-500">
                              {command.badge}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="pointer-events-none absolute bottom-12 left-4 right-32 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                <span>
                  {branchContext
                    ? "Scoped branch active"
                    : showIdleSlashSurface && !draft.trim()
                      ? "Choose an action or start typing"
                      : "Enter to send, Shift+Enter for newline"}
                </span>
                <span>
                  {isStreaming
                    ? "Cmd/Ctrl+Enter interrupts + sends"
                    : showIdleSlashSurface && !draft.trim()
                      ? "Type / to search all commands"
                      : "Type / for quick actions"}
                </span>
              </div>

              <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={openFilePicker}
                    disabled={uploading || !canAttach}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                    title={uploading ? "Uploading..." : "Attach documents"}
                    aria-label={uploading ? "Uploading documents" : "Attach documents"}
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <div ref={optionsMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setShowControls((previous) => !previous)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm hover:bg-zinc-100"
                      title="More options"
                      aria-label="More options"
                    >
                      {showControls ? <X className="h-4 w-4" /> : <MoreHorizontal className="h-4 w-4" />}
                    </button>
                    {showControls ? (
                      <div className="absolute bottom-12 left-0 z-20 w-[21rem] rounded-2xl border border-zinc-200 bg-white/98 p-3 shadow-2xl backdrop-blur">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Options</p>
                            <p className="text-xs text-zinc-500">Modes and evidence controls, closer to ChatGPT.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowControls(false)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 hover:bg-zinc-100"
                            aria-label="Close options"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Mode</p>
                          <div className="grid grid-cols-2 gap-2">
                            {(["fast", "balanced", "deep", "pro"] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => {
                                  onResponseModeChange(mode);
                                  setShowControls(false);
                                }}
                                className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                                  responseMode === mode
                                    ? "border-zinc-900 bg-zinc-900 text-white"
                                    : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                                }`}
                              >
                                <span className="block font-medium capitalize">{mode}</span>
                                <span className={`mt-0.5 block text-[11px] ${responseMode === mode ? "text-white/75" : "text-zinc-500"}`}>
                                  {mode === "fast"
                                    ? "Shorter, quicker"
                                    : mode === "balanced"
                                      ? "Default depth"
                                      : mode === "deep"
                                        ? "Longer synthesis"
                                        : "Strictest quality"}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Quick Actions</p>
                          <div className="flex flex-wrap gap-2">
                            {["Go deeper", "Show sources", "Make it a PDF", "Focus on Web evidence"].map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => {
                                  onSteer(chip);
                                  setShowControls(false);
                                }}
                                className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
                              >
                                {chip}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Evidence Scope</p>
                          <div className="bat-scrollbar flex flex-wrap gap-2 overflow-x-auto">
                            {sourceScopeOptions.map((option) => {
                              const active = sourceScope[option.key];
                              return (
                                <button
                                  key={option.key}
                                  type="button"
                                  onClick={() => onSourceScopeChange(option.key, !active)}
                                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                                    active
                                      ? "bg-zinc-900 text-white"
                                      : "border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                                  }`}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={onStop}
                      className="inline-flex h-10 items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 text-xs text-zinc-600 shadow-sm hover:bg-zinc-100"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </button>
                  ) : null}
                  {isStreaming && draft.trim() ? (
                    <button
                      type="button"
                      onClick={steerRunNow}
                      className="inline-flex h-10 items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 text-xs text-zinc-600 shadow-sm hover:bg-zinc-100"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Steer
                    </button>
                  ) : null}
                </div>
                <button
                  type="submit"
                  disabled={!draft.trim() && uploadedDocs.length === 0 && !branchContext}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                  aria-label={isStreaming ? "Queue message" : "Send message"}
                  title={isStreaming ? "Queue message" : "Send message"}
                >
                  <SendHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {!canAttach && attachDisabledReason ? (
            <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {attachDisabledReason}
            </div>
          ) : null}
          {uploadError ? (
            <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {uploadError}
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
