"use client";

import { FormEvent, useState } from "react";
import { Play, Send, Square, ArrowUp, ArrowDown, X } from "lucide-react";
import { QueuedMessage } from "@/types/chat";

const steerChipSet = [
  "Go deeper",
  "Show sources",
  "Make it a PDF",
  "Focus on TikTok",
  "Focus on Web evidence",
  "Be concise",
  "Ask me questions first"
];

interface ChatComposerProps {
  isStreaming: boolean;
  queuedMessages: QueuedMessage[];
  onSend: (content: string, mode: "send" | "queue") => void;
  onStop: () => void;
  onReorderQueue: (from: number, to: number) => void;
  onDeleteQueued: (id: string) => void;
  onSteer: (chip: string) => void;
}

export function ChatComposer({
  isStreaming,
  queuedMessages,
  onSend,
  onStop,
  onReorderQueue,
  onDeleteQueued,
  onSteer
}: ChatComposerProps) {
  const [message, setMessage] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = message.trim();
    if (!content) {
      return;
    }

    if (isStreaming) {
      const interrupt = window.confirm(
        "BAT is currently running. Press OK to interrupt and send now, or Cancel to queue this message."
      );
      onSend(content, interrupt ? "send" : "queue");
      setMessage("");
      return;
    }

    onSend(content, "send");
    setMessage("");
  };

  return (
    <section className="bat-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Steer BAT</p>
        <span className="bat-chip">Queued: {queuedMessages.length}</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {steerChipSet.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onSteer(chip)}
            className="rounded-full border px-3 py-1.5 text-xs"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
          >
            {chip}
          </button>
        ))}
      </div>

      {queuedMessages.length > 0 ? (
        <div className="mb-3 rounded-xl border p-3" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Message Queue
          </p>
          <div className="mt-2 space-y-2">
            {queuedMessages.map((item, index) => (
              <div key={item.id} className="flex items-center gap-2 rounded-xl border p-2" style={{ borderColor: "var(--bat-border)" }}>
                <p className="flex-1 text-sm">{item.content}</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => onReorderQueue(index, index - 1)}
                    className="rounded-full border p-1"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => onReorderQueue(index, index + 1)}
                    className="rounded-full border p-1"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => onDeleteQueued(item.id)}
                    className="rounded-full border p-1"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} className="flex gap-2">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask BAT to run analysis, generate a brief, or adjust strategy..."
          className="min-h-[84px] flex-1 rounded-2xl border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
        />
        <div className="flex w-28 flex-col gap-2">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 rounded-full px-3 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            {isStreaming ? <Play className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {isStreaming ? "Send" : "Run"}
          </button>
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center justify-center gap-1 rounded-full border px-3 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
