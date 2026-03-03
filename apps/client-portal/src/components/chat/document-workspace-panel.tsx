"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Quote, RefreshCcw, Search, Sparkles } from "lucide-react";
import {
  applyRuntimeDocumentEdit,
  getRuntimeDocument,
  proposeRuntimeDocumentEdit,
  RuntimeWorkspaceDocumentDto,
  searchRuntimeDocument,
} from "@/lib/runtime-api";

type DocumentProposal = {
  documentId: string;
  baseVersionId: string;
  baseVersionNumber: number;
  instruction: string;
  proposedContentMd: string;
  changed: boolean;
  changeSummary: string;
  preview: { beforeChars: number; afterChars: number };
  anchor?: {
    quotedText: string;
    replacementText?: string;
    matched: boolean;
    matchType?: "exact" | "whitespace";
    matchCount?: number;
  };
};

type DocumentSearchHit = {
  chunkIndex: number;
  headingPath?: string | null;
  text: string;
  score: number;
  tokenCount: number;
};

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

export function DocumentWorkspacePanel({
  workspaceId,
  branchId,
  documents,
  selectedDocumentId,
  onSelectDocument,
  onQuoteInChat,
  onRefreshDocuments,
  onRefreshRuntime,
}: {
  workspaceId: string;
  branchId: string | null;
  documents: RuntimeWorkspaceDocumentDto[];
  selectedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  onQuoteInChat: (input: { document: RuntimeWorkspaceDocumentDto; quotedText: string }) => void;
  onRefreshDocuments: () => Promise<void>;
  onRefreshRuntime: () => Promise<void>;
}) {
  const [listQuery, setListQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<DocumentSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectionQuote, setSelectionQuote] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<DocumentProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydratedContentByDocument, setHydratedContentByDocument] = useState<Record<string, string>>({});
  const readerRef = useRef<HTMLDivElement | null>(null);

  const filteredDocuments = useMemo(() => {
    const query = listQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((document) => {
      const title = String(document.title || "").toLowerCase();
      const fileName = String(document.originalFileName || "").toLowerCase();
      return title.includes(query) || fileName.includes(query);
    });
  }, [documents, listQuery]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) || null,
    [documents, selectedDocumentId]
  );

  useEffect(() => {
    if (selectedDocumentId && documents.some((document) => document.id === selectedDocumentId)) return;
    if (!documents.length) return;
    onSelectDocument(documents[0].id);
  }, [documents, onSelectDocument, selectedDocumentId]);

  useEffect(() => {
    setSelectionQuote("");
    setSearchHits([]);
    setSearchError(null);
    setProposal(null);
    setProposalError(null);
    setApplyError(null);
  }, [selectedDocumentId]);

  useEffect(() => {
    const documentId = selectedDocument?.id;
    if (!documentId || !branchId) return;
    const inlineContent = String(selectedDocument.latestVersion?.contentMd || "");
    if (inlineContent.trim()) return;
    if (hydratedContentByDocument[documentId]) return;

    let cancelled = false;
    setHydrating(true);
    setHydrationError(null);
    void getRuntimeDocument(workspaceId, branchId, documentId)
      .then((payload) => {
        if (cancelled) return;
        const latest = payload.document.latestVersion?.contentMd;
        const fallback = Array.isArray(payload.document.versions) ? payload.document.versions[0]?.contentMd : "";
        const content = String(latest || fallback || "");
        setHydratedContentByDocument((previous) => ({
          ...previous,
          [documentId]: content,
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setHydrationError(String((error as Error)?.message || "Unable to load document content."));
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });

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

  const updateSelection = useCallback(() => {
    if (!readerRef.current || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount < 1) {
      setSelectionQuote("");
      return;
    }
    const range = selection.getRangeAt(0);
    if (!readerRef.current.contains(range.commonAncestorContainer)) {
      setSelectionQuote("");
      return;
    }
    const selectedText = compactQuote(selection.toString(), 1500);
    setSelectionQuote(selectedText);
  }, []);

  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!branchId || !selectedDocument) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchHits([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const payload = await searchRuntimeDocument(workspaceId, branchId, selectedDocument.id, query, 12);
      setSearchHits(Array.isArray(payload.results?.hits) ? (payload.results.hits as DocumentSearchHit[]) : []);
    } catch (error) {
      setSearchHits([]);
      setSearchError(String((error as Error)?.message || "Search failed."));
    } finally {
      setSearching(false);
    }
  };

  const proposeEdit = async () => {
    if (!branchId || !selectedDocument) return;
    const nextInstruction = instruction.trim();
    if (!nextInstruction) {
      setProposalError("Add an edit instruction first.");
      return;
    }
    setProposing(true);
    setProposalError(null);
    setApplyError(null);
    try {
      const payload = await proposeRuntimeDocumentEdit(workspaceId, branchId, selectedDocument.id, {
        instruction: nextInstruction,
        ...(selectionQuote ? { quotedText: selectionQuote } : {}),
      });
      setProposal(payload.proposal);
    } catch (error) {
      setProposal(null);
      setProposalError(String((error as Error)?.message || "Failed to create proposal."));
    } finally {
      setProposing(false);
    }
  };

  const applyProposal = async () => {
    if (!branchId || !selectedDocument || !proposal) return;
    setApplying(true);
    setApplyError(null);
    try {
      await applyRuntimeDocumentEdit(workspaceId, branchId, selectedDocument.id, {
        proposedContentMd: proposal.proposedContentMd,
        changeSummary: proposal.changeSummary,
        baseVersionId: proposal.baseVersionId,
      });
      await Promise.all([onRefreshDocuments(), onRefreshRuntime()]);
      setProposal(null);
    } catch (error) {
      setApplyError(String((error as Error)?.message || "Failed to apply proposal."));
    } finally {
      setApplying(false);
    }
  };

  return (
    <aside className="bat-surface flex h-full min-h-0 flex-col p-3.5 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Docs</h2>
        <button
          type="button"
          onClick={() => {
            void Promise.all([onRefreshDocuments(), onRefreshRuntime()]);
          }}
          className="rounded-full border px-2.5 py-1 text-xs"
          style={{ borderColor: "var(--bat-border)" }}
        >
          <span className="inline-flex items-center gap-1">
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </span>
        </button>
      </div>

      {!branchId ? (
        <div className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}>
          Open a branch to access runtime documents.
        </div>
      ) : null}

      {branchId ? (
        <>
          <label className="mb-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--bat-border)" }}>
            <Search className="h-3.5 w-3.5" />
            <input
              value={listQuery}
              onChange={(event) => setListQuery(event.target.value)}
              placeholder="Find a document"
              className="w-full border-none bg-transparent text-sm outline-none"
            />
          </label>

          <div className="bat-scrollbar mb-3 max-h-36 space-y-1 overflow-y-auto rounded-xl border p-1.5" style={{ borderColor: "var(--bat-border)" }}>
            {filteredDocuments.map((document) => {
              const active = document.id === selectedDocument?.id;
              return (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => onSelectDocument(document.id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left ${
                    active ? "border-zinc-300 bg-zinc-50" : "border-transparent hover:border-zinc-200 hover:bg-zinc-50/60"
                  }`}
                >
                  <p className="line-clamp-1 text-xs font-semibold text-zinc-900">{document.title || document.originalFileName}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                      {document.parserStatus || "unknown"}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500">
                      v{document.latestVersion?.versionNumber || 0}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {formatFreshness(document.latestVersion?.createdAt)}
                    </span>
                  </div>
                </button>
              );
            })}
            {!filteredDocuments.length ? (
              <p className="px-2 py-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                No documents matched this filter.
              </p>
            ) : null}
          </div>

          {selectedDocument ? (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedDocument.generatedMeta?.docFamily ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] uppercase text-zinc-500">
                    {selectedDocument.generatedMeta.docFamily.replace(/_/g, " ")}
                  </span>
                ) : null}
                <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] uppercase text-zinc-500">
                  {selectedDocument.mimeType || "document"}
                </span>
                <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-500">
                  Version {selectedDocument.latestVersion?.versionNumber || 0}
                </span>
                {typeof selectedDocument.generatedMeta?.coverageScore === "number" ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-500">
                    Coverage {Math.round(selectedDocument.generatedMeta.coverageScore)}/100
                  </span>
                ) : null}
              </div>

              {selectedDocument.generatedMeta?.partial ? (
                <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  <p className="font-semibold">Partial draft returned</p>
                  {selectedDocument.generatedMeta.partialReasons?.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {selectedDocument.generatedMeta.partialReasons.slice(0, 4).map((reason) => (
                        <li key={reason}>• {reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1">Evidence quality is below deep target for this version.</p>
                  )}
                </div>
              ) : null}

              <div
                ref={readerRef}
                onMouseUp={updateSelection}
                onKeyUp={updateSelection}
                className="bat-scrollbar min-h-0 flex-1 overflow-y-auto rounded-xl border bg-white p-3 text-xs leading-5 text-zinc-700"
                style={{ borderColor: "var(--bat-border)", whiteSpace: "pre-wrap", userSelect: "text" }}
              >
                {hydrating ? "Loading document markdown..." : selectedContent || "No markdown content available yet for this document."}
              </div>

              {hydrationError ? (
                <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">{hydrationError}</div>
              ) : null}

              {selectionQuote ? (
                <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Selected quote</p>
                  <p className="mt-1 line-clamp-4 text-xs text-zinc-700">{selectionQuote}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onQuoteInChat({ document: selectedDocument, quotedText: selectionQuote })}
                      className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Quote className="h-3.5 w-3.5" />
                        Quote in chat
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectionQuote("")}
                      className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              ) : null}

              <form onSubmit={runSearch} className="mt-2">
                <label className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--bat-border)" }}>
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search in document"
                    className="w-full border-none bg-transparent text-sm outline-none"
                  />
                </label>
              </form>

              {searching ? <p className="mt-1 text-xs text-zinc-500">Searching...</p> : null}
              {searchError ? (
                <div className="mt-1 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">{searchError}</div>
              ) : null}
              {searchHits.length ? (
                <div className="bat-scrollbar mt-1.5 max-h-28 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-1.5">
                  {searchHits.map((hit) => (
                    <article key={`${hit.chunkIndex}-${hit.score}`} className="rounded-lg border border-zinc-200 bg-white p-2">
                      <p className="text-[11px] uppercase text-zinc-500">
                        Chunk {hit.chunkIndex} • score {hit.score.toFixed(2)}
                      </p>
                      <p className="mt-1 line-clamp-3 text-xs text-zinc-700">{hit.text}</p>
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">AI edit</p>
                <textarea
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="Describe the edit you want..."
                  className="mt-1.5 h-20 w-full resize-y rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void proposeEdit()}
                    disabled={proposing}
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" />
                      {proposing ? "Proposing..." : "Propose edit"}
                    </span>
                  </button>
                </div>

                {proposalError ? (
                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">{proposalError}</div>
                ) : null}
                {proposal ? (
                  <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900">
                    <p className="font-semibold">{proposal.changeSummary || "Proposal ready"}</p>
                    <p className="mt-1">
                      Base v{proposal.baseVersionNumber} • {proposal.changed ? "content changed" : "no content change"}
                    </p>
                    {proposal.anchor?.quotedText ? (
                      <p className="mt-1 text-sky-800">Quote anchor: “{compactQuote(proposal.anchor.quotedText, 220)}”</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void applyProposal()}
                      disabled={applying}
                      className="mt-2 rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs text-sky-800 hover:bg-sky-100 disabled:opacity-60"
                    >
                      {applying ? "Applying..." : "Apply proposal"}
                    </button>
                  </div>
                ) : null}
                {applyError ? (
                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">{applyError}</div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}>
              Select a document to read, quote, and edit.
            </div>
          )}
        </>
      ) : null}
    </aside>
  );
}
