"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, Sparkles, Trash2 } from "lucide-react";
import { CompetitorLinkItem } from "./intake-types";
import { buildLinkItems, createLinkItem } from "./link-utils";

interface SmartLinksAnswerProps {
  value: CompetitorLinkItem[];
  onChange: (next: CompetitorLinkItem[]) => void;
  maxItems?: number;
}

function splitRawLinks(value: string): string[] {
  return String(value || "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function platformLabel(item: CompetitorLinkItem): string {
  if (item.platform === "website") return "Website";
  if (item.platform === "unknown") return "Unrecognized";
  if (item.platform === "twitter") return "X";
  return item.platform[0].toUpperCase() + item.platform.slice(1);
}

export function SmartLinksAnswer({ value, onChange, maxItems = 5 }: SmartLinksAnswerProps) {
  const [draft, setDraft] = useState("");

  const reachedLimit = value.length >= maxItems;
  const canAdd = useMemo(() => !reachedLimit && draft.trim().length > 0, [draft, reachedLimit]);
  const validCount = value.filter((item) => item.valid).length;
  const invalidCount = value.length - validCount;

  function addFromRaw(inputValue?: string) {
    if (reachedLimit) return;
    const raw = typeof inputValue === "string" ? inputValue : draft;
    const parts = splitRawLinks(raw);
    if (!parts.length) return;

    const candidates = buildLinkItems(parts);
    const next = [...value];

    for (const item of candidates) {
      if (next.length >= maxItems) break;
      if (next.some((existing) => existing.id === item.id)) continue;
      next.push(item);
    }

    onChange(next);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addFromRaw();
  }

  function updateType(id: string) {
    onChange(
      value.map((item) =>
        item.id === id
          ? { ...item, kind: item.kind === "competitor" ? "inspiration" : "competitor" }
          : item
      )
    );
  }

  function updateItemRaw(id: string, raw: string) {
    const updated = createLinkItem(raw);
    if (!updated) {
      onChange(value.filter((item) => item.id !== id));
      return;
    }

    onChange(value.map((item) => (item.id === id ? { ...updated, kind: item.kind } : item)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
        <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
          {value.length}/{maxItems} added
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1" style={{ color: "var(--bat-success)" }}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {validCount} ready
          </span>
          {invalidCount > 0 ? (
            <span className="inline-flex items-center gap-1" style={{ color: "var(--bat-warning)" }}>
              <AlertTriangle className="h-3.5 w-3.5" />
              {invalidCount} need review
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData("text") || "";
            if (!/[\n,]/.test(pasted)) return;
            event.preventDefault();
            addFromRaw(pasted);
          }}
          className="w-full rounded-xl border px-3 py-2 text-sm"
          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text)" }}
          placeholder="Paste a competitor URL or handle"
          disabled={reachedLimit}
        />
        <button
          type="button"
          onClick={() => addFromRaw()}
          disabled={!canAdd}
          className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: "var(--bat-border)" }}
        >
          Add
        </button>
      </div>

      <div className="space-y-2">
        {value.length === 0 ? (
          <div
            className="rounded-xl border px-3 py-3 text-xs"
            style={{ borderColor: "var(--bat-border)", background: "color-mix(in srgb, var(--bat-accent-soft) 35%, white)" }}
          >
            <p className="mb-1 inline-flex items-center gap-1 font-medium">
              <Sparkles className="h-3.5 w-3.5" />
              BAT tip
            </p>
            <p style={{ color: "var(--bat-text-muted)" }}>
              Paste URLs, @handles, or one link per line. BAT will normalize each one into competitor cards automatically.
            </p>
          </div>
        ) : null}

        {value.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border px-3 py-2"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
            data-animate="fade-up"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  <Link2 className="h-3.5 w-3.5" />
                  <span>{platformLabel(item)}</span>
                  {item.hostname ? <span>• {item.hostname}</span> : null}
                  {!item.valid ? <span style={{ color: "var(--bat-warning)" }}>Needs review</span> : null}
                </div>
                <input
                  type="text"
                  value={item.raw}
                  onChange={(event) => updateItemRaw(item.id, event.target.value)}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text)" }}
                />
                <p className="truncate text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  {item.normalizedUrl || "Could not normalize this entry"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateType(item.id)}
                  className="rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.08em]"
                  style={{ borderColor: "var(--bat-border)" }}
                >
                  {item.kind === "competitor" ? "Competitor" : "Inspiration"}
                </button>
                {item.valid ? (
                  <a
                    href={item.normalizedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-lg border p-1.5"
                    style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}
                    aria-label="Open link"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((entry) => entry.id !== item.id))}
                  className="rounded-lg border p-1.5"
                  style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}
                  aria-label="Remove link"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
        Add up to {maxItems} links. Multi-line paste works automatically.
      </p>
    </div>
  );
}
