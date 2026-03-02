"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchWorkspaceLibrary } from "@/lib/runtime-api";
import { LibraryCollection, LibraryItem } from "@/types/chat";

const COLLECTION_TABS: Array<{ id: LibraryCollection | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "web", label: "Web" },
  { id: "competitors", label: "Competitors" },
  { id: "social", label: "Social" },
  { id: "community", label: "Community" },
  { id: "news", label: "News" },
  { id: "deliverables", label: "Deliverables" },
];

const EMPTY_COUNTS = {
  web: 0,
  competitors: 0,
  social: 0,
  community: 0,
  news: 0,
  deliverables: 0,
};

function compactText(value: unknown, max = 280): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function trustBadgeStyle(status?: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "high") {
    return { borderColor: "#9ad2b2", background: "#eefaf2", color: "#166534" };
  }
  if (normalized === "medium") {
    return { borderColor: "#f5d08b", background: "#fff8eb", color: "#7a4a00" };
  }
  if (normalized === "low") {
    return { borderColor: "#f2b8b5", background: "#fdf1f0", color: "#8a1f17" };
  }
  return { borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)", color: "var(--bat-text-muted)" };
}

function toFreshnessLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown freshness";
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Updated just now";
  if (diffHours < 24) return `Updated ${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Updated ${diffDays}d ago`;
  return `Updated ${date.toLocaleDateString()}`;
}

export function WorkspaceLibraryClient({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [query, setQuery] = useState("");
  const [activeCollection, setActiveCollection] = useState<LibraryCollection | "all">("all");

  useEffect(() => {
    let cancelled = false;

    void fetchWorkspaceLibrary(workspaceId, {
      ...(activeCollection === "all" ? {} : { collection: activeCollection }),
      limit: 220,
    })
      .then((payload) => {
        if (cancelled) return;
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setCounts(payload.counts || EMPTY_COUNTS);
        setError("");
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(String((nextError as Error)?.message || "Failed to load workspace library"));
        setItems([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCollection, workspaceId]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.summary,
        item.previewText,
        ...(Array.isArray(item.details) ? item.details : []),
        ...(Array.isArray(item.tags) ? item.tags : []),
      ]
        .map((entry) => String(entry || "").toLowerCase())
        .join(" ");
      return haystack.includes(normalized);
    });
  }, [items, query]);

  return (
    <section className="space-y-5">
      <div
        className="rounded-3xl border p-5 md:p-6"
        style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
      >
        <p className="bat-chip">Workspace Library</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Evidence Library</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Browse actual workspace evidence with source links, summaries, and freshness metadata.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/app/w/${workspaceId}`}
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Return to Chat
          </Link>
          <Link href="/app" className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
            Switch Workspace
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Web", value: counts.web },
          { label: "Competitors", value: counts.competitors },
          { label: "Social", value: counts.social },
          { label: "Community", value: counts.community },
          { label: "News", value: counts.news },
          { label: "Deliverables", value: counts.deliverables },
        ].map((item) => (
          <article key={item.label} className="bat-surface p-4">
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{item.value}</p>
          </article>
        ))}
      </div>

      <div className="rounded-2xl border p-4" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <div className="flex flex-wrap items-center gap-2">
          {COLLECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === activeCollection) return;
                setLoading(true);
                setError("");
                setActiveCollection(tab.id);
              }}
              className="rounded-full border px-3 py-1.5 text-xs"
              style={{
                borderColor: "var(--bat-border)",
                background: activeCollection === tab.id ? "var(--bat-accent-soft)" : "var(--bat-surface-muted)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, summary, tags, or details"
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
          />
        </div>
      </div>

      {loading ? (
        <article className="bat-surface p-5">
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Loading workspace evidence...
          </p>
        </article>
      ) : null}

      {error ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          {error}
        </article>
      ) : null}

      {!loading && !error && filteredItems.length === 0 ? (
        <article className="bat-surface p-5">
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            No evidence items matched this filter.
          </p>
        </article>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <article key={item.id} className="bat-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-semibold">{item.title}</p>
                <div className="flex items-center gap-1.5">
                  <span className="bat-chip">{item.collection}</span>
                  <span className="rounded-full border px-2 py-0.5 text-[11px]" style={trustBadgeStyle(item.trustStatus)}>
                    {(item.trustStatus || "unknown").toUpperCase()}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                {compactText(item.summary, 420)}
              </p>
              {item.snippet ? (
                <p
                  className="mt-2 rounded-xl border px-3 py-2 text-xs"
                  style={{
                    borderColor: "var(--bat-border)",
                    background: "var(--bat-surface-muted)",
                    color: "var(--bat-text-muted)",
                  }}
                >
                  {compactText(item.snippet, 520)}
                </p>
              ) : null}
              {item.previewText ? (
                <p
                  className="mt-2 rounded-xl border px-3 py-2 text-xs"
                  style={{
                    borderColor: "var(--bat-border)",
                    background: "var(--bat-surface-muted)",
                    color: "var(--bat-text-muted)",
                  }}
                >
                  {compactText(item.previewText, 520)}
                </p>
              ) : null}
              {item.details?.length ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  {item.details.slice(0, 5).map((detail) => (
                    <span key={`${item.id}-${detail}`} className="rounded-full border px-2 py-1" style={{ borderColor: "var(--bat-border)" }}>
                      {compactText(detail, 120)}
                    </span>
                  ))}
                </div>
              ) : null}
              {item.tags.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span key={`${item.id}-${tag}`} className="bat-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {toFreshnessLabel(item.freshness)} • {item.evidenceLabel}
              </p>
              {item.evidenceCount ? (
                <p className="mt-1 text-[11px]" style={{ color: "var(--bat-text-muted)" }}>
                  {item.evidenceCount} evidence source{item.evidenceCount === 1 ? "" : "s"} linked
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {item.evidenceHref ? (
                  <a
                    href={item.evidenceHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    Open source
                  </a>
                ) : null}
                {item.downloadHref ? (
                  <a
                    href={item.downloadHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    Open downloaded content
                  </a>
                ) : null}
                {item.evidenceLinks?.slice(0, 3).map((link) => (
                  <a
                    key={`${item.id}-evidence-${link.href}`}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    {link.label}
                  </a>
                ))}
                {item.links?.map((link) => (
                  <a
                    key={`${item.id}-${link.label}-${link.href}`}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
