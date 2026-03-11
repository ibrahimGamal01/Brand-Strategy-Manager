"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Download, ExternalLink, Files, GitBranch, MoreHorizontal, Quote, Search, Sparkles, X } from "lucide-react";
import { ComposerBranchContext } from "@/types/chat";
import { getRuntimeDocument, RuntimeWorkspaceDocumentDto } from "@/lib/runtime-api";
import { ChatMarkdown } from "./chat-markdown";

function formatFreshness(iso?: string): string {
  const value = String(iso || "").trim();
  if (!value) return "No version yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Version timestamp unavailable";
  const ageMs = Date.now() - parsed.getTime();
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 2) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 8) return `Updated ${days}d ago`;
  return `Updated ${parsed.toLocaleDateString()}`;
}

function compactQuote(value: string, maxChars = 380): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeStorageHref(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/storage/")) return raw;
  if (raw.startsWith("storage/")) return `/${raw}`;
  if (raw.startsWith("./storage/")) return `/${raw.slice(2)}`;
  return raw;
}

function familyLabel(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/_/g, " ");
}

function scoreTone(score?: number | null): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "bg-zinc-100 text-zinc-700 border-zinc-200";
  if (score >= 85) return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (score >= 72) return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-rose-50 text-rose-800 border-rose-200";
}

function qualityDimensionEntries(
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
    { key: "grounding", label: "Grounding", score: value.grounding },
    { key: "specificity", label: "Specificity", score: value.specificity },
    { key: "usefulness", label: "Usefulness", score: value.usefulness },
    { key: "redundancy", label: "Redundancy", score: value.redundancy },
    { key: "tone", label: "Tone", score: value.tone },
    { key: "visual", label: "Visual", score: value.visual },
  ];
}

export function DocumentWorkspacePanel({
  workspaceId,
  branchId,
  documents,
  selectedDocumentId,
  branchContext,
  recentBranchActivity,
  onSelectDocument,
  onQuoteInChat,
  onAskAiEdit,
  onRefreshDocuments,
  onRefreshRuntime,
}: {
  workspaceId: string;
  branchId: string | null;
  documents: RuntimeWorkspaceDocumentDto[];
  selectedDocumentId: string | null;
  branchContext?: ComposerBranchContext | null;
  recentBranchActivity?: Array<{
    id: string;
    kind: "request" | "proposal" | "applied" | "export" | "artifact" | "ready";
    title: string;
    detail?: string;
    createdAt: string;
  }>;
  onSelectDocument: (documentId: string) => void;
  onQuoteInChat: (input: { document: RuntimeWorkspaceDocumentDto; quotedText: string }) => void;
  onAskAiEdit?: (input: { document: RuntimeWorkspaceDocumentDto; quotedText: string }) => void;
  onRefreshDocuments: () => Promise<void>;
  onRefreshRuntime: () => Promise<void>;
}) {
  const [listQuery, setListQuery] = useState("");
  const [showAllDocuments, setShowAllDocuments] = useState(false);
  const [selectionQuote, setSelectionQuote] = useState("");
  const [hydrating, setHydrating] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydratedContentByDocument, setHydratedContentByDocument] = useState<Record<string, string>>({});
  const readerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const pickerPanelRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<{ x: number; y: number } | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [showPartialReasons, setShowPartialReasons] = useState(false);

  const scopedDocuments = useMemo(() => {
    if (showAllDocuments) return documents;
    return documents.filter((document) => Boolean(document.latestVersion));
  }, [documents, showAllDocuments]);

  const filteredDocuments = useMemo(() => {
    const query = listQuery.trim().toLowerCase();
    if (!query) return scopedDocuments;
    return scopedDocuments.filter((document) => {
      const title = String(document.title || "").toLowerCase();
      const fileName = String(document.originalFileName || "").toLowerCase();
      return title.includes(query) || fileName.includes(query);
    });
  }, [scopedDocuments, listQuery]);

  const selectedDocument = useMemo(
    () => scopedDocuments.find((document) => document.id === selectedDocumentId) || null,
    [scopedDocuments, selectedDocumentId]
  );

  const selectDocument = useCallback(
    (documentId: string) => {
      setSelectionQuote("");
      setSelectionToolbar(null);
      setIsPickerOpen(false);
      setActionMenuOpen(false);
      onSelectDocument(documentId);
    },
    [onSelectDocument]
  );

  useEffect(() => {
    if (selectedDocumentId && scopedDocuments.some((document) => document.id === selectedDocumentId)) return;
    if (!scopedDocuments.length) return;
    selectDocument(scopedDocuments[0].id);
  }, [scopedDocuments, selectDocument, selectedDocumentId]);

  useEffect(() => {
    const documentId = selectedDocument?.id;
    if (!documentId || !branchId) return;
    const inlineContent = String(selectedDocument.latestVersion?.contentMd || "");
    if (inlineContent.trim()) return;
    if (hydratedContentByDocument[documentId]) return;

    let cancelled = false;
    const hydrateDocument = async () => {
      setHydrating(true);
      setHydrationError(null);
      try {
        const payload = await getRuntimeDocument(workspaceId, branchId, documentId);
        if (cancelled) return;
        const latest = payload.document.latestVersion?.contentMd;
        const fallback = Array.isArray(payload.document.versions) ? payload.document.versions[0]?.contentMd : "";
        const content = String(latest || fallback || "");
        setHydratedContentByDocument((previous) => ({
          ...previous,
          [documentId]: content,
        }));
      } catch (error) {
        if (cancelled) return;
        setHydrationError(String((error as Error)?.message || "Unable to load document content."));
      } finally {
        if (!cancelled) setHydrating(false);
      }
    };
    void hydrateDocument();

    return () => {
      cancelled = true;
    };
  }, [branchId, hydratedContentByDocument, selectedDocument, workspaceId]);

  const selectedContent = useMemo(() => {
    if (!selectedDocument) return "";
    const inlineContent = String(selectedDocument.latestVersion?.contentMd || "");
    if (inlineContent.trim()) return inlineContent;
    return String(hydratedContentByDocument[selectedDocument.id] || "");
  }, [hydratedContentByDocument, selectedDocument]);

  const selectedDocFamily = familyLabel(selectedDocument?.generatedMeta?.docFamily);
  const selectedCoverage = selectedDocument?.generatedMeta?.coverageScore;
  const selectedQuality = selectedDocument?.generatedMeta?.qualityScore;
  const selectedQualityNotes = selectedDocument?.generatedMeta?.qualityNotes || [];
  const selectedDimensionScores = selectedDocument?.generatedMeta?.dimensionScores;
  const selectedRenderTheme = selectedDocument?.generatedMeta?.renderTheme;
  const selectedEditorialPassCount = selectedDocument?.generatedMeta?.editorialPassCount;
  const selectedQualityReference = selectedDocument?.qualityReference;
  const selectedVersion = selectedDocument?.latestVersion?.versionNumber || 0;
  const selectedStorageHref = useMemo(
    () => normalizeStorageHref(selectedDocument?.storageHref || selectedDocument?.storagePath),
    [selectedDocument?.storageHref, selectedDocument?.storagePath]
  );
  const selectedExports = useMemo(
    () =>
      [...(selectedDocument?.exports || [])]
        .map((item) => ({
          ...item,
          href: normalizeStorageHref(item.storageHref || item.storagePath),
        }))
        .filter((item) => Boolean(item.href))
        .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || ""))),
    [selectedDocument?.exports]
  );
  const qualityDimensions = useMemo(
    () => qualityDimensionEntries(selectedDimensionScores || null),
    [selectedDimensionScores]
  );
  const referenceDimensions = useMemo(
    () => qualityDimensionEntries(selectedQualityReference?.dimensionScores || null),
    [selectedQualityReference?.dimensionScores]
  );
  const branchIsFocusedOnSelectedDocument = Boolean(
    branchContext?.documentId &&
      selectedDocument?.id &&
      branchContext.documentId === selectedDocument.id
  );

  const updateSelection = useCallback(() => {
    if (!readerRef.current || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) {
      setSelectionQuote("");
      setSelectionToolbar(null);
      return;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode || !readerRef.current.contains(anchorNode) || !readerRef.current.contains(focusNode)) {
      setSelectionQuote("");
      setSelectionToolbar(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const selectedText = compactQuote(selection.toString(), 1500);
    setSelectionQuote(selectedText);
    if (!selectedText) {
      setSelectionToolbar(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setSelectionToolbar(null);
      return;
    }
    const toolbarWidth = 220;
    const viewportWidth = window.innerWidth;
    const x = Math.min(viewportWidth - toolbarWidth / 2 - 8, Math.max(toolbarWidth / 2 + 8, rect.left + rect.width / 2));
    const y = Math.max(12, rect.top - 40);
    setSelectionToolbar({ x, y });
  }, []);

  useEffect(() => {
    let frame = 0;
    const handleSelectionChange = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => updateSelection());
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [updateSelection]);

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
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 639px)");
    const syncViewport = () => setIsMobileViewport(media.matches);
    syncViewport();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncViewport);
      return () => media.removeEventListener("change", syncViewport);
    }

    media.addListener(syncViewport);
    return () => media.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (!(isPickerOpen || actionMenuOpen)) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const inHeader = Boolean(headerRef.current?.contains(event.target));
      const inPicker = Boolean(pickerPanelRef.current?.contains(event.target));
      const inAction = Boolean(actionMenuRef.current?.contains(event.target));
      if (inHeader || inPicker || inAction) return;
      setIsPickerOpen(false);
      setActionMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsPickerOpen(false);
      setActionMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionMenuOpen, isPickerOpen]);

  useEffect(() => {
    setActionMenuOpen(false);
    setIsPickerOpen(false);
    setShowPartialReasons(false);
  }, [selectedDocument?.id]);

  const pickerContent = (
    <>
      <label className="bat-doc-search mb-2 flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-xs">
        <Search className="h-3.5 w-3.5 text-zinc-500" />
        <input
          value={listQuery}
          onChange={(event) => setListQuery(event.target.value)}
          placeholder="Find a document"
          className="w-full border-none bg-transparent text-sm outline-none"
        />
      </label>

      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowAllDocuments((previous) => !previous)}
          className={`rounded-md border px-2 py-1 text-xs ${
            showAllDocuments ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          {showAllDocuments ? "Branch docs" : "Show all"}
        </button>
        <p className="text-[11px] text-zinc-500">{filteredDocuments.length} doc{filteredDocuments.length === 1 ? "" : "s"}</p>
      </div>

      <div className="bat-doc-list bat-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1">
        {filteredDocuments.map((document) => {
          const active = document.id === selectedDocument?.id;
          return (
            <button
              key={document.id}
              type="button"
              onClick={() => selectDocument(document.id)}
              className={`w-full rounded-md px-2 py-1.5 text-left ${active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
            >
              <p className="line-clamp-1 text-xs font-semibold text-zinc-900">{document.title || document.originalFileName}</p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase text-zinc-600">
                  {document.parserStatus || "unknown"}
                </span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                  v{document.latestVersion?.versionNumber || 0}
                </span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                  {formatFreshness(document.latestVersion?.createdAt)}
                </span>
              </div>
            </button>
          );
        })}
        {!filteredDocuments.length ? (
          <p className="px-2 py-2 text-xs text-zinc-500">
            {showAllDocuments
              ? "No documents matched this filter."
              : "No document versions found on this branch. Toggle “Show all” to inspect workspace-wide docs."}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <aside className="bat-doc-panel flex h-full min-h-0 flex-col bg-white">
      <div ref={headerRef} className="bat-doc-header relative border-b border-zinc-200 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900">Docs</h2>
            <p className="truncate text-[11px] text-zinc-500">
              {selectedDocument
                ? [
                    selectedDocument.title || selectedDocument.originalFileName,
                    selectedDocFamily || "Document",
                    `v${selectedVersion}`,
                    typeof selectedCoverage === "number" ? `Coverage ${Math.round(selectedCoverage)}/100` : "",
                  ]
                    .filter(Boolean)
                    .join(" • ")
                : branchId
                  ? "Select a document to read"
                  : "Open a branch to access runtime documents"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {branchId ? (
              <button
                type="button"
                onClick={() => {
                  setActionMenuOpen(false);
                  setIsPickerOpen((previous) => !previous);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
              >
                <Files className="h-3.5 w-3.5" />
                Browse
              </button>
            ) : null}
            {branchId ? (
              <div ref={actionMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsPickerOpen(false);
                    setActionMenuOpen((previous) => !previous);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                  title="Document actions"
                  aria-label="Document actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {actionMenuOpen ? (
                  <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenuOpen(false);
                        void Promise.all([onRefreshDocuments(), onRefreshRuntime()]);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      <Files className="h-3.5 w-3.5" />
                      Refresh docs
                    </button>
                    {selectedStorageHref ? (
                      <a
                        href={selectedStorageHref}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open source file
                      </a>
                    ) : null}
                    {selectedExports.map((item, index) => (
                      <a
                        key={`${item.id}-${item.format}`}
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download {item.format}
                        {index === 0 ? " (latest)" : ""}
                      </a>
                    ))}
                    {!selectedDocument ? (
                      <p className="px-2.5 py-2 text-xs text-zinc-500">Browse a document to open or download exports.</p>
                    ) : null}
                    {selectedDocument && !selectedStorageHref && !selectedExports.length ? (
                      <p className="px-2.5 py-2 text-xs text-zinc-500">No document links available yet.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {isPickerOpen && branchId && !isMobileViewport ? (
          <div
            ref={pickerPanelRef}
            className="absolute inset-x-3 top-[calc(100%-0.2rem)] z-20 flex min-h-0 flex-col border border-zinc-200 bg-white p-2 shadow-lg"
            style={{ maxHeight: "min(55vh, 28rem)" }}
          >
            {pickerContent}
          </div>
        ) : null}
      </div>

      {branchIsFocusedOnSelectedDocument || (recentBranchActivity && recentBranchActivity.length > 0) ? (
        <section className="border-b border-zinc-200 bg-[linear-gradient(180deg,#fafafa_0%,#f4f5f6_100%)] px-3 py-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.35)]">
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-700">
                {branchContext?.kind === "document_edit" ? <Sparkles className="h-4 w-4" /> : <GitBranch className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-zinc-200 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">
                    {branchContext?.kind === "document_edit" ? "Active Edit Session" : "Active Document Session"}
                  </span>
                  {branchContext?.commandHint ? (
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                      {branchContext.commandHint}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-900">
                  {branchIsFocusedOnSelectedDocument
                    ? branchContext?.title || selectedDocument?.title || selectedDocument?.originalFileName
                    : selectedDocument?.title || selectedDocument?.originalFileName || "Document activity"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {branchIsFocusedOnSelectedDocument
                    ? branchContext?.subtitle || "The chat composer is currently scoped to this document."
                    : "Recent document branch actions from this chat."}
                </p>
                {branchIsFocusedOnSelectedDocument && branchContext?.quotedText ? (
                  <p className="mt-2 line-clamp-2 border-l-2 border-zinc-300 pl-2 text-xs text-zinc-600">
                    {branchContext.quotedText}
                  </p>
                ) : null}
              </div>
            </div>

            {recentBranchActivity?.length ? (
              <div className="mt-3 border-t border-zinc-200 pt-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  Recent Branch Activity
                </div>
                <div className="space-y-2">
                  {recentBranchActivity.slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-zinc-800">{item.title}</p>
                        <span className="text-[11px] text-zinc-500">{formatFreshness(item.createdAt)}</span>
                      </div>
                      {item.detail ? <p className="mt-1 text-[11px] text-zinc-600">{item.detail}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {!branchId ? (
        <div className="px-3 py-3 text-sm text-zinc-600">Open a branch to access runtime documents.</div>
      ) : null}

      {branchId ? (
        <>
          {selectedDocument ? (
            <>
              <div className="relative min-h-0 flex-1 border-b border-zinc-200">
                <div
                  ref={readerRef}
                  onMouseUp={updateSelection}
                  onPointerUp={updateSelection}
                  onTouchEnd={updateSelection}
                  onKeyUp={updateSelection}
                  className="bat-scrollbar h-full min-h-0 overflow-y-auto bg-white px-3 py-2 text-[13px] leading-6 text-zinc-800 select-text"
                  style={{ userSelect: "text" }}
                >
                  {typeof selectedQuality === "number" || selectedRenderTheme || selectedEditorialPassCount || qualityDimensions.length ? (
                    <section className="mb-3 rounded-xl border border-zinc-200 bg-[linear-gradient(180deg,#fcfcfd_0%,#f6f7f9_100%)] p-3 text-[11px] text-zinc-700 shadow-[0_1px_0_rgba(255,255,255,0.85)_inset]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Quality Review</p>
                          <p className="mt-0.5 text-xs text-zinc-600">
                            Premium rubric and delivery metadata for this document version.
                          </p>
                        </div>
                        {typeof selectedQuality === "number" ? (
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${scoreTone(selectedQuality)}`}>
                            {Math.round(selectedQuality)}/100
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {typeof selectedCoverage === "number" ? (
                          <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700">
                            Coverage {Math.round(selectedCoverage)}/100
                          </span>
                        ) : null}
                        {selectedRenderTheme ? (
                          <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700">
                            Theme {selectedRenderTheme.replace(/_/g, " ")}
                          </span>
                        ) : null}
                        {typeof selectedEditorialPassCount === "number" ? (
                          <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700">
                            {selectedEditorialPassCount} editorial passes
                          </span>
                        ) : null}
                      </div>

                      {qualityDimensions.length ? (
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {qualityDimensions.map((item) => (
                            <div key={item.key} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-medium text-zinc-700">{item.label}</span>
                                <span className="text-[11px] text-zinc-500">{Math.round(item.score)}/100</span>
                              </div>
                              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                                <div
                                  className={`h-full rounded-full ${
                                    item.score >= 85 ? "bg-emerald-500" : item.score >= 72 ? "bg-amber-500" : "bg-rose-500"
                                  }`}
                                  style={{ width: `${Math.max(6, Math.min(100, item.score))}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {selectedQualityNotes.length ? (
                        <div className="mt-3 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[11px] text-zinc-600">
                          <p className="mb-1 font-medium text-zinc-700">Quality notes</p>
                          <ul className="space-y-1">
                            {selectedQualityNotes.slice(0, 4).map((note) => (
                              <li key={note}>• {note}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {selectedQualityReference ? (
                        <div className="mt-3 rounded-lg border border-zinc-900/10 bg-zinc-900 px-2.5 py-2 text-[11px] text-zinc-100">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-semibold">Benchmark</span>
                            {selectedQualityReference.family ? (
                              <span className="text-zinc-300">{familyLabel(selectedQualityReference.family)}</span>
                            ) : null}
                            {typeof selectedQualityReference.qualityScore === "number" ? (
                              <span className="text-zinc-300">Best recent quality {Math.round(selectedQualityReference.qualityScore)}/100</span>
                            ) : null}
                            {selectedQualityReference.at ? (
                              <span className="text-zinc-400">{formatFreshness(selectedQualityReference.at)}</span>
                            ) : null}
                          </div>
                          {referenceDimensions.length ? (
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-zinc-300">
                              {referenceDimensions.map((item) => (
                                <div key={`reference-${item.key}`} className="flex items-center justify-between gap-2">
                                  <span>{item.label}</span>
                                  <span>{Math.round(item.score)}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  {selectedDocument.generatedMeta?.partial ? (
                    <div className="mb-2 border-l-2 border-amber-300 pl-2 text-[11px] text-amber-800">
                      <button
                        type="button"
                        onClick={() => setShowPartialReasons((previous) => !previous)}
                        className="font-medium hover:underline"
                      >
                        Partial draft {showPartialReasons ? "▲" : "▼"}
                      </button>
                      {showPartialReasons ? (
                        <ul className="mt-1 space-y-0.5">
                          {(selectedDocument.generatedMeta.partialReasons?.length
                            ? selectedDocument.generatedMeta.partialReasons.slice(0, 3)
                            : ["Evidence quality is below deep target for this version."]
                          ).map((reason) => (
                            <li key={reason}>• {reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {hydrating ? (
                    "Loading document markdown..."
                  ) : selectedContent ? (
                    <ChatMarkdown content={selectedContent} compact />
                  ) : (
                    "No markdown content available yet for this document."
                  )}
                </div>
              </div>

              {hydrationError ? (
                <div className="mx-3 mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{hydrationError}</div>
              ) : null}
            </>
          ) : (
            <div className="px-3 py-3 text-sm text-zinc-600">Select a document to read.</div>
          )}
        </>
      ) : null}

      {isPickerOpen && branchId && isMobileViewport ? (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsPickerOpen(false)}
            aria-label="Close documents picker"
          />
          <div
            ref={pickerPanelRef}
            className="absolute inset-x-0 bottom-0 flex min-h-[16rem] max-h-[72vh] min-h-0 flex-col border-t border-zinc-200 bg-white p-3 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900">Documents</p>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                aria-label="Close documents picker"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{pickerContent}</div>
          </div>
        </div>
      ) : null}

      {selectionToolbar && selectionQuote && selectedDocument ? (
        <div
          className="fixed z-40 flex -translate-x-1/2 items-center gap-1 rounded-md border border-zinc-300 bg-white/95 p-1 shadow-lg backdrop-blur"
          style={{ left: `${selectionToolbar.x}px`, top: `${selectionToolbar.y}px` }}
        >
          <button
            type="button"
            onClick={() => onQuoteInChat({ document: selectedDocument, quotedText: selectionQuote })}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
          >
            <Quote className="h-3.5 w-3.5" />
            Quote
          </button>
          <button
            type="button"
            onClick={() => onAskAiEdit?.({ document: selectedDocument, quotedText: selectionQuote })}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Edit in branch
          </button>
        </div>
      ) : null}
    </aside>
  );
}
