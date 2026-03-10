"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, PauseCircle, XCircle } from "lucide-react";
import { DecisionItem, ProcessFeedItem, ProcessRun } from "@/types/chat";

function phaseLabel(phase?: ProcessRun["phase"] | ProcessFeedItem["phase"]) {
  if (!phase) return "";
  return phase === "waiting_input" ? "Waiting input" : phase.charAt(0).toUpperCase() + phase.slice(1);
}

function stageLabel(stage?: string) {
  const normalized = String(stage || "").trim();
  if (!normalized) return "";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactText(value: string, max = 96) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function scoreTone(score?: number): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "border-zinc-200 bg-zinc-50 text-zinc-700";
  if (score >= 85) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (score >= 72) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function qualityDimensions(
  value?:
    | {
        grounding: number;
        specificity: number;
        usefulness: number;
        redundancy: number;
        tone: number;
        visual: number;
      }
    | null
) {
  if (!value) return [];
  return [
    ["Grounding", value.grounding],
    ["Specificity", value.specificity],
    ["Usefulness", value.usefulness],
    ["Redundancy", value.redundancy],
    ["Tone", value.tone],
    ["Visual", value.visual],
  ]
    .filter((entry) => Number.isFinite(entry[1]))
    .sort((a, b) => Number(b[1]) - Number(a[1]));
}

function StatusIcon({ status }: { status: ProcessRun["status"] }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />;
  if (status === "waiting_input") return <PauseCircle className="h-4 w-4 text-amber-600" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  return <XCircle className="h-4 w-4 text-red-600" />;
}

export function LiveActivityPanel({
  runs,
  feedItems,
  decisions,
  onResolve,
  onRunAudit,
  onSteer,
  onFeedItemAction,
}: {
  runs: ProcessRun[];
  feedItems: ProcessFeedItem[];
  decisions: DecisionItem[];
  onResolve: (id: string, option: string) => void;
  onRunAudit?: () => void;
  onSteer?: (instruction: string) => void;
  onFeedItemAction?: (item: ProcessFeedItem) => void;
}) {
  const [steerNote, setSteerNote] = useState("");
  const activeRun = useMemo(
    () => runs.find((run) => run.status === "running" || run.status === "waiting_input") || null,
    [runs]
  );
  const timeline = useMemo(() => feedItems.slice(0, 80), [feedItems]);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-zinc-900">Activity</h2>
        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-500">Work Ledger</span>
      </div>

      {activeRun ? (
        <div className="mx-3 mt-2 mb-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-zinc-900">{activeRun.label}</p>
            <StatusIcon status={activeRun.status} />
          </div>
          <p className="mt-1 text-xs text-zinc-600">{activeRun.stage}</p>
          <div className="mt-2 h-1.5 rounded-md bg-zinc-200">
            <div className="h-1.5 rounded-md bg-zinc-800" style={{ width: `${Math.max(0, Math.min(100, activeRun.progress))}%` }} />
          </div>
          {onSteer ? (
            <div className="mt-2 flex gap-2">
              <input
                value={steerNote}
                onChange={(event) => setSteerNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const value = steerNote.trim();
                  if (!value) return;
                  event.preventDefault();
                  onSteer(value);
                  setSteerNote("");
                }}
                placeholder="Steer current run"
                className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const value = steerNote.trim();
                  if (!value) return;
                  onSteer(value);
                  setSteerNote("");
                }}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
              >
                Send
              </button>
            </div>
          ) : null}
        </div>
      ) : onRunAudit ? (
        <div className="mx-3 mt-2 mb-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
          <p className="text-sm font-medium text-zinc-900">No active run</p>
          <p className="mt-1 text-xs text-zinc-600">Start a workspace audit or send a new message.</p>
          <button
            type="button"
            onClick={onRunAudit}
            className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
          >
            Run audit
          </button>
        </div>
      ) : null}

      {decisions.length ? (
        <div className="mx-3 mb-2 space-y-2">
          {decisions.map((decision) => (
            <article key={decision.id} className="rounded-md border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700">Approval needed</p>
              <p className="mt-1 text-sm text-zinc-800">{decision.prompt}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {decision.options.map((option) => (
                  <button
                    key={`${decision.id}-${option}`}
                    type="button"
                    onClick={() => onResolve(decision.id, option)}
                    className="rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div className="bat-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2">
        {timeline.map((item) => (
          <article key={item.id} className="rounded-md border border-zinc-200 bg-white p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500">{item.timestamp}</p>
              <div className="flex items-center gap-1.5">
                {stageLabel(item.stage) ? (
                  <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
                    {stageLabel(item.stage)}
                  </span>
                ) : null}
                {phaseLabel(item.phase) ? (
                  <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
                    {phaseLabel(item.phase)}
                  </span>
                ) : null}
                {item.loopIndex && item.loopMax ? (
                  <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
                    Loop {item.loopIndex}/{item.loopMax}
                  </span>
                ) : null}
              </div>
            </div>
            <p className="mt-1 text-sm text-zinc-800">{item.message}</p>
            {item.docFamily || typeof item.coverageScore === "number" || typeof item.qualityScore === "number" || item.renderTheme ? (
              <p className="mt-1 text-[11px] text-zinc-500">
                {[
                  item.docFamily ? item.docFamily.replace(/_/g, " ") : "",
                  typeof item.coverageScore === "number" ? `Coverage ${item.coverageScore}/100` : "",
                  typeof item.qualityScore === "number" ? `Quality ${item.qualityScore}/100` : "",
                  item.renderTheme ? `Theme ${item.renderTheme.replace(/_/g, " ")}` : "",
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </p>
            ) : null}
            {typeof item.qualityScore === "number" || item.dimensionScores || item.qualityNotes?.length ? (
              <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {typeof item.qualityScore === "number" ? (
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${scoreTone(item.qualityScore)}`}>
                      Quality {item.qualityScore}/100
                    </span>
                  ) : null}
                  {qualityDimensions(item.dimensionScores || null)
                    .slice(0, 3)
                    .map(([label, score]) => (
                      <span key={`${item.id}-${label}`} className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                        {label} {Math.round(Number(score))}
                      </span>
                    ))}
                </div>
                {item.qualityNotes?.length ? (
                  <ul className="mt-2 space-y-1 text-[11px] text-zinc-600">
                    {item.qualityNotes.slice(0, 2).map((note) => (
                      <li key={`${item.id}-${note}`}>• {note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {item.methodFamily || item.lane || item.queryVariant || typeof item.newEvidenceRefs === "number" ? (
              <p className="mt-1 text-[11px] text-zinc-500">
                {[
                  item.methodFamily ? `Methods: ${item.methodFamily}` : "",
                  item.lane ? `Lane: ${item.lane}` : "",
                  item.queryVariant ? `Variant: ${compactText(item.queryVariant, 72)}` : "",
                  typeof item.newEvidenceRefs === "number" ? `New refs ${item.newEvidenceRefs}` : "",
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </p>
            ) : null}
            {item.details?.length ? (
              <ul className="mt-1.5 space-y-1 text-xs text-zinc-600">
                {item.details.slice(0, 4).map((detail) => (
                  <li key={`${item.id}-${detail}`}>• {detail}</li>
                ))}
              </ul>
            ) : null}
            {item.actionLabel ? (
              <button
                type="button"
                onClick={() => onFeedItemAction?.(item)}
                className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
              >
                {item.actionLabel}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </aside>
  );
}
