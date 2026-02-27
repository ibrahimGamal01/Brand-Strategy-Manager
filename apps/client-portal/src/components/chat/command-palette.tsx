"use client";

import { Command, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface CommandPaletteProps {
  onSelect: (command: string) => void;
}

const commands = [
  "Run V3 competitor finder (standard)",
  "Run V3 competitor finder (deep)",
  "Run competitor discovery (legacy)",
  "Generate PDF deliverable",
  "Show sources",
  "Search web evidence",
  "Open library: Web",
  "Open library: Competitors",
  "Add constraint",
  "Switch workspace"
];

export function CommandPalette({ onSelect }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands.filter((command) => !q || command.toLowerCase().includes(q));
  }, [query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border px-3 py-1.5 text-sm"
        style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
      >
        <span className="inline-flex items-center gap-2">
          <Command className="h-4 w-4" /> Command
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/30 pt-[15vh]">
          <div className="w-full max-w-xl rounded-2xl border p-3" style={{ background: "var(--bat-surface)", borderColor: "var(--bat-border)" }}>
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }}>
              <Search className="h-4 w-4" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commands"
                className="w-full bg-transparent outline-none"
              />
              <button type="button" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="bat-scrollbar mt-2 max-h-[50vh] space-y-1 overflow-y-auto pr-1">
              {filtered.map((command) => (
                <button
                  key={command}
                  type="button"
                  onClick={() => {
                    onSelect(command);
                    setOpen(false);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5"
                >
                  {command}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
