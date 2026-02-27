"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { LibraryCollection, LibraryItem } from "@/types/chat";

const collections: Array<{ id: LibraryCollection | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "web", label: "Web" },
  { id: "competitors", label: "Competitors" },
  { id: "social", label: "Social" },
  { id: "community", label: "Community" },
  { id: "news", label: "News" },
  { id: "deliverables", label: "Deliverables" }
];

export function LibraryDrawer({
  open,
  onClose,
  items,
  activeCollection,
  onCollectionChange,
  onUseInChat
}: {
  open: boolean;
  onClose: () => void;
  items: LibraryItem[];
  activeCollection: LibraryCollection | "all";
  onCollectionChange: (collection: LibraryCollection | "all") => void;
  onUseInChat: (item: LibraryItem) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchesCollection = activeCollection === "all" || item.collection === activeCollection;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.tags.join(" ").toLowerCase().includes(q);
      return matchesCollection && matchesQuery;
    });
  }, [activeCollection, items, query]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="close drawer"
        className="h-full flex-1 bg-black/25"
        onClick={onClose}
      />
      <aside
        className="flex h-full w-full max-w-[min(100vw,520px)] min-w-[320px] flex-col border-l p-4 sm:min-w-[360px]"
        style={{ background: "var(--bat-surface)", borderColor: "var(--bat-border)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Library</h2>
          <button type="button" onClick={onClose} className="rounded-full border p-2" style={{ borderColor: "var(--bat-border)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }}>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            <Search className="h-4 w-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search evidence"
              className="w-full border-none bg-transparent outline-none"
            />
          </label>
        </div>

        <div className="my-3 flex flex-wrap gap-2">
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              onClick={() => onCollectionChange(collection.id)}
              className="rounded-full border px-3 py-1.5 text-xs"
              style={{
                borderColor: "var(--bat-border)",
                background: activeCollection === collection.id ? "var(--bat-accent-soft)" : "var(--bat-surface-muted)"
              }}
            >
              {collection.label}
            </button>
          ))}
        </div>

        <div className="bat-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pb-4 pr-1">
          {filtered.map((item) => (
            <article key={item.id} className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{item.title}</p>
                <span className="bat-chip">{item.collection}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {item.summary}
              </p>
              {item.previewText ? (
                <p
                  className="mt-2 rounded-lg border px-2 py-2 text-xs"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)", color: "var(--bat-text-muted)" }}
                >
                  {item.previewText}
                </p>
              ) : null}
              {item.details?.length ? (
                <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  {item.details.slice(0, 4).map((detail) => (
                    <li key={`${item.id}-${detail}`}>• {detail}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <span key={tag} className="bat-chip">
                    {tag}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {item.freshness} • {item.evidenceLabel}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onUseInChat(item)}
                  className="rounded-full border px-3 py-1 text-xs"
                  style={{ borderColor: "var(--bat-border)" }}
                >
                  Use in answer
                </button>
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
      </aside>
    </div>
  );
}
