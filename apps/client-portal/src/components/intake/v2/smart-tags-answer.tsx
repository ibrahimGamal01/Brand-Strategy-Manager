"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { X } from "lucide-react";

interface SmartTagsAnswerProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  maxItems?: number;
}

function normalizeTag(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^,+|,+$/g, "");
}

function parseTags(raw: string): string[] {
  return String(raw || "")
    .split(/[\n,]+/)
    .map(normalizeTag)
    .filter(Boolean);
}

export function SmartTagsAnswer({
  value,
  onChange,
  placeholder,
  maxItems = 15,
}: SmartTagsAnswerProps) {
  const [draft, setDraft] = useState("");

  const reachedLimit = value.length >= maxItems;
  const canAdd = useMemo(() => !reachedLimit && normalizeTag(draft).length > 0, [draft, reachedLimit]);

  function addDraft(inputValue?: string) {
    const raw = typeof inputValue === "string" ? inputValue : draft;
    const tokens = parseTags(raw);
    if (!tokens.length) return;

    const next = [...value];
    for (const token of tokens) {
      if (next.length >= maxItems) break;
      if (next.some((item) => item.toLowerCase() === token.toLowerCase())) continue;
      next.push(token);
    }

    onChange(next);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addDraft();
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addDraft()}
        onPaste={(event) => {
          const pasted = event.clipboardData?.getData("text") || "";
          if (!/[\n,]/.test(pasted)) return;
          event.preventDefault();
          addDraft(pasted);
        }}
        className="w-full rounded-xl border px-3 py-2 text-sm"
        style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text)" }}
        placeholder={placeholder}
        disabled={reachedLimit}
      />

      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)", color: "var(--bat-text)" }}
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((item) => item !== tag))}
              aria-label={`Remove ${tag}`}
              className="inline-flex"
              style={{ color: "var(--bat-text-muted)" }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
        Add up to {maxItems} tags.
      </p>

      <button
        type="button"
        onClick={() => addDraft()}
        disabled={!canAdd}
        className="rounded-full border px-3 py-1 text-xs disabled:opacity-50"
        style={{ borderColor: "var(--bat-border)" }}
      >
        Add tag
      </button>
    </div>
  );
}
