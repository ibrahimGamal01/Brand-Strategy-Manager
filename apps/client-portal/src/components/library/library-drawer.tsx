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
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        aria-label="close drawer"
        className="h-full flex-1 bg-black/25"
        onClick={onClose}
      />
      <aside className="h-full w-full max-w-md border-l p-4" style={{ background: "var(--bat-surface)", borderColor: "var(--bat-border)" }}>
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

        <div className="space-y-2 overflow-y-auto pb-4" style={{ maxHeight: "calc(100vh - 220px)" }}>
          {filtered.map((item) => (
            <article key={item.id} className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {item.summary}
              </p>
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
              <button
                type="button"
                onClick={() => onUseInChat(item)}
                className="mt-2 rounded-full border px-3 py-1 text-xs"
                style={{ borderColor: "var(--bat-border)" }}
              >
                Use in answer
              </button>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
