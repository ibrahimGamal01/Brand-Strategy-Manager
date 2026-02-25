"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

interface SmartListAnswerProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  maxItems?: number;
  helperText?: string;
}

function normalizeText(value: string): string {
  return String(value || "").trim();
}

function tokenize(value: string): string[] {
  const raw = String(value || "");
  const parts = raw.includes("\n") ? raw.split(/\n+/) : raw.split(",");
  return parts.map(normalizeText).filter(Boolean);
}

export function SmartListAnswer({
  value,
  onChange,
  placeholder,
  maxItems = 10,
  helperText,
}: SmartListAnswerProps) {
  const [draft, setDraft] = useState("");

  const reachedLimit = value.length >= maxItems;
  const remaining = Math.max(0, maxItems - value.length);

  const canAdd = useMemo(() => !reachedLimit && normalizeText(draft).length > 0, [draft, reachedLimit]);

  function addFromInput() {
    if (reachedLimit) return;
    const tokens = tokenize(draft);
    if (!tokens.length) return;

    const next = [...value];
    for (const token of tokens) {
      if (next.length >= maxItems) break;
      if (next.includes(token)) continue;
      next.push(token);
    }

    onChange(next);
    setDraft("");
  }

  function addFromRaw(raw: string) {
    if (reachedLimit) return;
    const tokens = tokenize(raw);
    if (!tokens.length) return;

    const next = [...value];
    for (const token of tokens) {
      if (next.length >= maxItems) break;
      if (next.includes(token)) continue;
      next.push(token);
    }
    onChange(next);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addFromInput();
  }

  function removeItem(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function updateItem(index: number, nextValue: string) {
    const normalized = normalizeText(nextValue);
    const next = [...value];
    next[index] = normalized;
    onChange(next.filter(Boolean));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData("text") || "";
            if (!pasted.includes("\n")) return;
            event.preventDefault();
            addFromRaw(pasted);
          }}
          className="w-full rounded-xl border px-3 py-2 text-sm"
          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text)" }}
          placeholder={placeholder}
          disabled={reachedLimit}
        />
        <button
          type="button"
          onClick={addFromInput}
          disabled={!canAdd}
          className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: "var(--bat-border)" }}
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={`${index}-${item}`} className="flex items-center gap-2">
            <input
              type="text"
              value={item}
              onChange={(event) => updateItem(index, event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text)" }}
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="rounded-lg border p-2"
              style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}
              aria-label="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
        {helperText || `Add up to ${maxItems} items.`} {remaining} left.
      </p>
    </div>
  );
}
