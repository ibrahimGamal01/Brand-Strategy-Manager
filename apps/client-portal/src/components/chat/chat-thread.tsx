"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ChatMessage, ChatMessageBlock } from "@/types/chat";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: "var(--bat-accent)", animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: "var(--bat-accent)", animationDelay: "140ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: "var(--bat-accent)", animationDelay: "280ms" }} />
    </span>
  );
}

function ReasoningPanel({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);

  if (!message.reasoning) {
    return null;
  }

  return (
    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
      <button
        type="button"
        className="flex w-full items-center justify-between text-sm font-semibold"
        onClick={() => setOpen((prev) => !prev)}
      >
        How BAT got here
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="mt-3 space-y-3 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          <div>
            <p className="font-semibold" style={{ color: "var(--bat-text)" }}>
              Plan
            </p>
            <ul className="mt-1 list-disc pl-5">
              {message.reasoning.plan.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold" style={{ color: "var(--bat-text)" }}>
              Tools used
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {message.reasoning.tools.map((tool) => (
                <span key={tool} className="bat-chip">
                  {tool}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold" style={{ color: "var(--bat-text)" }}>
              Assumptions
            </p>
            <ul className="mt-1 list-disc pl-5">
              {message.reasoning.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold" style={{ color: "var(--bat-text)" }}>
              Next steps
            </p>
            <ul className="mt-1 list-disc pl-5">
              {message.reasoning.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold" style={{ color: "var(--bat-text)" }}>
              Evidence
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {message.reasoning.evidence.map((citation) => (
                citation.href ? (
                  <a
                    key={citation.id}
                    href={citation.href}
                    target="_blank"
                    rel="noreferrer"
                    className="bat-chip hover:opacity-80"
                  >
                    {citation.label}
                  </a>
                ) : (
                  <span key={citation.id} className="bat-chip">
                    {citation.label}
                  </span>
                )
              ))}
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
    <div className="mt-3 space-y-2">
      {message.blocks.map((block, index) => {
        if (isDecisionBlock(block)) {
          return (
            <div
              key={`${message.id}-decision-${index}`}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
            >
              <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "var(--bat-text-muted)" }}>
                Approval needed
              </p>
              <div className="mt-2 space-y-2">
                {block.items.map((decision) => (
                  <div key={decision.id} className="rounded-lg border p-2" style={{ borderColor: "var(--bat-border)" }}>
                    <p className="text-sm font-semibold">{decision.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {decision.options.map((option) => (
                        <button
                          key={`${decision.id}-${option.value}`}
                          type="button"
                          onClick={() => onResolveDecision?.(decision.id, option.value)}
                          className="rounded-full border px-3 py-1 text-xs"
                          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
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
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
            >
              <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "var(--bat-text-muted)" }}>
                Next actions
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {block.actions.map((action) => (
                  <button
                    key={`${message.id}-${action.action}-${action.label}`}
                    type="button"
                    onClick={() => onRunAction?.(action.label, action.action, action.payload)}
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              {block.decisions.length ? (
                <div className="mt-3 space-y-2">
                  {block.decisions.map((decision) => (
                    <div key={decision.id} className="rounded-lg border p-2" style={{ borderColor: "var(--bat-border)" }}>
                      <p className="text-sm font-semibold">{decision.title}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {decision.options.map((option) => (
                          <button
                            key={`${decision.id}-${option.value}`}
                            type="button"
                            onClick={() => onResolveDecision?.(decision.id, option.value)}
                            className="rounded-full border px-3 py-1 text-xs"
                            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
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
  isStreaming,
  streamingInsight,
}: {
  messages: ChatMessage[];
  onForkFromMessage?: (messageId: string) => void;
  onResolveDecision?: (decisionId: string, option: string) => void;
  onRunAction?: (actionLabel: string, actionKey: string, payload?: Record<string, unknown>) => void;
  isStreaming?: boolean;
  streamingInsight?: string;
}) {
  if (!messages.length) {
    return (
      <section className="bat-surface flex min-h-[55vh] items-center justify-center p-6 text-center">
        <p className="max-w-md text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Start by asking BAT for an analysis, a 30-day plan, or a competitor audit. Results and approvals will appear
          here in one thread.
        </p>
      </section>
    );
  }

  return (
    <section className="bat-surface flex min-h-[55vh] flex-col gap-4 p-4 md:p-5">
      {messages.map((message) => (
        <article
          key={message.id}
          className="max-w-[92%] rounded-2xl border px-4 py-3"
          style={{
            borderColor: message.role === "user" ? "transparent" : "var(--bat-border)",
            marginLeft: message.role === "user" ? "auto" : 0,
            background: message.role === "user" ? "var(--bat-accent-soft)" : "var(--bat-surface)"
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
              {message.role}
            </p>
            {onForkFromMessage ? (
              <button
                type="button"
                onClick={() => onForkFromMessage(message.id)}
                className="rounded-full border px-2 py-1 text-[11px]"
                style={{ borderColor: "var(--bat-border)" }}
              >
                Fork from here
              </button>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-sm md:text-[15px]">{message.content}</p>
          {message.role === "assistant" && message.reasoning?.tools?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.reasoning.tools.slice(0, 8).map((tool) => (
                <span key={`${message.id}-${tool}`} className="bat-chip">
                  Ran {tool}
                </span>
              ))}
            </div>
          ) : null}
          <MessageBlocks message={message} onResolveDecision={onResolveDecision} onRunAction={onRunAction} />
          {message.role === "assistant" ? <ReasoningPanel message={message} /> : null}
        </article>
      ))}
      {isStreaming ? (
        <article
          className="max-w-[92%] rounded-2xl border px-4 py-3"
          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
              assistant
            </p>
            <TypingDots />
          </div>
          <p className="text-sm md:text-[15px]">
            {streamingInsight || "BAT is thinking and running tools..."}
          </p>
        </article>
      ) : null}
    </section>
  );
}
