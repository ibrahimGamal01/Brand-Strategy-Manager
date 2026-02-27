"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, PauseCircle, X, XCircle } from "lucide-react";
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

function phaseLabel(phase?: ProcessRun["phase"] | ProcessFeedItem["phase"]) {
  if (!phase) return null;
  if (phase === "waiting_input") return "Waiting input";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function phaseChipStyle(phase?: ProcessRun["phase"] | ProcessFeedItem["phase"]) {
  if (phase === "failed" || phase === "cancelled") {
    return { borderColor: "#f2b8b5", background: "#fdf1f0", color: "#8a1f17" };
  }
  if (phase === "waiting_input") {
    return { borderColor: "#f5d08b", background: "#fff8eb", color: "#7a4a00" };
  }
  if (phase === "completed") {
    return { borderColor: "#9ad2b2", background: "#eefaf2", color: "#166534" };
  }
  if (phase === "writing") {
    return { borderColor: "#9ac5f7", background: "#eef6ff", color: "#134a8a" };
  }
  return { borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text-muted)" };
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: "var(--bat-accent)", animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: "var(--bat-accent)", animationDelay: "140ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: "var(--bat-accent)", animationDelay: "280ms" }} />
    </span>
  );
}

function V3RunDetailDrawer({
  run,
  onClose,
  onResolve,
}: {
  run: ProcessRun;
  onClose: () => void;
  onResolve: (id: string, option: string) => void;
}) {
  const v3 = run.v3Detail;
  if (!v3) return null;

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-black/20">
      <section
        className="bat-surface bat-scrollbar flex h-full w-[92%] max-w-[28rem] flex-col overflow-y-auto border-l p-4"
        style={{ borderColor: "var(--bat-border)" }}
      >
        <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 border-b px-4 py-3 backdrop-blur"
          style={{ borderColor: "var(--bat-border)", background: "color-mix(in srgb, var(--bat-surface) 92%, transparent)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
                V3 Run Details
              </p>
              <p className="mt-1 text-sm font-semibold">{run.label}</p>
              <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {v3.mode ? `Mode: ${v3.mode}` : "Competitor discovery detail"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border p-1.5"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              aria-label="Close V3 details"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {v3.stats?.length ? (
          <section className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Run Stats
            </p>
            <div className="grid grid-cols-2 gap-2">
              {v3.stats.map((metric) => (
                <div
                  key={`${run.id}-v3-metric-${metric.key}-${metric.value}`}
                  className="rounded-lg border px-2.5 py-2"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                >
                  <p className="text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
                    {metric.key}
                  </p>
                  <p className="text-sm font-semibold">{metric.value}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {v3.laneStats.length ? (
          <section className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Lane Performance
            </p>
            <div className="space-y-2">
              {v3.laneStats.map((lane) => {
                const ratio = lane.queries > 0 ? Math.min(100, Math.round((lane.hits / lane.queries) * 100)) : 0;
                return (
                  <div
                    key={`${run.id}-lane-${lane.lane}`}
                    className="rounded-lg border px-2.5 py-2"
                    style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <p className="font-semibold">{lane.lane}</p>
                      <p style={{ color: "var(--bat-text-muted)" }}>
                        {lane.hits} hit(s) / {lane.queries} query
                      </p>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full" style={{ background: "var(--bat-surface)" }}>
                      <div className="h-1.5 rounded-full" style={{ width: `${ratio}%`, background: "var(--bat-accent)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {v3.topCandidates.length ? (
          <section className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Top Candidates
            </p>
            <div className="space-y-2">
              {v3.topCandidates.map((candidate) =>
                candidate.url ? (
                  <a
                    key={`${run.id}-candidate-${candidate.label}`}
                    href={candidate.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border px-2.5 py-2 text-xs hover:underline"
                    style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                  >
                    {candidate.label}
                  </a>
                ) : (
                  <p
                    key={`${run.id}-candidate-${candidate.label}`}
                    className="rounded-lg border px-2.5 py-2 text-xs"
                    style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                  >
                    {candidate.label}
                  </p>
                )
              )}
            </div>
          </section>
        ) : null}

        {v3.evidenceLinks.length ? (
          <section className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Evidence Links
            </p>
            <div className="space-y-2">
              {v3.evidenceLinks.map((link) =>
                link.url ? (
                  <a
                    key={`${run.id}-evidence-${link.label}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border px-2.5 py-2 text-xs hover:underline"
                    style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
                  >
                    {link.label}
                  </a>
                ) : (
                  <p
                    key={`${run.id}-evidence-${link.label}`}
                    className="rounded-lg border px-2.5 py-2 text-xs"
                    style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
                  >
                    {link.label}
                  </p>
                )
              )}
            </div>
          </section>
        ) : null}

        {v3.approvals.length ? (
          <section className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Pending Approvals
            </p>
            <div className="space-y-2">
              {v3.approvals.map((decision) => (
                <article
                  key={`${run.id}-approval-${decision.id}`}
                  className="rounded-lg border px-2.5 py-2"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                >
                  <p className="text-xs font-semibold">{decision.prompt}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {decision.options.map((option) => (
                      <button
                        key={`${decision.id}-${option}`}
                        type="button"
                        onClick={() => onResolve(decision.id, option)}
                        className="rounded-full border px-2.5 py-1 text-[11px]"
                        style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {v3.warnings.length ? (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Warnings
            </p>
            <ul className="space-y-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
              {v3.warnings.map((warning) => (
                <li key={`${run.id}-warning-${warning}`}>• {warning}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </div>
  );
}

function RunningTab({
  runs,
  feedItems,
  decisions,
  onResolve,
  onRunAudit,
  onSteer,
}: {
  runs: ProcessRun[];
  feedItems: ProcessFeedItem[];
  decisions: DecisionItem[];
  onResolve: (id: string, option: string) => void;
  onRunAudit?: () => void;
  onSteer?: (instruction: string) => void;
}) {
  const [manualSteer, setManualSteer] = useState("");
  const [insightIndex, setInsightIndex] = useState(0);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);

  const insightLines = useMemo(() => {
    const fromFeed = feedItems.map((item) => item.message).filter(Boolean).slice(0, 8);
    const fromRuns = runs.map((run) => `${run.label}: ${run.stage}`);
    const combined = [...fromFeed, ...fromRuns];
    return combined.length ? combined : ["BAT is reviewing workspace intelligence and preparing the next response."];
  }, [feedItems, runs]);

  useEffect(() => {
    if (insightLines.length <= 1) return;
    const timer = setInterval(() => {
      setInsightIndex((current) => (current + 1) % insightLines.length);
    }, 2600);
    return () => clearInterval(timer);
  }, [insightLines.length]);

  if (!runs.length) {
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--bat-border)" }}>
        <p className="text-sm font-semibold">No active runs right now.</p>
        <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
          BAT can immediately run a workspace intelligence audit across web, competitors, social, and news.
        </p>
        {onRunAudit ? (
          <button
            type="button"
            onClick={onRunAudit}
            className="mt-3 rounded-full border px-3 py-1.5 text-xs"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
          >
            Run Audit Now
          </button>
        ) : null}
      </div>
    );
  }

  const currentInsight = insightLines[insightIndex % insightLines.length];
  const steerPresets = [
    "Use my latest message as top priority.",
    "Show evidence first, then recommendation.",
    "Be detailed and action-oriented.",
  ];
  const detailRun = runs.find((run) => run.id === detailRunId && run.v3Detail) || null;

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3">
      <article className="shrink-0 rounded-xl border p-3" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">BAT is actively working</p>
          <TypingDots />
        </div>
        <p className="mt-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
          {currentInsight}
        </p>
        {onSteer ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {steerPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onSteer(preset)}
                  className="rounded-full border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
                >
                  Steer: {preset.slice(0, 28)}{preset.length > 28 ? "..." : ""}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={manualSteer}
                onChange={(event) => setManualSteer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const value = manualSteer.trim();
                  if (!value) return;
                  event.preventDefault();
                  onSteer(value);
                  setManualSteer("");
                }}
                placeholder="Type a quick steer note"
                className="w-full rounded-xl border px-3 py-2 text-xs outline-none"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              />
              <button
                type="button"
                disabled={!manualSteer.trim()}
                onClick={() => {
                  const value = manualSteer.trim();
                  if (!value) return;
                  onSteer(value);
                  setManualSteer("");
                }}
                className="rounded-full border px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              >
                Steer run
              </button>
            </div>
          </div>
        ) : null}
      </article>

      <div className="bat-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {runs.map((run) => (
          <article key={run.id} className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{run.label}</p>
                {phaseLabel(run.phase) ? (
                  <span
                    className="mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs"
                    style={phaseChipStyle(run.phase)}
                  >
                    {phaseLabel(run.phase)}
                  </span>
                ) : null}
              </div>
              <StatusIcon status={run.status} />
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
              {run.stage}
            </p>
            {run.details?.length ? (
              <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {run.details.map((detail) => (
                  <li key={`${run.id}-${detail}`}>• {detail}</li>
                ))}
              </ul>
            ) : null}
            {run.metrics?.length ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {run.metrics.map((metric) => (
                  <div
                    key={`${run.id}-metric-${metric.key}-${metric.value}`}
                    className="rounded-lg border px-2 py-1.5"
                    style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                  >
                    <p className="text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
                      {metric.key}
                    </p>
                    <p className="text-xs font-semibold">{metric.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {run.highlights?.length ? (
              <div className="mt-2 space-y-1">
                {run.highlights.map((item) =>
                  item.url ? (
                    <a
                      key={`${run.id}-highlight-${item.label}`}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate rounded-lg border px-2 py-1 text-xs hover:underline"
                      style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
                    >
                      {item.label}
                    </a>
                  ) : (
                    <p
                      key={`${run.id}-highlight-${item.label}`}
                      className="truncate rounded-lg border px-2 py-1 text-xs"
                      style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
                    >
                      {item.label}
                    </p>
                  )
                )}
              </div>
            ) : null}
            {run.v3Detail ? (
              <button
                type="button"
                onClick={() => setDetailRunId(run.id)}
                className="mt-2 rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              >
                Open V3 details
              </button>
            ) : null}
            <div className="mt-2 h-2 rounded-full" style={{ background: "var(--bat-surface-muted)" }}>
              <div
                className="h-2 rounded-full transition-all"
                style={{
                  width: `${Math.max(0, Math.min(100, run.progress))}%`,
                  background: "var(--bat-accent)"
                }}
              />
            </div>
          </article>
        ))}
      </div>

      {detailRun?.v3Detail ? (
        <V3RunDetailDrawer
          run={{
            ...detailRun,
            v3Detail: {
              ...detailRun.v3Detail,
              approvals:
                detailRun.v3Detail.approvals.length > 0
                  ? detailRun.v3Detail.approvals
                  : decisions.filter((decision) => decision.runId === detailRun.id),
            },
          }}
          onClose={() => setDetailRunId(null)}
          onResolve={onResolve}
        />
      ) : null}
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
            <div className="flex items-center gap-2">
              {item.toolName ? <span className="bat-chip">{item.toolName}</span> : null}
              {item.runId ? <span className="bat-chip">Run {item.runId.slice(0, 8)}</span> : null}
              {phaseLabel(item.phase) ? (
                <span className="rounded-full border px-2 py-0.5 text-xs" style={phaseChipStyle(item.phase)}>
                  {phaseLabel(item.phase)}
                </span>
              ) : null}
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
  onResolve,
  onRunAudit,
  onSteer
}: {
  runs: ProcessRun[];
  feedItems: ProcessFeedItem[];
  decisions: DecisionItem[];
  onResolve: (id: string, option: string) => void;
  onRunAudit?: () => void;
  onSteer?: (instruction: string) => void;
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
    <aside className="bat-surface flex h-full min-h-0 flex-col p-3.5 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Live Activity</h2>
        <span className="bat-chip">Client Friendly View</span>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-full p-1" style={{ background: "var(--bat-surface-muted)" }}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className="rounded-full px-2 py-1 text-xs leading-tight"
            style={{
              background: tab === item.id ? "var(--bat-surface)" : "transparent",
              border: tab === item.id ? "1px solid var(--bat-border)" : "1px solid transparent"
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "running" ? (
          <RunningTab
            runs={runs}
            feedItems={feedItems}
            decisions={decisions}
            onResolve={onResolve}
            onRunAudit={onRunAudit}
            onSteer={onSteer}
          />
        ) : null}
        {tab === "feed" ? (
          <div className="bat-scrollbar h-full overflow-y-auto pr-1">
            <FeedTab feedItems={feedItems} />
          </div>
        ) : null}
        {tab === "decisions" ? (
          <div className="bat-scrollbar h-full overflow-y-auto pr-1">
            <DecisionsTab decisions={decisions} onResolve={onResolve} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
