"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { Send, Square, ArrowUp, ArrowDown, X, WandSparkles } from "lucide-react";
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
  onSteerRun: (note: string) => void;
  onSteerQueued: (id: string, content: string) => void;
  onStop: () => void;
  onReorderQueue: (from: number, to: number) => void;
  onDeleteQueued: (id: string) => void;
  onSteer: (chip: string) => void;
}

export function ChatComposer({
  isStreaming,
  queuedMessages,
  onSend,
  onSteerRun,
  onSteerQueued,
  onStop,
  onReorderQueue,
  onDeleteQueued,
  onSteer
}: ChatComposerProps) {
  const [message, setMessage] = useState("");

  const dispatchMessage = () => {
    const content = message.trim();
    if (!content) {
      return false;
    }

    if (isStreaming) {
      onSend(content, "queue");
      setMessage("");
      return true;
    }

    onSend(content, "send");
    setMessage("");
    return true;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatchMessage();
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    // Keep multiline typing predictable and avoid accidental sends while composing (IME).
    if (event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    dispatchMessage();
  };

  const steerRunNow = () => {
    if (!isStreaming) return;
    const content = message.trim();
    if (!content) return;
    onSteerRun(content);
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
                  <button
                    type="button"
                    aria-label="Steer run with this queued message"
                    disabled={!isStreaming}
                    onClick={() => onSteerQueued(item.id, item.content)}
                    className="rounded-full border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    Steer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {isStreaming ? (
        <p className="mb-3 text-xs" style={{ color: "var(--bat-text-muted)" }}>
          Send will queue your message. Use <strong>Steer Run</strong> to interrupt and apply direction immediately.
        </p>
      ) : null}

      <form onSubmit={submit} className="flex gap-2">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="Ask BAT to run analysis, generate a brief, or adjust strategy..."
          className="min-h-[84px] flex-1 rounded-2xl border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
        />
        <div className="flex w-32 flex-col gap-2">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 rounded-full px-3 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            <Send className="h-4 w-4" />
            {isStreaming ? "Queue" : "Run"}
          </button>
          {isStreaming ? (
            <button
              type="button"
              onClick={steerRunNow}
              disabled={!message.trim()}
              className="inline-flex items-center justify-center gap-1 rounded-full border px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ borderColor: "var(--bat-border)" }}
            >
              <WandSparkles className="h-4 w-4" /> Steer run
            </button>
          ) : null}
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
      <p className="mt-2 text-[11px]" style={{ color: "var(--bat-text-muted)" }}>
        Enter sends. Shift+Enter adds a new line.
      </p>
    </section>
  );
}
