"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, ExternalLink, FileText, MoreHorizontal, Quote, Sparkles, X } from "lucide-react";
import { ChatMessage, ChatMessageBlock } from "@/types/chat";
import { ChatMarkdown } from "./chat-markdown";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500/90" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500/90" style={{ animationDelay: "140ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500/90" style={{ animationDelay: "280ms" }} />
    </span>
  );
}

function formatMessageTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatMessageContentForDisplay(content: string): string {
  return content
    .replace(/@libraryRef\[([^\]|]+)\|([^\]]+)\]/g, (_match, _ref, title: string) => `[Library source: ${title}]`)
    .replace(/@library\[([^\]|]+)\|([^\]]+)\]/g, (_match, _id, title: string) => `[Library source: ${title}]`);
}

type ParsedScopedMessage =
  | {
      kind: "document_edit" | "document_quote";
      title: string;
      versionLabel?: string;
      subtitle?: string;
      quote?: string;
      request: string;
    }
  | null;

function parseScopedMessage(content: string): ParsedScopedMessage {
  const raw = String(content || "").trim();
  if (!raw) return null;

  const editMatch = raw.match(/^Document edit branch:\s+(.+?)\s+\(([^)]+)\)\.\s*/i);
  const quoteMatch = raw.match(/^Document quote branch:\s+(.+?)\s+\(([^)]+)\)\.\s*/i);
  const match = editMatch || quoteMatch;
  if (!match) return null;

  const kind = editMatch ? "document_edit" : "document_quote";
  const title = String(match[1] || "").trim();
  const versionLabel = String(match[2] || "").trim();
  const remainder = raw.slice(match[0].length).trim();

  const subtitleMatch = remainder.match(/^Context:\s+(.+)$/im);
  const editRequestMatch = remainder.match(/^Edit request:\s+([\s\S]+?)(?:\n\nReturn revised wording first[\s\S]*|$)/i);
  const requestMatch = remainder.match(/^Request:\s+([\s\S]+)$/im);
  const quoteBlockMatch = remainder.match(/(?:Quoted excerpt|Selected excerpt):\s*\n([\s\S]+?)(?:\n\n(?:Edit request|Request):|\n\nReturn revised wording first|$)/i);

  const cleanedQuote = String(quoteBlockMatch?.[1] || "")
    .split(/\r?\n/g)
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
  const request = String(editRequestMatch?.[1] || requestMatch?.[1] || "")
    .replace(/\n+/g, " ")
    .trim();

  if (!request) return null;

  return {
    kind,
    title,
    ...(versionLabel ? { versionLabel } : {}),
    ...(subtitleMatch?.[1] ? { subtitle: subtitleMatch[1].trim() } : {}),
    ...(cleanedQuote ? { quote: cleanedQuote } : {}),
    request,
  };
}

function isDocumentWorkflowAssistantMessage(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;
  return (message.blocks || []).some((block) =>
    block.type === "document_edit_proposal" ||
    block.type === "document_edit_applied" ||
    block.type === "document_export_result" ||
    block.type === "document_artifact" ||
    block.type === "document_ready" ||
    block.type === "document_parse_needs_review"
  );
}

function formatDocTypeLabel(value?: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "Document";
  return normalized
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeArtifactHref(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/storage/")) return normalized;
  if (normalized.startsWith("storage/")) return `/${normalized}`;
  if (normalized.startsWith("./storage/")) return `/${normalized.slice(2)}`;
  return normalized;
}

function scoreTone(score?: number): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "border-zinc-200 bg-zinc-50 text-zinc-700";
  if (score >= 85) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (score >= 72) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function qualityDimensions(
  value?:
    | {
        grounding: number;
        specificity: number;
        usefulness: number;
        redundancy: number;
        tone: number;
        visual: number;
      }
    | null
) {
  if (!value) return [];
  return [
    ["Grounding", value.grounding],
    ["Specificity", value.specificity],
    ["Usefulness", value.usefulness],
    ["Redundancy", value.redundancy],
    ["Tone", value.tone],
    ["Visual", value.visual],
  ].filter((entry) => Number.isFinite(entry[1]));
}

type ArtifactPreviewInput = {
  title: string;
  href: string;
  documentId?: string;
  docType?: string;
  family?: string;
  versionNumber?: number;
  previewModeDefault?: "pdf" | "markdown";
};

type ArtifactQuoteInput = {
  title: string;
  quotedText: string;
  documentId?: string;
  family?: string;
  versionNumber?: number;
};

type OverflowAction =
  | {
      key: string;
      label: string;
      href: string;
    }
  | {
      key: string;
      label: string;
      onSelect: () => void;
    };

function OverflowActionsMenu({ actions }: { actions: OverflowAction[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!actions.length) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100"
        aria-label="More actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
          {actions.map((action) =>
            "href" in action ? (
              <a
                key={action.key}
                href={action.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.key}
                type="button"
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100"
              >
                {action.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

function scopedArtifactInput(input: {
  title: string;
  scopedMessage: Exclude<ParsedScopedMessage, null>;
  documentId?: string;
}): ArtifactQuoteInput {
  return {
    title: input.title,
    quotedText: input.scopedMessage.quote || input.scopedMessage.request,
    ...(input.documentId ? { documentId: input.documentId } : {}),
    ...(input.scopedMessage.versionLabel
      ? {
          versionNumber: Number(String(input.scopedMessage.versionLabel || "").replace(/[^\d]/g, "")) || undefined,
        }
      : {}),
  };
}

function ScopedMessageTools({
  scopedMessage,
  documentId,
  onQuote,
  onAskEdit,
  onRunAction,
}: {
  scopedMessage: Exclude<ParsedScopedMessage, null>;
  documentId?: string;
  onQuote?: (input: ArtifactQuoteInput) => void;
  onAskEdit?: (input: ArtifactQuoteInput) => void;
  onRunAction?: (label: string, action: string, payload?: Record<string, unknown>) => void;
}) {
  if (!documentId) return null;

  const title = scopedMessage.title || "Document";
  const quoteInput = scopedArtifactInput({ title, scopedMessage, documentId });
  const overflowActions: OverflowAction[] = [
    {
      key: `${documentId}-open-docs`,
      label: "Open in docs",
      onSelect: () => onRunAction?.("Open in docs", "document.read", { documentId }),
    },
    {
      key: `${documentId}-export-pdf`,
      label: "Make PDF",
      onSelect: () => onRunAction?.("Make PDF", "document.export", { documentId, format: "PDF" }),
    },
  ];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {scopedMessage.kind === "document_quote" ? (
        <button
          type="button"
          onClick={() => onQuote?.(quoteInput)}
          className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          Quote in chat
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onAskEdit?.(quoteInput)}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
      >
        Edit in branch
      </button>
      <OverflowActionsMenu actions={overflowActions} />
    </div>
  );
}

function compactQuote(value: string, maxChars = 1400): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function ReasoningPanel({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);

  if (!message.reasoning) {
    return null;
  }

  return (
    <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50/90 p-2.5">
      <button
        type="button"
        className="flex w-full items-center justify-between text-sm font-semibold text-zinc-700"
        onClick={() => setOpen((prev) => !prev)}
      >
        How BAT got here
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="mt-3 space-y-3 text-sm text-zinc-600">
          <div>
            <p className="font-semibold text-zinc-900">Plan</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {message.reasoning.plan.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Tools used</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {message.reasoning.tools.map((tool) => (
                <span key={tool} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600">
                  {tool}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Assumptions</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {message.reasoning.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Next steps</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {message.reasoning.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Evidence</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {message.reasoning.evidence.map((citation) =>
                citation.href ? (
                  <a
                    key={citation.id}
                    href={citation.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                  >
                    {citation.label}
                  </a>
                ) : (
                  <span key={citation.id} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700">
                    {citation.label}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactPreviewDialog({
  preview,
  markdown,
  markdownLoading,
  markdownError,
  onClose,
  onQuote,
  onAskEdit,
  onOpenInDocs,
}: {
  preview: ArtifactPreviewInput;
  markdown: string;
  markdownLoading: boolean;
  markdownError: string | null;
  onClose: () => void;
  onQuote?: (input: ArtifactQuoteInput) => void;
  onAskEdit?: (input: ArtifactQuoteInput) => void;
  onOpenInDocs?: (documentId: string) => void;
}) {
  const [activeView, setActiveView] = useState<"pdf" | "markdown">(preview.previewModeDefault || "markdown");
  const [selectedQuote, setSelectedQuote] = useState("");
  const [selectionToolbar, setSelectionToolbar] = useState<{ x: number; y: number } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const hasPdf = Boolean(preview.href);

  useEffect(() => {
    setActiveView(preview.previewModeDefault || "markdown");
  }, [preview.documentId, preview.href, preview.previewModeDefault]);

  useEffect(() => {
    let frame = 0;
    const updateSelection = () => {
      if (activeView !== "markdown") {
        setSelectedQuote("");
        setSelectionToolbar(null);
        return;
      }
      if (!markdownRef.current || typeof window === "undefined") return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount < 1 || selection.isCollapsed) {
        setSelectedQuote("");
        setSelectionToolbar(null);
        return;
      }
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!anchorNode || !focusNode) {
        setSelectedQuote("");
        setSelectionToolbar(null);
        return;
      }
      if (!markdownRef.current.contains(anchorNode) || !markdownRef.current.contains(focusNode)) {
        setSelectedQuote("");
        setSelectionToolbar(null);
        return;
      }
      const quote = compactQuote(selection.toString());
      setSelectedQuote(quote);
      if (!quote) {
        setSelectionToolbar(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setSelectionToolbar(null);
        return;
      }
      const toolbarWidth = 240;
      const viewportWidth = window.innerWidth;
      const x = Math.min(viewportWidth - toolbarWidth / 2 - 8, Math.max(toolbarWidth / 2 + 8, rect.left + rect.width / 2));
      const y = Math.max(12, rect.top - 40);
      setSelectionToolbar({ x, y });
    };
    const handleSelectionChange = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateSelection);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [activeView]);

  useEffect(() => {
    if (!selectionToolbar) return;
    const clear = () => setSelectionToolbar(null);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [selectionToolbar]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (actionsOpen) {
          setActionsOpen(false);
          return;
        }
        onClose();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (actionsRef.current?.contains(event.target)) return;
      setActionsOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [actionsOpen, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-3" onClick={onClose}>
      <div
        ref={shellRef}
        className="mx-auto flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.25rem] border border-zinc-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">{preview.title}</p>
            <p className="text-xs text-zinc-500">Markdown-first preview with optional rendered PDF</p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 p-0.5">
              <button
                type="button"
                onClick={() => setActiveView("markdown")}
                className={`rounded-full px-3 py-1 text-xs ${
                  activeView === "markdown" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Read
              </button>
              {hasPdf ? (
                <button
                  type="button"
                  onClick={() => setActiveView("pdf")}
                  className={`rounded-full px-3 py-1 text-xs ${
                    activeView === "pdf" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  PDF
                </button>
              ) : null}
            </div>
            <div ref={actionsRef} className="relative">
              <button
                type="button"
                onClick={() => setActionsOpen((previous) => !previous)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                aria-label="Preview actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {actionsOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
                  {preview.documentId && onOpenInDocs ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionsOpen(false);
                        onOpenInDocs(preview.documentId as string);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Open in Docs
                    </button>
                  ) : null}
                  {preview.href ? (
                    <a
                      href={preview.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open source file
                    </a>
                  ) : null}
                  {preview.href ? (
                    <a
                      href={preview.href}
                      download
                      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download file
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {activeView === "pdf" && hasPdf ? (
          <iframe src={preview.href} title={preview.title} className="h-full w-full border-0 bg-zinc-100" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50/80 px-3 py-2">
              <p className="text-xs text-zinc-500">
                {preview.family || formatDocTypeLabel(preview.docType)} {typeof preview.versionNumber === "number" ? `• v${preview.versionNumber}` : ""}
              </p>
              <p className="text-[11px] text-zinc-500">Select text to branch a quote or scoped edit</p>
            </div>
            <div
              ref={markdownRef}
              onMouseUp={() => {
                const selection = typeof window !== "undefined" ? window.getSelection() : null;
                setSelectedQuote(compactQuote(selection?.toString() || ""));
              }}
              onPointerUp={() => {
                const selection = typeof window !== "undefined" ? window.getSelection() : null;
                setSelectedQuote(compactQuote(selection?.toString() || ""));
              }}
              className="bat-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4"
            >
              {markdownLoading ? (
                <p className="text-sm text-zinc-500">Loading document markdown...</p>
              ) : markdownError ? (
                <p className="text-sm text-red-700">{markdownError}</p>
              ) : markdown.trim() ? (
                <ChatMarkdown content={markdown} compact />
              ) : hasPdf ? (
                <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 text-center">
                  <p className="max-w-md text-sm text-zinc-500">Markdown content is not available for this document yet. You can still open the rendered PDF view.</p>
                  <button
                    type="button"
                    onClick={() => setActiveView("pdf")}
                    className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                  >
                    Open PDF view
                  </button>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No markdown content available for this document.</p>
              )}
            </div>
            {selectionToolbar && selectedQuote ? (
              <div
                className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-md border border-zinc-300 bg-white/95 p-1 shadow-lg backdrop-blur"
                style={{ left: `${selectionToolbar.x}px`, top: `${selectionToolbar.y}px` }}
              >
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    onQuote?.({
                      documentId: preview.documentId,
                      title: preview.title,
                      family: preview.family,
                      versionNumber: preview.versionNumber,
                      quotedText: selectedQuote,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  <Quote className="h-3.5 w-3.5" />
                  Quote in chat
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    onAskEdit?.({
                      documentId: preview.documentId,
                      title: preview.title,
                      family: preview.family,
                      versionNumber: preview.versionNumber,
                      quotedText: selectedQuote,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Edit in branch
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBlocks({
  message,
  onResolveDecision,
  onRunAction,
  onOpenPreview,
}: {
  message: ChatMessage;
  onResolveDecision?: (decisionId: string, option: string) => void;
  onRunAction?: (actionLabel: string, actionKey: string, payload?: Record<string, unknown>) => void;
  onOpenPreview?: (input: ArtifactPreviewInput) => void;
}) {
  if (!message.blocks?.length) return null;
  const supportsNonAssistantBlocks = message.blocks.some((block) => block.type === "viral_studio_context");
  if (message.role !== "assistant" && !supportsNonAssistantBlocks) return null;

  const isDecisionBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "decision_requests" }> => block.type === "decision_requests";
  const isActionBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "action_buttons" }> => block.type === "action_buttons";
  const isDocumentReadyBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "document_ready" | "document_parse_needs_review" }> =>
    block.type === "document_ready" || block.type === "document_parse_needs_review";
  const isDocumentEditAppliedBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "document_edit_applied" }> =>
    block.type === "document_edit_applied";
  const isDocumentEditProposalBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "document_edit_proposal" }> =>
    block.type === "document_edit_proposal";
  const isDocumentExportResultBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "document_export_result" }> =>
    block.type === "document_export_result";
  const isDocumentArtifactBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "document_artifact" }> =>
    block.type === "document_artifact";
  const isViralStudioContextBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "viral_studio_context" }> =>
    block.type === "viral_studio_context";

  return (
    <div className="mt-3 space-y-2">
      {message.blocks.map((block, index) => {
        if (isViralStudioContextBlock(block)) {
          const contextLabel =
            block.contextKind === "generation_pack"
              ? "Viral Studio generation"
              : block.contextKind === "shortlist"
                ? "Viral Studio shortlist"
                : "Viral Studio context";
          return (
            <div key={`${message.id}-viral-context-${index}`} className="rounded-md border border-sky-200 bg-sky-50/70 p-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sky-700">{contextLabel}</p>
              {block.summary ? <p className="mt-1 text-sm text-zinc-800">{block.summary}</p> : null}
              {block.objective ? <p className="mt-1 text-xs text-zinc-600">Objective: {block.objective}</p> : null}
              {block.cards.length ? (
                <div className="mt-2 space-y-2">
                  {block.cards.slice(0, 6).map((card) => (
                    <div key={`${message.id}-${card.id}`} className="rounded border border-sky-100 bg-white px-2 py-1.5">
                      <p className="text-xs font-semibold text-zinc-900">{card.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-600">
                        {[
                          card.subtitle || "",
                          card.sourcePlatform ? card.sourcePlatform.toUpperCase() : "",
                          typeof card.score === "number" ? `score ${card.score.toFixed(3)}` : "",
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                      {card.sourceUrl ? (
                        <a
                          href={card.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex text-xs text-sky-700 hover:underline"
                        >
                          Source
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {block.citations.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {block.citations.slice(0, 8).map((citation) =>
                    citation.href ? (
                      <a
                        key={`${message.id}-${citation.id}`}
                        href={citation.href}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-100"
                      >
                        {citation.label}
                      </a>
                    ) : (
                      <span
                        key={`${message.id}-${citation.id}`}
                        className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-xs text-sky-700"
                      >
                        {citation.label}
                      </span>
                    )
                  )}
                </div>
              ) : null}
            </div>
          );
        }

        if (isDecisionBlock(block)) {
          return (
            <div
              key={`${message.id}-decision-${index}`}
              className="rounded-md border border-amber-200/80 bg-amber-50/80 p-2.5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700">Approval needed</p>
              <div className="mt-2 space-y-2">
                {block.items.map((decision) => (
                  <div key={decision.id} className="rounded-xl border border-amber-200 bg-white p-2.5">
                    <p className="text-sm font-semibold text-zinc-900">{decision.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {decision.options.map((option) => (
                        <button
                          key={`${decision.id}-${option.value}`}
                          type="button"
                          onClick={() => onResolveDecision?.(decision.id, option.value)}
                          className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
                        >
                          {option.label || option.value}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (isActionBlock(block)) {
          return (
            <div
              key={`${message.id}-actions-${index}`}
              className="rounded-md border border-zinc-200 bg-zinc-50/80 p-2.5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Quick actions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {block.actions.map((action) => (
                  <button
                    key={`${message.id}-${action.action}-${action.label}`}
                    type="button"
                    onClick={() => onRunAction?.(action.label, action.action, action.payload)}
                    className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              {block.decisions.length ? (
                <div className="mt-3 space-y-2">
                  {block.decisions.map((decision) => (
                    <div key={decision.id} className="rounded-xl border border-zinc-200 bg-white p-2.5">
                      <p className="text-sm font-semibold text-zinc-900">{decision.title}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {decision.options.map((option) => (
                          <button
                            key={`${decision.id}-${option.value}`}
                            type="button"
                            onClick={() => onResolveDecision?.(decision.id, option.value)}
                            className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                          >
                            {option.label || option.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        if (isDocumentReadyBlock(block)) {
          const review = block.type === "document_parse_needs_review";
          return (
            <div
              key={`${message.id}-doc-ready-${index}`}
              className={`rounded-md border p-2.5 ${
                review ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/70"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-600">
                {review ? "Document needs review" : "Document ready"}
              </p>
              <p className="mt-1 text-sm font-semibold text-zinc-900">{block.title}</p>
              {block.originalFileName ? (
                <p className="text-xs text-zinc-600">Source: {block.originalFileName}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                {typeof block.qualityScore === "number" ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                    Quality {Math.round(block.qualityScore * 100)}%
                  </span>
                ) : null}
                {block.parser ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 uppercase">
                    {block.parser}
                  </span>
                ) : null}
                {block.versionId ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                    Version ready
                  </span>
                ) : null}
                {typeof block.chunkCount === "number" ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                    Chunks {block.chunkCount}
                  </span>
                ) : null}
                {typeof block.pagesParsed === "number" ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                    Pages {block.pagesParsed}
                    {typeof block.pagesTotal === "number" ? `/${block.pagesTotal}` : ""}
                  </span>
                ) : null}
              </div>
              {block.warnings?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
                  {block.warnings.map((warning) => (
                    <li key={`${message.id}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {block.actions?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {block.actions.map((action) => (
                    <button
                      key={`${message.id}-${action.action}-${action.label}`}
                      type="button"
                      onClick={() => onRunAction?.(action.label, action.action, action.payload)}
                      className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        if (isDocumentEditAppliedBlock(block)) {
          return (
            <div key={`${message.id}-doc-applied-${index}`} className="rounded-md border border-zinc-200 bg-zinc-50/80 p-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Document edit applied</p>
              <p className="mt-1 text-sm text-zinc-800">
                Version {block.versionNumber} created and saved.
              </p>
              {block.changeSummary ? <p className="mt-1 text-xs text-zinc-600">{block.changeSummary}</p> : null}
              {block.actions?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {block.actions.map((action) => (
                    <button
                      key={`${message.id}-${action.action}-${action.label}`}
                      type="button"
                      onClick={() => onRunAction?.(action.label, action.action, action.payload)}
                      className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        if (isDocumentEditProposalBlock(block)) {
          const anchor = block.anchor;
          const anchorLabel = anchor?.matched
            ? `Anchor matched${typeof anchor.matchCount === "number" && anchor.matchCount > 1 ? ` (${anchor.matchCount})` : ""}`
            : "Anchor not found";
          return (
            <div key={`${message.id}-doc-proposal-${index}`} className="rounded-md border border-sky-200 bg-sky-50/70 p-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sky-700">Document edit proposal</p>
              <p className="mt-1 text-sm text-zinc-800">
                Prepared changes for the selected document on version {block.baseVersionNumber}.
              </p>
              <p className="mt-1 text-xs text-zinc-600">{block.changeSummary || block.instruction}</p>
              {anchor?.quotedText ? (
                <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-2">
                  <p className={`text-xs font-medium ${anchor.matched ? "text-emerald-700" : "text-amber-700"}`}>{anchorLabel}</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    Quote: <span className="font-medium text-zinc-800">&quot;{anchor.quotedText}&quot;</span>
                  </p>
                  {typeof anchor.replacementText === "string" ? (
                    <p className="mt-1 text-xs text-zinc-600">
                      Replace with: <span className="font-medium text-zinc-800">&quot;{anchor.replacementText}&quot;</span>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {block.preview ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                    Before {block.preview.beforeChars} chars
                  </span>
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                    After {block.preview.afterChars} chars
                  </span>
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                    {block.changed ? "Changed" : "No content change"}
                  </span>
                </div>
              ) : null}
              {block.actions?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {block.actions.map((action) => (
                    <button
                      key={`${message.id}-${action.action}-${action.label}`}
                      type="button"
                      onClick={() => onRunAction?.(action.label, action.action, action.payload)}
                      className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        if (isDocumentExportResultBlock(block)) {
          return (
            <div key={`${message.id}-doc-export-${index}`} className="rounded-md border border-zinc-200 bg-zinc-50/80 p-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Document export</p>
              <p className="mt-1 text-sm text-zinc-800">
                {block.format} export is ready.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-600">
                  {block.format}
                </span>
                {typeof block.fileSizeBytes === "number" ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-600">
                    {Math.max(1, Math.round(block.fileSizeBytes / 1024))} KB
                  </span>
                ) : null}
                {block.downloadHref ? (
                  <a
                    href={block.downloadHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                  >
                    Download
                  </a>
                ) : null}
              </div>
            </div>
          );
        }

        if (isDocumentArtifactBlock(block)) {
          const previewHref = normalizeArtifactHref(String(block.previewHref || block.downloadHref || block.storagePath || "").trim());
          const downloadHref = normalizeArtifactHref(String(block.downloadHref || block.storagePath || "").trim());
          const dimensions = qualityDimensions(block.dimensionScores || null);
          const previewInput = {
            title: block.title,
            href: previewHref,
            ...(block.documentId ? { documentId: block.documentId } : {}),
            ...(block.docType ? { docType: block.docType } : {}),
            ...(block.family ? { family: block.family } : {}),
            ...(typeof block.versionNumber === "number" ? { versionNumber: block.versionNumber } : {}),
            ...(block.previewModeDefault ? { previewModeDefault: block.previewModeDefault } : {}),
          };
          const overflowActions: OverflowAction[] = [
            ...(downloadHref
              ? [
                  {
                    key: `${message.id}-download`,
                    label: "Download file",
                    href: downloadHref,
                  } satisfies OverflowAction,
                ]
              : []),
            ...(block.documentId
              ? [
                  {
                    key: `${message.id}-docs`,
                    label: "Open in docs",
                    onSelect: () =>
                      onRunAction?.("Open in docs", "document.read", {
                        documentId: block.documentId,
                      }),
                  } satisfies OverflowAction,
                ]
              : []),
            ...((block.actions || []).map((action) => ({
              key: `${message.id}-${action.action}-${action.label}`,
              label: action.label,
              onSelect: () => onRunAction?.(action.label, action.action, action.payload),
            })) satisfies OverflowAction[]),
          ];
          return (
            <div key={`${message.id}-doc-artifact-${index}`} className="border border-zinc-200 bg-white p-2.5">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-200 bg-zinc-50 text-zinc-600">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900">{block.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {[
                      formatDocTypeLabel(block.family || block.docType),
                      block.format,
                      typeof block.versionNumber === "number" ? `v${block.versionNumber}` : "",
                      typeof block.coverageScore === "number" ? `coverage ${Math.round(block.coverageScore)}/100` : "",
                      typeof block.qualityScore === "number" ? `quality ${Math.round(block.qualityScore)}/100` : "",
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                </div>
              </div>
              {block.partial ? (
                <p className="mt-2 text-xs text-amber-800">Partial draft returned.</p>
              ) : null}
              {block.partialReasons?.length ? (
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
                  {block.partialReasons.slice(0, 3).map((reason) => (
                    <li key={`${message.id}-${reason}`}>• {reason}</li>
                  ))}
                </ul>
              ) : null}
              {typeof block.qualityScore === "number" || dimensions.length || block.qualityNotes?.length ? (
                <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {typeof block.qualityScore === "number" ? (
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${scoreTone(block.qualityScore)}`}>
                        Quality {Math.round(block.qualityScore)}/100
                      </span>
                    ) : null}
                    {block.renderTheme ? (
                      <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                        {block.renderTheme.replace(/_/g, " ")}
                      </span>
                    ) : null}
                  </div>
                  {dimensions.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dimensions.slice(0, 4).map(([label, score]) => (
                        <span key={`${message.id}-${label}`} className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                          {label} {Math.round(Number(score))}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {block.qualityNotes?.length ? (
                    <ul className="mt-2 space-y-1 text-[11px] text-zinc-600">
                      {block.qualityNotes.slice(0, 2).map((note) => (
                        <li key={`${message.id}-${note}`}>• {note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between gap-2">
                {previewHref || block.documentId ? (
                  <button
                    type="button"
                    onClick={() => onOpenPreview?.(previewInput)}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-800"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </button>
                ) : (
                  <span />
                )}
                <OverflowActionsMenu actions={overflowActions} />
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export function ChatThread({
  messages,
  onForkFromMessage,
  onResolveDecision,
  onRunAction,
  onLoadDocumentMarkdown,
  onQuoteArtifact,
  onAskEditArtifact,
  onStarterAction,
  onInspectAssistantMessage,
  onOpenEvidence,
  selectedAssistantMessageId,
  showInlineReasoning = false,
  isStreaming,
  streamingInsight,
  contentWidthClassName = "max-w-3xl",
}: {
  messages: ChatMessage[];
  onForkFromMessage?: (messageId: string) => void;
  onResolveDecision?: (decisionId: string, option: string) => void;
  onRunAction?: (actionLabel: string, actionKey: string, payload?: Record<string, unknown>) => void;
  onLoadDocumentMarkdown?: (documentId: string) => Promise<string>;
  onQuoteArtifact?: (input: ArtifactQuoteInput) => void;
  onAskEditArtifact?: (input: ArtifactQuoteInput) => void;
  onStarterAction?: (action: "audit" | "sources" | "deliverable" | "competitor_v3") => void;
  onInspectAssistantMessage?: (messageId: string) => void;
  onOpenEvidence?: (messageId: string) => void;
  selectedAssistantMessageId?: string | null;
  showInlineReasoning?: boolean;
  isStreaming?: boolean;
  streamingInsight?: string;
  contentWidthClassName?: string;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewInput | null>(null);
  const [artifactMarkdownByDocId, setArtifactMarkdownByDocId] = useState<Record<string, string>>({});
  const [artifactMarkdownLoading, setArtifactMarkdownLoading] = useState(false);
  const [artifactMarkdownError, setArtifactMarkdownError] = useState<string | null>(null);
  const visibleMessages = useMemo(() => messages.filter((message) => message.role !== "system"), [messages]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceToBottom < 200) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [visibleMessages.length, isStreaming, streamingInsight]);

  useEffect(() => {
    const documentId = artifactPreview?.documentId;
    if (!documentId || !onLoadDocumentMarkdown) return;
    if (artifactMarkdownByDocId[documentId]) {
      return;
    }
    let cancelled = false;
    const loadMarkdown = async () => {
      setArtifactMarkdownLoading(true);
      setArtifactMarkdownError(null);
      try {
        const markdown = await onLoadDocumentMarkdown(documentId);
        if (cancelled) return;
        setArtifactMarkdownByDocId((previous) => ({
          ...previous,
          [documentId]: String(markdown || ""),
        }));
      } catch (error) {
        if (cancelled) return;
        setArtifactMarkdownError(String((error as Error)?.message || "Failed to load markdown preview."));
      } finally {
        if (!cancelled) setArtifactMarkdownLoading(false);
      }
    };
    void loadMarkdown();
    return () => {
      cancelled = true;
    };
  }, [artifactMarkdownByDocId, artifactPreview?.documentId, onLoadDocumentMarkdown]);

  if (!visibleMessages.length) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-transparent p-2 text-center sm:p-3">
        <div className="mx-auto w-full max-w-4xl">
          <p className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">How can I help with this workspace?</p>
          <p className="mt-1.5 text-sm text-zinc-500 sm:text-base">
            Ask for analysis, implementation, debugging, or evidence review and I will run the right tools and respond here.
          </p>
          <div className="mt-4 grid gap-2 text-left sm:grid-cols-3">
            <button
              type="button"
              onClick={() => onStarterAction?.("audit")}
              className="rounded-md border border-zinc-200 bg-white p-3 text-left transition hover:bg-zinc-50"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Audit</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">Run a full workspace audit</p>
              <p className="mt-1 text-xs text-zinc-500">Web, competitors, social, community, and action priorities.</p>
            </button>
            <button
              type="button"
              onClick={() => onStarterAction?.("sources")}
              className="rounded-md border border-zinc-200 bg-white p-3 text-left transition hover:bg-zinc-50"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Evidence</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">Ask with source constraints</p>
              <p className="mt-1 text-xs text-zinc-500">Try “Use evidence from…” to ground output in specific data.</p>
            </button>
            <button
              type="button"
              onClick={() => onStarterAction?.("deliverable")}
              className="rounded-md border border-zinc-200 bg-white p-3 text-left transition hover:bg-zinc-50"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Deliverable</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">Generate client-ready output</p>
              <p className="mt-1 text-xs text-zinc-500">Briefs, audits, and PDFs from this branch context.</p>
            </button>
            <button
              type="button"
              onClick={() => onStarterAction?.("competitor_v3")}
              className="rounded-md border border-zinc-200 bg-white p-3 text-left transition hover:bg-zinc-50 sm:col-span-3"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Competitor Finder V3</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">Run wide competitor + adjacent discovery</p>
              <p className="mt-1 text-xs text-zinc-500">
                Multi-lane web/social/community search, enrichment, and ranked shortlist with evidence.
              </p>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
      <section ref={scrollRef} className="bat-scrollbar min-h-0 flex-1 overflow-y-auto bg-white">
      <div className={`mx-auto w-full ${contentWidthClassName} px-2 pb-4 pt-2 sm:px-3 xl:px-4`}>
        {visibleMessages.map((message, index) => {
          const isUser = message.role === "user";
          const scopedMessage = isUser ? parseScopedMessage(message.content) : null;
          const previousMessage = index > 0 ? visibleMessages[index - 1] : null;
          const inheritedScopedMessage =
            !isUser && previousMessage?.role === "user" ? parseScopedMessage(previousMessage.content) : null;
          const scopedDocumentId = isUser ? message.documentIds?.[0] : previousMessage?.documentIds?.[0];
          const assistantIsScopedReply = Boolean(
            !isUser &&
              inheritedScopedMessage &&
              (isDocumentWorkflowAssistantMessage(message) || index === visibleMessages.length - 1 || visibleMessages[index + 1]?.role === "user")
          );
          const qualityNotes = message.reasoning?.quality?.notes || [];
          const qualityRewriteApplied =
            message.reasoning?.quality?.intent === "competitor_brief" &&
            qualityNotes.some((note) => /rewritten to enforce competitor brief completeness/i.test(note));
          return (
            <article key={message.id} className="group mb-3">
              <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={
                    isUser
                      ? "max-w-[93%] rounded-[1.35rem] bg-[#2f2f32] px-3 py-2.5 text-white shadow-[0_16px_30px_-24px_rgba(0,0,0,0.45)] sm:max-w-[84%] 2xl:max-w-[78%]"
                      : assistantIsScopedReply
                        ? "max-w-[98%] rounded-[1.35rem] border border-zinc-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8f9fa_100%)] px-3 py-2.5 text-zinc-900 shadow-[0_18px_34px_-30px_rgba(15,23,42,0.28)] sm:max-w-[94%] 2xl:max-w-[90%]"
                        : "max-w-[98%] px-0 py-0 text-zinc-900 sm:max-w-[94%] 2xl:max-w-[90%]"
                  }
                >
                  {assistantIsScopedReply && inheritedScopedMessage ? (
                    <div className="mb-2 rounded-2xl border border-zinc-200 bg-zinc-50/85 p-2.5">
                      <div className="flex items-start gap-2.5">
                        <div className="flex shrink-0 flex-col items-center">
                          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-zinc-900" />
                          <span className="mt-1 h-8 w-px bg-zinc-300" />
                        </div>
                        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700">
                          {inheritedScopedMessage.kind === "document_edit" ? (
                            <Sparkles className="h-4 w-4" />
                          ) : (
                            <Quote className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                              {inheritedScopedMessage.kind === "document_edit" ? "Document Branch Reply" : "Document Context Reply"}
                            </span>
                            {inheritedScopedMessage.versionLabel ? (
                              <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-500">
                                {inheritedScopedMessage.versionLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-zinc-900">{inheritedScopedMessage.title}</p>
                          <p className="text-xs text-zinc-500">
                            {inheritedScopedMessage.kind === "document_edit"
                              ? "BAT is drafting against the scoped document edit request."
                              : "BAT is replying inside the scoped document context."}
                          </p>
                          <ScopedMessageTools
                            scopedMessage={inheritedScopedMessage}
                            documentId={scopedDocumentId}
                            onQuote={onQuoteArtifact}
                            onAskEdit={onAskEditArtifact}
                            onRunAction={onRunAction}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {scopedMessage ? (
                    <div className="mb-2 rounded-2xl border border-white/15 bg-white/8 p-2.5">
                      <div className="flex items-start gap-2.5">
                        <div className="flex shrink-0 flex-col items-center">
                          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-white/90" />
                          <span className="mt-1 h-8 w-px bg-white/20" />
                        </div>
                        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white">
                          {scopedMessage.kind === "document_edit" ? (
                            <Sparkles className="h-4 w-4" />
                          ) : (
                            <Quote className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90">
                              {scopedMessage.kind === "document_edit" ? "Document Edit Branch" : "Document Reply Branch"}
                            </span>
                            {scopedMessage.versionLabel ? (
                              <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] text-white/70">
                                {scopedMessage.versionLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-white">{scopedMessage.title}</p>
                          {scopedMessage.subtitle ? (
                            <p className="text-xs text-white/70">{scopedMessage.subtitle}</p>
                          ) : null}
                          {scopedMessage.quote ? (
                            <p className="mt-1 line-clamp-2 border-l-2 border-white/20 pl-2 text-xs text-white/75">
                              {scopedMessage.quote}
                            </p>
                          ) : null}
                          <div className="mt-2">
                            <ScopedMessageTools
                              scopedMessage={scopedMessage}
                              documentId={scopedDocumentId}
                              onQuote={onQuoteArtifact}
                              onAskEdit={onAskEditArtifact}
                              onRunAction={onRunAction}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <ChatMarkdown
                    content={formatMessageContentForDisplay(scopedMessage?.request || message.content)}
                    className={isUser ? "[&_*]:!text-white [&_a]:!text-white/95 [&_code]:!bg-zinc-700 [&_blockquote]:!border-zinc-400" : ""}
                  />
                  {!isUser && message.reasoning?.model?.used ? (
                    <p className="mt-2 text-xs text-zinc-500">
                      Model: {message.reasoning.model.used}
                      {message.reasoning.model.fallbackUsed
                        ? ` (fallback from ${message.reasoning.model.fallbackFrom || message.reasoning.model.requested})`
                        : ""}
                    </p>
                  ) : null}
                  {!isUser && qualityRewriteApplied ? (
                    <p className="mt-1 text-xs text-amber-700">Quality pass: competitor brief was expanded for completeness.</p>
                  ) : null}
                  <p className={`mt-1 text-xs ${isUser ? "text-zinc-300" : "text-zinc-400"}`}>{formatMessageTime(message.createdAt)}</p>
                  {message.attachmentIds?.length || message.documentIds?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {message.documentIds?.length ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${
                            isUser ? "border-zinc-500 text-zinc-200" : "border-zinc-200 bg-zinc-50 text-zinc-600"
                          }`}
                        >
                          Docs {message.documentIds.length}
                        </span>
                      ) : null}
                      {message.attachmentIds?.length ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${
                            isUser ? "border-zinc-500 text-zinc-200" : "border-zinc-200 bg-zinc-50 text-zinc-600"
                          }`}
                        >
                          Files {message.attachmentIds.length}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {!isUser ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                  {onOpenEvidence ? (
                    <button
                      type="button"
                      onClick={() => onOpenEvidence(message.id)}
                      className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                    >
                      Sources
                    </button>
                  ) : null}
                  <OverflowActionsMenu
                    actions={[
                      ...(onInspectAssistantMessage
                        ? [
                            {
                              key: `${message.id}-thoughts`,
                              label: selectedAssistantMessageId === message.id ? "Thoughts open" : "Open thoughts",
                              onSelect: () => onInspectAssistantMessage(message.id),
                            } satisfies OverflowAction,
                          ]
                        : []),
                      ...(onForkFromMessage
                        ? [
                            {
                              key: `${message.id}-fork`,
                              label: "Fork from here",
                              onSelect: () => onForkFromMessage(message.id),
                            } satisfies OverflowAction,
                          ]
                        : []),
                    ]}
                  />
                </div>
              ) : null}

              <div className={assistantIsScopedReply ? "ml-4 border-l border-zinc-200 pl-4 sm:ml-6 sm:pl-5" : ""}>
                <MessageBlocks
                  message={message}
                  onResolveDecision={onResolveDecision}
                  onRunAction={onRunAction}
                  onOpenPreview={(input) => {
                    setArtifactMarkdownError(null);
                    setArtifactPreview(input);
                  }}
                />
              </div>
              {showInlineReasoning && message.role === "assistant" ? <ReasoningPanel message={message} /> : null}
            </article>
          );
        })}

        {isStreaming ? (
            <article className="mb-4">
              <div className="mb-2 flex items-center gap-2">
              <TypingDots />
            </div>
            <div className="bg-white px-0 py-0">
              <p className="text-base leading-7 text-zinc-700">
                {streamingInsight || "Thinking and running tools..."}
              </p>
            </div>
          </article>
        ) : null}
        <div ref={endRef} />
      </div>
      {artifactPreview ? (
        <ArtifactPreviewDialog
          key={`${artifactPreview.documentId || artifactPreview.href || artifactPreview.title}`}
          preview={artifactPreview}
          markdown={artifactPreview.documentId ? String(artifactMarkdownByDocId[artifactPreview.documentId] || "") : ""}
          markdownLoading={artifactMarkdownLoading}
          markdownError={artifactMarkdownError}
          onClose={() => {
            setArtifactPreview(null);
            setArtifactMarkdownLoading(false);
            setArtifactMarkdownError(null);
          }}
          onOpenInDocs={(documentId) => onRunAction?.("Open in docs", "document.read", { documentId })}
          onQuote={onQuoteArtifact}
          onAskEdit={onAskEditArtifact}
        />
      ) : null}
    </section>
  );
}
