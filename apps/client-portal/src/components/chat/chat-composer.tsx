"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListOrdered, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import { QueuedMessage } from "@/types/chat";

const steerChipSet = [
  "Go deeper",
  "Show sources",
  "Make it a PDF",
  "Focus on TikTok",
  "Focus on Web evidence",
  "Ask me questions first"
];

interface ChatComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  focusSignal?: number;
  isStreaming: boolean;
  queuedMessages: QueuedMessage[];
  onSend: (content: string, mode: "send" | "queue") => void;
  onSteerRun: (note: string) => void;
  onSteerQueued: (id: string, content: string) => void;
  onStop: () => void;
  onReorderQueue: (from: number, to: number) => void;
  onDeleteQueued: (id: string) => void;
  onSteer: (chip: string) => void;
  contentWidthClassName?: string;
}

export function ChatComposer({
  draft,
  onDraftChange,
  focusSignal,
  isStreaming,
  queuedMessages,
  onSend,
  onSteerRun,
  onSteerQueued,
  onStop,
  onReorderQueue,
  onDeleteQueued,
  onSteer,
  contentWidthClassName = "max-w-3xl",
}: ChatComposerProps) {
  const [showQueue, setShowQueue] = useState(false);
  const [showSteerChips, setShowSteerChips] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (typeof focusSignal !== "number") return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const cursor = textarea.value.length;
    textarea.setSelectionRange(cursor, cursor);
  }, [focusSignal]);

  const dispatchMessage = () => {
    const content = draft.trim();
    if (!content) {
      return false;
    }

    onSend(content, "send");
    onDraftChange("");
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
    const content = draft.trim();
    if (!content) return;
    onSteerRun(content);
    onDraftChange("");
  };

  return (
    <section className="sticky bottom-0 z-20 border-t border-zinc-200 bg-gradient-to-t from-white via-white/95 to-white/75 px-3 pb-3 pt-3 supports-[backdrop-filter]:backdrop-blur sm:px-5 sm:pb-4">
      <div className={`mx-auto w-full ${contentWidthClassName}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={`rounded-full px-2 py-1 ${isStreaming ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
              {isStreaming ? "Generating" : "Ready"}
            </span>
            {queuedMessages.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowQueue((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 text-zinc-600 hover:bg-zinc-100"
              >
                <ListOrdered className="h-3.5 w-3.5" />
                Queue {queuedMessages.length}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowSteerChips((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Quick actions
          </button>
        </div>

        {showSteerChips ? (
          <div className="bat-scrollbar mb-2.5 flex gap-1.5 overflow-x-auto pb-1">
            {steerChipSet.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onSteer(chip)}
                className="whitespace-nowrap rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        {showQueue && queuedMessages.length > 0 ? (
          <div className="mb-2.5 rounded-2xl border border-zinc-200 bg-zinc-50/90 p-2.5">
            <div className="bat-scrollbar max-h-44 space-y-1.5 overflow-y-auto pr-1">
              {queuedMessages.map((item, index) => (
                <div key={item.id} className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-2">
                  <p className="flex-1 text-sm text-zinc-700">{item.content}</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Move up"
                      onClick={() => onReorderQueue(index, index - 1)}
                      className="rounded-full border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-100"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      onClick={() => onReorderQueue(index, index + 1)}
                      className="rounded-full border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-100"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => onDeleteQueued(item.id)}
                      className="rounded-full border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Steer run with this queued message"
                      disabled={!isStreaming}
                      onClick={() => onSteerQueued(item.id, item.content)}
                      className="rounded-full border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      Steer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Message BAT..."
            className="min-h-24 w-full resize-none rounded-3xl border border-zinc-300 bg-white px-4 pb-12 pt-3 text-base text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 sm:min-h-28"
          />

          <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-zinc-400">
            Enter to send, Shift+Enter for newline
          </p>

          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
            ) : null}
            {isStreaming && draft.trim() ? (
              <button
                type="button"
                onClick={steerRunNow}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Steer
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!draft.trim()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              aria-label="Send message"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
