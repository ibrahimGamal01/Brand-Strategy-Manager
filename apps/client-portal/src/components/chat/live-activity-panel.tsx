"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, PauseCircle, XCircle } from "lucide-react";
import { DecisionItem, ProcessFeedItem, ProcessRun } from "@/types/chat";

type Tab = "running" | "feed" | "decisions";

function StatusIcon({ status }: { status: ProcessRun["status"] }) {
  if (status === "running") {
    return <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--bat-accent)" }} />;
  }
  if (status === "waiting_input") {
    return <PauseCircle className="h-4 w-4" style={{ color: "var(--bat-warning)" }} />;
  }
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4" style={{ color: "var(--bat-success)" }} />;
  }
  if (status === "failed") {
    return <XCircle className="h-4 w-4" style={{ color: "#b3261e" }} />;
  }
  return <Clock3 className="h-4 w-4" style={{ color: "var(--bat-text-muted)" }} />;
}

function RunningTab({ runs }: { runs: ProcessRun[] }) {
  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <article key={run.id} className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{run.label}</p>
            <StatusIcon status={run.status} />
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
            {run.stage}
          </p>
          <div className="mt-2 h-2 rounded-full" style={{ background: "var(--bat-surface-muted)" }}>
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${Math.max(0, Math.min(100, run.progress))}%`,
                background: "var(--bat-accent)"
              }}
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
            {run.progress}%
          </p>
        </article>
      ))}
    </div>
  );
}

function FeedTab({ feedItems }: { feedItems: ProcessFeedItem[] }) {
  return (
    <div className="space-y-2">
      {feedItems.map((item) => (
        <article key={item.id} className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              {item.timestamp}
            </p>
            {item.actionLabel ? (
              <button
                type="button"
                className="rounded-full border px-2 py-1 text-xs"
                style={{ borderColor: "var(--bat-border)" }}
              >
                {item.actionLabel}
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-sm">{item.message}</p>
        </article>
      ))}
    </div>
  );
}

function DecisionsTab({
  decisions,
  onResolve,
}: {
  decisions: DecisionItem[];
  onResolve: (id: string, option: string) => void;
}) {
  if (!decisions.length) {
    return (
      <div className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}>
        No pending approvals right now.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {decisions.map((decision) => (
        <article key={decision.id} className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
          <p className="text-sm font-semibold">{decision.prompt}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {decision.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onResolve(decision.id, option)}
                className="rounded-full border px-3 py-1.5 text-xs"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
              >
                {option}
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function LiveActivityPanel({
  runs,
  feedItems,
  decisions,
  onResolve
}: {
  runs: ProcessRun[];
  feedItems: ProcessFeedItem[];
  decisions: DecisionItem[];
  onResolve: (id: string, option: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("running");
  const tabs = useMemo(
    () => [
      { id: "running" as const, label: "Now Running" },
      { id: "feed" as const, label: "Activity Feed" },
      { id: "decisions" as const, label: "Approvals" }
    ],
    []
  );

  return (
    <aside className="bat-surface h-full p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Live Activity</h2>
        <span className="bat-chip">Client Friendly View</span>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-full p-1" style={{ background: "var(--bat-surface-muted)" }}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className="rounded-full px-2 py-1 text-xs"
            style={{
              background: tab === item.id ? "var(--bat-surface)" : "transparent",
              border: tab === item.id ? "1px solid var(--bat-border)" : "1px solid transparent"
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="max-h-[62vh] overflow-y-auto pr-1">
        {tab === "running" ? <RunningTab runs={runs} /> : null}
        {tab === "feed" ? <FeedTab feedItems={feedItems} /> : null}
        {tab === "decisions" ? <DecisionsTab decisions={decisions} onResolve={onResolve} /> : null}
      </div>
    </aside>
  );
}
