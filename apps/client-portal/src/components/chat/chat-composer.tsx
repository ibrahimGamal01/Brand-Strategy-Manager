"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileText, ListOrdered, Paperclip, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import { ChatInputOptions, ChatInputSourceScope, QueuedMessage, UploadedDocumentChip } from "@/types/chat";

const steerChipSet = [
  "Run V3 finder",
  "Go deeper",
  "Show sources",
  "Make it a PDF",
  "Focus on TikTok",
  "Focus on Web evidence",
  "Ask me questions first",
];

const sourceScopeOptions: Array<{ key: keyof ChatInputSourceScope; label: string }> = [
  { key: "workspaceData", label: "Workspace data" },
  { key: "libraryPinned", label: "Library pinned" },
  { key: "uploadedDocs", label: "Uploaded docs" },
  { key: "webSearch", label: "Web search" },
  { key: "liveWebsiteCrawl", label: "Live website crawl" },
  { key: "socialIntel", label: "Social intelligence" },
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
  onSteerQueued: (id: string, input: {
    content?: string;
    inputOptions?: ChatInputOptions;
    steerNote?: string;
    runNow?: boolean;
  }) => void;
  onStop: () => void;
  onReorderQueue: (from: number, to: number) => void;
  onDeleteQueued: (id: string) => void;
  onSteer: (chip: string) => void;
  contentWidthClassName?: string;
}

function defaultTargetLengthForMode(mode: "fast" | "balanced" | "deep" | "pro"): "short" | "medium" | "long" {
  if (mode === "fast") return "short";
  if (mode === "deep" || mode === "pro") return "long";
  return "medium";
}

function compactScopeBadges(scope: ChatInputSourceScope): string[] {
  const labels: string[] = [];
  if (scope.webSearch) labels.push("Web");
  if (scope.liveWebsiteCrawl) labels.push("Crawl");
  if (scope.socialIntel) labels.push("Social");
  if (scope.uploadedDocs) labels.push("Docs");
  if (scope.libraryPinned) labels.push("Pinned");
  if (scope.workspaceData) labels.push("Workspace");
  return labels.slice(0, 4);
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
  contentWidthClassName = "max-w-3xl",
}: ChatComposerProps) {
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [expandedSteerId, setExpandedSteerId] = useState<string | null>(null);
  const [steerEdits, setSteerEdits] = useState<Record<string, string>>({});
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocumentChip[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentInputOptions = useMemo<ChatInputOptions>(
    () => ({
      modeLabel: responseMode,
      sourceScope,
      targetLength: defaultTargetLengthForMode(responseMode),
      strictValidation: responseMode === "pro",
    }),
    [responseMode, sourceScope]
  );

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
    if (!content && uploadedDocs.length === 0) {
      return false;
    }

    onSend(content, modeOverride || (isStreaming ? "queue" : "send"), {
      attachmentIds: uploadedDocs.map((item) => item.attachmentId).filter((value): value is string => Boolean(value)),
      documentIds: uploadedDocs.map((item) => item.id).filter(Boolean),
    });
    onDraftChange("");
    setUploadedDocs([]);
    return true;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatchMessage();
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.nativeEvent.isComposing) return;
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

  return (
    <section className="sticky bottom-0 z-20 border-t border-zinc-200 bg-white/98 px-0 pb-1.5 pt-1.5 backdrop-blur">
      <div className={`mx-auto w-full ${contentWidthClassName} px-3 sm:px-4 xl:px-6`}>
        {showAdvancedControls ? (
          <div className="mb-1.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-1 py-1">
              {(["fast", "balanced", "deep", "pro"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onResponseModeChange(mode)}
                  className={`rounded-full px-2.5 py-1 capitalize ${
                    responseMode === mode ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="bat-scrollbar inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-zinc-200 bg-white px-1 py-1">
              {sourceScopeOptions.map((option) => {
                const active = sourceScope[option.key];
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => onSourceScopeChange(option.key, !active)}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 ${
                      active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            </div>
            <div className="bat-scrollbar flex gap-1.5 overflow-x-auto pb-1">
              {steerChipSet.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => onSteer(chip)}
                  className="whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={`rounded-md px-2 py-0.5 ${isStreaming ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
              {isStreaming ? "Generating" : "Ready"}
            </span>
            {queuedMessages.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-zinc-600">
                <ListOrdered className="h-3.5 w-3.5" />
                Queue {queuedMessages.length}
              </span>
            ) : null}
            {isStreaming ? (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                Active run: Enter queues, Cmd/Ctrl+Enter interrupts + sends
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedControls((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {showAdvancedControls ? "Hide controls" : "Controls"}
          </button>
        </div>

        {showAdvancedControls && queuedMessages.length > 0 ? (
          <div className="mb-1.5 rounded-md border border-zinc-200 bg-zinc-50/90 p-2">
            <div className="bat-scrollbar max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {queuedMessages.map((item, index) => {
                const options = item.inputOptions || currentInputOptions;
                const scopeBadges = compactScopeBadges(options.sourceScope);
                const steerDraft = readSteerDraft(item);
                const showSteerEditor = expandedSteerId === item.id;
                return (
                  <div key={item.id} className="rounded-md border border-zinc-200 bg-white p-2">
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
                          {scopeBadges.map((badge) => (
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
                      <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                        <textarea
                          value={steerDraft}
                          onChange={(event) =>
                            setSteerEdits((prev) => ({
                              ...prev,
                              [item.id]: event.target.value,
                            }))
                          }
                          placeholder="Add steer note for this queued message"
                          className="min-h-16 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
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
                            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
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
                            className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs text-white hover:bg-zinc-800"
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
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onComposerKeyDown}
            onPaste={(event) => {
              const pastedFiles = Array.from(event.clipboardData?.files || []);
              if (pastedFiles.length > 0) {
                event.preventDefault();
                void uploadFiles(pastedFiles);
              }
            }}
            placeholder="Message BAT..."
            className="min-h-20 w-full resize-none rounded-md border border-zinc-300 bg-white px-3.5 pb-12 pt-2.5 text-[15px] text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 sm:min-h-24"
          />

          {uploadedDocs.length > 0 ? (
              <div className="pointer-events-auto absolute left-3.5 right-3.5 top-3 flex flex-wrap gap-2">
              {uploadedDocs.map((doc) => (
                <span
                  key={doc.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700"
                >
                  <FileText className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="max-w-[180px] truncate">{doc.fileName}</span>
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                    {doc.status === "needs_review" ? "review" : doc.status}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setUploadedDocs((previous) => previous.filter((item) => item.id !== doc.id))
                    }
                    className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                    aria-label="Remove attached document"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <p className="pointer-events-none absolute bottom-3 left-3.5 text-[11px] text-zinc-400">
            Enter to send/queue, Shift+Enter for newline, Cmd/Ctrl+Enter to interrupt + send
          </p>
          {!canAttach && attachDisabledReason ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {attachDisabledReason}
            </div>
          ) : null}
          {uploadError ? (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {uploadError}
            </div>
          ) : null}

          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={uploading || !canAttach}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              title="Attach documents"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {uploading ? "Uploading..." : "Attach"}
            </button>
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
            ) : null}
            {isStreaming && draft.trim() ? (
              <button
                type="button"
                onClick={steerRunNow}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Steer
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!draft.trim() && uploadedDocs.length === 0}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              aria-label={isStreaming ? "Queue message" : "Send message"}
              title={isStreaming ? "Queue message" : "Send message"}
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
