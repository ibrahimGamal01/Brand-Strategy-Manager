"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Quote, RefreshCcw, Search, Sparkles } from "lucide-react";
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

export function DocumentWorkspacePanel({
  workspaceId,
  branchId,
  documents,
  selectedDocumentId,
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
  const [selectionToolbar, setSelectionToolbar] = useState<{ x: number; y: number } | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
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
    setActionMenuOpen(false);
    setShowPartialReasons(false);
  }, [selectedDocument?.id]);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-zinc-900">Docs</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAllDocuments((previous) => !previous)}
            className={`rounded-md border px-2 py-1 text-xs ${
              showAllDocuments ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {showAllDocuments ? "Branch docs" : "Show all"}
          </button>
          <button
            type="button"
            onClick={() => {
              void Promise.all([onRefreshDocuments(), onRefreshRuntime()]);
            }}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
          >
            <span className="inline-flex items-center gap-1">
              <RefreshCcw className="h-3.5 w-3.5" />
              Refresh
            </span>
          </button>
        </div>
      </div>

      {!branchId ? (
        <div className="px-3 py-3 text-sm text-zinc-600">Open a branch to access runtime documents.</div>
      ) : null}

      {branchId ? (
        <>
          <label className="mx-3 mt-2 mb-2 flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              value={listQuery}
              onChange={(event) => setListQuery(event.target.value)}
              placeholder="Find a document"
              className="w-full border-none bg-transparent text-sm outline-none"
            />
          </label>

          <div className="bat-scrollbar mx-3 mb-2 max-h-24 space-y-0.5 overflow-y-auto">
            {filteredDocuments.map((document) => {
              const active = document.id === selectedDocument?.id;
              return (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => selectDocument(document.id)}
                  className={`w-full rounded-md px-2.5 py-2 text-left ${active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                >
                  <p className="line-clamp-1 text-xs font-semibold text-zinc-900">{document.title || document.originalFileName}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase text-zinc-600">
                      {document.parserStatus || "unknown"}
                    </span>
                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                      v{document.latestVersion?.versionNumber || 0}
                    </span>
                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
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

          {selectedDocument ? (
            <>
              <div className="mx-3 mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-zinc-900">
                    {selectedDocument.title || selectedDocument.originalFileName}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {[selectedDocFamily || "Document", `v${selectedVersion}`, typeof selectedCoverage === "number" ? `Coverage ${Math.round(selectedCoverage)}/100` : ""]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                </div>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActionMenuOpen((previous) => !previous)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                    title="Document downloads"
                    aria-label="Document downloads"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  {actionMenuOpen ? (
                    <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-zinc-200 bg-white p-1 shadow-md">
                      {selectedStorageHref ? (
                        <a
                          href={selectedStorageHref}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
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
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download {item.format}
                          {index === 0 ? " (latest)" : ""}
                        </a>
                      ))}
                      {!selectedStorageHref && !selectedExports.length ? (
                        <p className="px-2 py-1.5 text-xs text-zinc-500">No download links yet.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="relative min-h-0 flex-1 border-y border-zinc-200">
                <div
                  ref={readerRef}
                  onMouseUp={updateSelection}
                  onPointerUp={updateSelection}
                  onTouchEnd={updateSelection}
                  onKeyUp={updateSelection}
                  className="bat-scrollbar h-full min-h-0 overflow-y-auto bg-white px-3 py-2 text-[13px] leading-6 text-zinc-800 select-text"
                  style={{ userSelect: "text" }}
                >
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
            Ask AI to edit
          </button>
        </div>
      ) : null}
    </aside>
  );
}
