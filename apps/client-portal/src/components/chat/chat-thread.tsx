"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ChatMessage, ChatMessageBlock } from "@/types/chat";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500/90" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500/90" style={{ animationDelay: "140ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500/90" style={{ animationDelay: "280ms" }} />
    </span>
  );
}

function formatMessageTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function ReasoningPanel({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);

  if (!message.reasoning) {
    return null;
  }

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/90 p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-sm font-semibold text-zinc-700"
        onClick={() => setOpen((prev) => !prev)}
      >
        How BAT got here
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="mt-3 space-y-3 text-sm text-zinc-600">
          <div>
            <p className="font-semibold text-zinc-900">Plan</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {message.reasoning.plan.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Tools used</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {message.reasoning.tools.map((tool) => (
                <span key={tool} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600">
                  {tool}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Assumptions</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {message.reasoning.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Next steps</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {message.reasoning.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-zinc-900">Evidence</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {message.reasoning.evidence.map((citation) =>
                citation.href ? (
                  <a
                    key={citation.id}
                    href={citation.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                  >
                    {citation.label}
                  </a>
                ) : (
                  <span key={citation.id} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700">
                    {citation.label}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageBlocks({
  message,
  onResolveDecision,
  onRunAction,
}: {
  message: ChatMessage;
  onResolveDecision?: (decisionId: string, option: string) => void;
  onRunAction?: (actionLabel: string, actionKey: string, payload?: Record<string, unknown>) => void;
}) {
  if (!message.blocks?.length || message.role !== "assistant") return null;

  const isDecisionBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "decision_requests" }> => block.type === "decision_requests";
  const isActionBlock = (
    block: ChatMessageBlock
  ): block is Extract<ChatMessageBlock, { type: "action_buttons" }> => block.type === "action_buttons";

  return (
    <div className="mt-4 space-y-2.5">
      {message.blocks.map((block, index) => {
        if (isDecisionBlock(block)) {
          return (
            <div
              key={`${message.id}-decision-${index}`}
              className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700">Approval needed</p>
              <div className="mt-2 space-y-2">
                {block.items.map((decision) => (
                  <div key={decision.id} className="rounded-xl border border-amber-200 bg-white p-2.5">
                    <p className="text-sm font-semibold text-zinc-900">{decision.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {decision.options.map((option) => (
                        <button
                          key={`${decision.id}-${option.value}`}
                          type="button"
                          onClick={() => onResolveDecision?.(decision.id, option.value)}
                          className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100"
                        >
                          {option.label || option.value}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (isActionBlock(block)) {
          return (
            <div
              key={`${message.id}-actions-${index}`}
              className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Quick actions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {block.actions.map((action) => (
                  <button
                    key={`${message.id}-${action.action}-${action.label}`}
                    type="button"
                    onClick={() => onRunAction?.(action.label, action.action, action.payload)}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              {block.decisions.length ? (
                <div className="mt-3 space-y-2">
                  {block.decisions.map((decision) => (
                    <div key={decision.id} className="rounded-xl border border-zinc-200 bg-white p-2.5">
                      <p className="text-sm font-semibold text-zinc-900">{decision.title}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {decision.options.map((option) => (
                          <button
                            key={`${decision.id}-${option.value}`}
                            type="button"
                            onClick={() => onResolveDecision?.(decision.id, option.value)}
                            className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                          >
                            {option.label || option.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export function ChatThread({
  messages,
  onForkFromMessage,
  onResolveDecision,
  onRunAction,
  onInspectAssistantMessage,
  selectedAssistantMessageId,
  showInlineReasoning = false,
  isStreaming,
  streamingInsight,
  contentWidthClassName = "max-w-3xl",
}: {
  messages: ChatMessage[];
  onForkFromMessage?: (messageId: string) => void;
  onResolveDecision?: (decisionId: string, option: string) => void;
  onRunAction?: (actionLabel: string, actionKey: string, payload?: Record<string, unknown>) => void;
  onInspectAssistantMessage?: (messageId: string) => void;
  selectedAssistantMessageId?: string | null;
  showInlineReasoning?: boolean;
  isStreaming?: boolean;
  streamingInsight?: string;
  contentWidthClassName?: string;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const visibleMessages = useMemo(() => messages.filter((message) => message.role !== "system"), [messages]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceToBottom < 200) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [visibleMessages.length, isStreaming, streamingInsight]);

  if (!visibleMessages.length) {
    return (
      <section className="flex min-h-0 flex-1 items-start justify-center bg-[linear-gradient(180deg,#f7f7f8_0%,#f2f4f7_100%)] p-5 pt-10 text-center sm:p-10 sm:pt-14">
        <div className="mx-auto w-full max-w-4xl">
          <p className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">How can I help with this workspace?</p>
          <p className="mt-3 text-base text-zinc-500 sm:text-lg">
            Ask for analysis, implementation, debugging, or evidence review and I will run the right tools and respond here.
          </p>
          <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
            <article className="rounded-2xl border border-zinc-200 bg-white/92 p-4 shadow-md">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Audit</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">Run a full workspace audit</p>
              <p className="mt-1 text-xs text-zinc-500">Web, competitors, social, community, and action priorities.</p>
            </article>
            <article className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-md">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Evidence</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">Ask with source constraints</p>
              <p className="mt-1 text-xs text-zinc-500">Try “Use evidence from…” to ground output in specific data.</p>
            </article>
            <article className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-md">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Deliverable</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">Generate client-ready output</p>
              <p className="mt-1 text-xs text-zinc-500">Briefs, audits, and PDFs from this branch context.</p>
            </article>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={scrollRef} className="bat-scrollbar min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f7f7f8_0%,#f2f4f7_100%)]">
      <div className={`mx-auto w-full ${contentWidthClassName} px-5 pb-24 pt-8 sm:px-8 xl:px-10`}>
        {visibleMessages.map((message) => {
          const isUser = message.role === "user";
          return (
            <article key={message.id} className="group mb-6">
              <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={
                    isUser
                      ? "max-w-[96%] rounded-3xl bg-[#2f2f32] px-4 py-3 text-white shadow-lg sm:max-w-[88%] 2xl:max-w-[82%]"
                      : "max-w-[98%] rounded-3xl border border-zinc-200 bg-white px-4 py-3 text-zinc-900 shadow-md sm:max-w-[94%] 2xl:max-w-[90%]"
                  }
                >
                  {!isUser ? (
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-zinc-400">Assistant</p>
                  ) : null}
                  <p className={`whitespace-pre-wrap break-words text-base leading-7 ${isUser ? "text-white" : "text-zinc-800"}`}>
                    {message.content}
                  </p>
                  <p className={`mt-2 text-xs ${isUser ? "text-zinc-300" : "text-zinc-400"}`}>{formatMessageTime(message.createdAt)}</p>
                </div>
              </div>

              {!isUser ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                  {onInspectAssistantMessage ? (
                    <button
                      type="button"
                      onClick={() => onInspectAssistantMessage(message.id)}
                      className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                    >
                      {selectedAssistantMessageId === message.id ? "Thoughts open" : "Open thoughts"}
                    </button>
                  ) : null}
                  {onForkFromMessage ? (
                    <button
                      type="button"
                      onClick={() => onForkFromMessage(message.id)}
                      className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                    >
                      Fork from here
                    </button>
                  ) : null}
                </div>
              ) : null}

              <MessageBlocks message={message} onResolveDecision={onResolveDecision} onRunAction={onRunAction} />
              {showInlineReasoning && message.role === "assistant" ? <ReasoningPanel message={message} /> : null}
            </article>
          );
        })}

        {isStreaming ? (
            <article className="mb-8">
              <div className="mb-2 flex items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-400">Assistant</p>
              <TypingDots />
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-md">
              <p className="text-base leading-7 text-zinc-700">
                {streamingInsight || "Thinking and running tools..."}
              </p>
            </div>
          </article>
        ) : null}
        <div ref={endRef} />
      </div>
    </section>
  );
}
