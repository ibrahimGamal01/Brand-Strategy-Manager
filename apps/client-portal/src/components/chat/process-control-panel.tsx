"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import {
  answerWorkspaceProcessQuestion,
  createWorkspaceProcessRun,
  escalateWorkspaceProcessRun,
  fetchWorkspaceProcessRun,
  fetchWorkspaceProcessRunPlan,
  ProcessRequestMode,
  listWorkspaceProcessQuestions,
  listWorkspaceProcessRuns,
  listWorkspaceProcessSections,
  listWorkspaceSectionRevisions,
  ProcessQuestionTaskDto,
  ProcessRunPlanDto,
  ProcessRunTargetDto,
  ProcessRunDto,
  ProcessRunEventDto,
  ProcessRunListItemDto,
  ProcessSectionRevisionDto,
  ProcessSectionRunDto,
  resumeWorkspaceProcessRun,
  reviseWorkspaceSection,
} from "@/lib/runtime-api";

function titleCaseToken(value?: string | null): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value?: string | null): string {
  const iso = String(value || "").trim();
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
}

function runStatusTone(status?: ProcessRunDto["status"]): string {
  if (status === "READY") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "WAITING_USER" || status === "PAUSED") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "NEEDS_HUMAN_REVIEW" || status === "FAILED") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function questionSeverityTone(severity?: ProcessQuestionTaskDto["severity"]): string {
  if (severity === "BLOCKER") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "IMPORTANT") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function sectionStatusTone(status?: ProcessSectionRunDto["status"]): string {
  if (status === "READY" || status === "VALIDATED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "NEEDS_USER_INPUT") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "NEEDS_REVIEW") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function isPollingStatus(status?: ProcessRunDto["status"]): boolean {
  return status === "RUNNING" || status === "WAITING_USER" || status === "PAUSED";
}

const PHASE2_ARTIFACT_TYPES = [
  "BUSINESS_STRATEGY",
  "COMPETITOR_AUDIT",
  "EXECUTIVE_SUMMARY",
  "CONTENT_CALENDAR",
  "GO_TO_MARKET",
  "PLAYBOOK",
  "SWOT",
] as const;

function isPhase2ArtifactType(value: string): value is ProcessRunTargetDto["artifactType"] {
  return (PHASE2_ARTIFACT_TYPES as readonly string[]).includes(value);
}

function parseTargetsInput(input: string): ProcessRunTargetDto[] {
  const lines = input
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error("At least one artifact target is required.");
  }

  const targets: ProcessRunTargetDto[] = [];
  for (const rawLine of lines) {
    const [left, objectivePart] = rawLine.split("|objective=");
    const [rawArtifact, rawSections] = left.split(":");
    const artifact = String(rawArtifact || "").trim().toUpperCase();
    if (!artifact || !isPhase2ArtifactType(artifact)) {
      throw new Error(`Unsupported artifact type in line: "${rawLine}"`);
    }
    const sections = String(rawSections || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const objective = String(objectivePart || "").trim();
    targets.push({
      artifactType: artifact,
      ...(sections.length ? { sections } : {}),
      ...(objective ? { objective } : {}),
    });
  }
  return targets;
}

export function ProcessControlPanel({ workspaceId }: { workspaceId: string }) {
  const [runs, setRuns] = useState<ProcessRunListItemDto[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [run, setRun] = useState<ProcessRunDto | null>(null);
  const [runPlan, setRunPlan] = useState<ProcessRunPlanDto | null>(null);
  const [events, setEvents] = useState<ProcessRunEventDto[]>([]);
  const [questions, setQuestions] = useState<ProcessQuestionTaskDto[]>([]);
  const [sections, setSections] = useState<ProcessSectionRunDto[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ProcessSectionRevisionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [draftSectionId, setDraftSectionId] = useState<string | null>(null);
  const [revisionDraft, setRevisionDraft] = useState("");
  const [revisionSummary, setRevisionSummary] = useState("");
  const [revisionDirty, setRevisionDirty] = useState(false);
  const [escalationReason, setEscalationReason] = useState("Manual escalation requested from process inspector.");
  const [createObjective, setCreateObjective] = useState(
    "Draft a near-complete business strategy section by section."
  );
  const [createRequestMode, setCreateRequestMode] = useState<ProcessRequestMode>("single_doc");
  const [createTargetsInput, setCreateTargetsInput] = useState("BUSINESS_STRATEGY");
  const [createValidationError, setCreateValidationError] = useState<string | null>(null);

  const activeRunsCount = useMemo(
    () => runs.filter((item) => isPollingStatus(item.status)).length,
    [runs]
  );
  const openQuestionsCount = useMemo(
    () => questions.filter((item) => item.status === "OPEN").length,
    [questions]
  );
  const openImportantOrBlockerCount = useMemo(
    () =>
      questions.filter(
        (item) => item.status === "OPEN" && (item.severity === "BLOCKER" || item.severity === "IMPORTANT")
      ).length,
    [questions]
  );
  const selectedSection = useMemo(
    () => sections.find((item) => item.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  );

  const loadRuns = useCallback(
    async (preferRunId?: string): Promise<string | null> => {
      const payload = await listWorkspaceProcessRuns(workspaceId, { limit: 20 });
      const nextRuns = Array.isArray(payload.runs) ? payload.runs : [];
      setRuns(nextRuns);

      const nextRunId =
        (preferRunId && nextRuns.some((item) => item.id === preferRunId) ? preferRunId : null) ||
        (selectedRunId && nextRuns.some((item) => item.id === selectedRunId) ? selectedRunId : null) ||
        nextRuns[0]?.id ||
        null;
      setSelectedRunId(nextRunId);
      return nextRunId;
    },
    [workspaceId, selectedRunId]
  );

  const loadRunBundle = useCallback(
    async (runId: string): Promise<void> => {
      const [runPayload, planPayload, questionsPayload, sectionsPayload] = await Promise.all([
        fetchWorkspaceProcessRun(workspaceId, runId),
        fetchWorkspaceProcessRunPlan(workspaceId, runId),
        listWorkspaceProcessQuestions(workspaceId, runId),
        listWorkspaceProcessSections(workspaceId, runId),
      ]);
      const nextRun = runPayload.run || null;
      const nextPlan = planPayload.plan || null;
      const nextEvents = Array.isArray(runPayload.events) ? runPayload.events : [];
      const nextQuestions = Array.isArray(questionsPayload.questions) ? questionsPayload.questions : [];
      const nextSections = Array.isArray(sectionsPayload.sections) ? sectionsPayload.sections : [];

      setRun(nextRun);
      setRunPlan(nextPlan);
      setEvents(nextEvents);
      setQuestions(nextQuestions);
      setSections(nextSections);
      setSelectedSectionId((current) => {
        if (current && nextSections.some((section) => section.id === current)) return current;
        return nextSections[0]?.id || null;
      });
    },
    [workspaceId]
  );

  const loadSectionRevisions = useCallback(
    async (sectionId: string, options?: { forceReplaceDraft?: boolean }) => {
      const payload = await listWorkspaceSectionRevisions(workspaceId, sectionId);
      const nextRevisions = Array.isArray(payload.revisions) ? payload.revisions : [];
      setRevisions(nextRevisions);
      const latest = nextRevisions[0] || null;
      const shouldReplace =
        options?.forceReplaceDraft || draftSectionId !== sectionId || !revisionDirty;
      if (shouldReplace) {
        setDraftSectionId(sectionId);
        setRevisionDraft(String(latest?.markdown || ""));
        setRevisionSummary(String(latest?.summary || ""));
        setRevisionDirty(false);
      }
    },
    [workspaceId, draftSectionId, revisionDirty]
  );

  const refreshAll = useCallback(
    async (preferRunId?: string) => {
      setError(null);
      const runId = await loadRuns(preferRunId);
      if (!runId) {
        setRun(null);
        setRunPlan(null);
        setEvents([]);
        setQuestions([]);
        setSections([]);
        setSelectedSectionId(null);
        setRevisions([]);
        return;
      }
      await loadRunBundle(runId);
    },
    [loadRuns, loadRunBundle]
  );

  const runAction = useCallback(async (actionKey: string, work: () => Promise<void>) => {
    setBusyAction(actionKey);
    setError(null);
    try {
      await work();
    } catch (actionError) {
      setError(String((actionError as Error)?.message || "Action failed"));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const applyPreset = (preset: "single" | "bundle" | "multi") => {
    setCreateValidationError(null);
    if (preset === "single") {
      setCreateRequestMode("single_doc");
      setCreateObjective("Draft a near-complete business strategy section by section.");
      setCreateTargetsInput("BUSINESS_STRATEGY");
      return;
    }
    if (preset === "bundle") {
      setCreateRequestMode("section_bundle");
      setCreateObjective("Draft only selected strategic sections and ask targeted questions for missing fields.");
      setCreateTargetsInput(
        [
          "BUSINESS_STRATEGY:executive_summary,competitive_strategy,execution_roadmap",
          "EXECUTIVE_SUMMARY:decision_recommendations,next_90_days",
        ].join("\n")
      );
      return;
    }
    setCreateRequestMode("multi_doc_bundle");
    setCreateObjective("Generate a complete strategic package with business strategy and competitor audit.");
    setCreateTargetsInput(["BUSINESS_STRATEGY", "COMPETITOR_AUDIT", "EXECUTIVE_SUMMARY"].join("\n"));
  };

  const startPhase2Run = () => {
    const objective = createObjective.trim();
    if (!objective) {
      setCreateValidationError("Objective is required.");
      return;
    }

    let targets: ProcessRunTargetDto[];
    try {
      targets = parseTargetsInput(createTargetsInput);
    } catch (validationError) {
      setCreateValidationError(String((validationError as Error)?.message || "Invalid target input."));
      return;
    }

    if (createRequestMode === "section_bundle") {
      const hasAnySectionTarget = targets.some(
        (target) => Array.isArray(target.sections) && target.sections.length > 0
      );
      if (!hasAnySectionTarget) {
        setCreateValidationError("Section bundle mode requires at least one target with explicit sections.");
        return;
      }
    }
    if (createRequestMode === "multi_doc_bundle" && targets.length < 2) {
      setCreateValidationError("Multi-doc bundle mode requires at least two artifacts.");
      return;
    }

    setCreateValidationError(null);
    runAction("start", async () => {
      const idempotencyKey = `ui-${createRequestMode}-${new Date().toISOString().slice(0, 16)}`;
      const payload = await createWorkspaceProcessRun(
        workspaceId,
        {
          documentType: "BUSINESS_STRATEGY",
          objective,
          requestMode: createRequestMode,
          targets,
          idempotencyKey,
        },
        {
          idempotencyKey,
        }
      );
      await refreshAll(payload.run.id);
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refreshAll()
      .catch((loadError) => {
        if (cancelled) return;
        setError(String((loadError as Error)?.message || "Failed to load process runs."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    setLoadingRun(true);
    void loadRunBundle(selectedRunId)
      .catch((loadError) => {
        if (cancelled) return;
        setError(String((loadError as Error)?.message || "Failed to load selected run."));
      })
      .finally(() => {
        if (!cancelled) setLoadingRun(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, loadRunBundle]);

  useEffect(() => {
    if (!selectedSectionId) {
      setRevisions([]);
      return;
    }
    let cancelled = false;
    setLoadingRevisions(true);
    void loadSectionRevisions(selectedSectionId)
      .catch((loadError) => {
        if (cancelled) return;
        setError(String((loadError as Error)?.message || "Failed to load section revisions."));
      })
      .finally(() => {
        if (!cancelled) setLoadingRevisions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSectionId, loadSectionRevisions]);

  useEffect(() => {
    if (!selectedRunId || !isPollingStatus(run?.status)) return;
    const timer = window.setInterval(() => {
      void loadRunBundle(selectedRunId);
      void loadRuns(selectedRunId);
      if (selectedSectionId) {
        void loadSectionRevisions(selectedSectionId);
      }
    }, 8000);
    return () => window.clearInterval(timer);
  }, [selectedRunId, run?.status, selectedSectionId, loadRunBundle, loadRuns, loadSectionRevisions]);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Process Control</h2>
          <p className="text-[11px] text-zinc-500">
            {activeRunsCount > 0 ? `${activeRunsCount} active run(s)` : "No active run"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => runAction("refresh", async () => refreshAll())}
            disabled={busyAction !== null || loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={startPhase2Run}
            disabled={busyAction !== null || loading}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Start run
          </button>
        </div>
      </div>

      <div className="border-b border-zinc-200 px-3 py-2">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-600">New Phase 2 Run</p>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => applyPreset("single")}
                className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-100"
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => applyPreset("bundle")}
                className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-100"
              >
                Section Bundle
              </button>
              <button
                type="button"
                onClick={() => applyPreset("multi")}
                className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-100"
              >
                Multi Doc
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            <select
              value={createRequestMode}
              onChange={(event) => setCreateRequestMode(event.target.value as ProcessRequestMode)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none"
            >
              <option value="single_doc">single_doc</option>
              <option value="section_bundle">section_bundle</option>
              <option value="multi_doc_bundle">multi_doc_bundle</option>
            </select>
            <input
              value={createObjective}
              onChange={(event) => setCreateObjective(event.target.value)}
              placeholder="Objective"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none"
            />
            <textarea
              value={createTargetsInput}
              onChange={(event) => setCreateTargetsInput(event.target.value)}
              rows={3}
              placeholder="Targets, one per line. Example: BUSINESS_STRATEGY:executive_summary,execution_roadmap"
              className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-[11px] outline-none"
            />
          </div>
          {createValidationError ? (
            <p className="mt-1 text-[11px] text-rose-700">{createValidationError}</p>
          ) : null}
          <p className="mt-1 text-[10px] text-zinc-500">
            Target format: <code>ARTIFACT</code> or <code>ARTIFACT:section_a,section_b</code>. Optional:
            <code> |objective=...</code>
          </p>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="border-b border-zinc-200 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Runs</p>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {runs.length ? (
            runs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedRunId(item.id)}
                className={`rounded-md border px-2 py-1 text-left text-[11px] ${
                  selectedRunId === item.id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                <p className="font-medium">{titleCaseToken(item.stage)}</p>
                <p className="opacity-80">{formatTime(item.updatedAt) || "No timestamp"}</p>
              </button>
            ))
          ) : (
            <p className="text-xs text-zinc-500">No V2 process runs yet.</p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-4 text-sm text-zinc-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading process control...
        </div>
      ) : !run ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-4 text-center text-sm text-zinc-600">
          Start a BUSINESS_STRATEGY run to enable questions, section revisions, and final policy gates.
        </div>
      ) : (
        <div className="bat-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${runStatusTone(run.status)}`}>
                {titleCaseToken(run.status)}
              </span>
              <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700">
                {titleCaseToken(run.stage)}
              </span>
              {run.method ? (
                <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700">
                  {titleCaseToken(run.method)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-900">{run.objective || "No objective set."}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Created: {formatTime(run.createdAt) || "-"} | Updated: {formatTime(run.updatedAt) || "-"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  runAction("resume", async () => {
                    await resumeWorkspaceProcessRun(workspaceId, run.id, "retry");
                    await refreshAll(run.id);
                  })
                }
                disabled={busyAction !== null}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Resume / Retry
              </button>
              <button
                type="button"
                onClick={() =>
                  runAction("retry-with-evidence", async () => {
                    await resumeWorkspaceProcessRun(workspaceId, run.id, "retry_with_new_evidence");
                    await refreshAll(run.id);
                  })
                }
                disabled={busyAction !== null}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Retry with new evidence
              </button>
            </div>
            <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-2">
              <p className="text-[11px] text-zinc-600">Escalation reason</p>
              <input
                value={escalationReason}
                onChange={(event) => setEscalationReason(event.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs outline-none"
                placeholder="Reason to escalate"
              />
              <button
                type="button"
                onClick={() =>
                  runAction("escalate", async () => {
                    const reason = escalationReason.trim();
                    if (!reason) {
                      throw new Error("Escalation reason is required.");
                    }
                    await escalateWorkspaceProcessRun(workspaceId, run.id, { reason });
                    await refreshAll(run.id);
                  })
                }
                disabled={busyAction !== null}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Escalate
              </button>
            </div>

            {runPlan ? (
              <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-2">
                <p className="text-[11px] font-medium text-zinc-700">
                  Plan Mode: {titleCaseToken(runPlan.mode as ProcessRequestMode)}
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">Artifacts: {runPlan.artifacts.length}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {runPlan.artifacts.map((artifact) => (
                    <span
                      key={`${artifact.artifactKey}-${artifact.artifactType}`}
                      className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-700"
                    >
                      {titleCaseToken(artifact.artifactType)} ({artifact.selectedSections.length})
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900">Question Tasks</h3>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                Open {openQuestionsCount}
              </span>
            </div>
            {openImportantOrBlockerCount > 0 ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                {openImportantOrBlockerCount} important/blocker question(s) can block publish.
              </div>
            ) : null}
            <div className="mt-2 space-y-2">
              {questions.length ? (
                questions.map((task) => {
                  const currentDraft = questionDrafts[task.id] || "";
                  return (
                    <article key={task.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${questionSeverityTone(task.severity)}`}>
                          {titleCaseToken(task.severity)}
                        </span>
                        <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                          {titleCaseToken(task.status)}
                        </span>
                        <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                          {task.fieldKey}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-900">{task.question}</p>
                      {task.status === "OPEN" ? (
                        <div className="mt-2 space-y-1.5">
                          <textarea
                            value={currentDraft}
                            onChange={(event) =>
                              setQuestionDrafts((previous) => ({
                                ...previous,
                                [task.id]: event.target.value,
                              }))
                            }
                            rows={2}
                            placeholder="Answer to unlock the next step..."
                            className="w-full resize-y rounded-md border border-zinc-200 px-2 py-1.5 text-xs outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              runAction(`answer-${task.id}`, async () => {
                                const answer = currentDraft.trim();
                                if (!answer) {
                                  throw new Error("Answer cannot be empty.");
                                }
                                await answerWorkspaceProcessQuestion(workspaceId, task.id, answer);
                                setQuestionDrafts((previous) => ({ ...previous, [task.id]: "" }));
                                await refreshAll(task.processRunId);
                              })
                            }
                            disabled={busyAction !== null}
                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Submit answer
                          </button>
                        </div>
                      ) : task.answeredAt ? (
                        <p className="mt-1 text-[11px] text-zinc-500">Answered at {formatTime(task.answeredAt)}</p>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <p className="text-xs text-zinc-500">No question tasks yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900">Sections</h3>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                {sections.length}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sections.length ? (
                sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setSelectedSectionId(section.id)}
                    className={`rounded-md border px-2 py-1 text-left text-[11px] ${
                      selectedSectionId === section.id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <p className="font-medium">{section.title}</p>
                    <p className="opacity-80">{titleCaseToken(section.status)}</p>
                  </button>
                ))
              ) : (
                <p className="text-xs text-zinc-500">Sections will appear after planning.</p>
              )}
            </div>

            {selectedSection ? (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sectionStatusTone(selectedSection.status)}`}>
                    {titleCaseToken(selectedSection.status)}
                  </span>
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                    {selectedSection.framework}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-zinc-900">{selectedSection.title}</p>

                <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-zinc-700">Revisions</p>
                    {loadingRevisions ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading
                      </span>
                    ) : null}
                  </div>
                  {revisions.length ? (
                    <div className="mt-1 max-h-28 space-y-1 overflow-y-auto pr-1">
                      {revisions.slice(0, 8).map((revision) => (
                        <button
                          key={revision.id}
                          type="button"
                          onClick={() => {
                            setDraftSectionId(selectedSection.id);
                            setRevisionDraft(revision.markdown || "");
                            setRevisionSummary(revision.summary || "");
                            setRevisionDirty(false);
                          }}
                          className="flex w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
                        >
                          <span>v{revision.revisionNumber}</span>
                          <span>{titleCaseToken(revision.createdByRole)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-zinc-500">No revision history yet.</p>
                  )}
                </div>

                <div className="mt-2 space-y-1.5">
                  <input
                    value={revisionSummary}
                    onChange={(event) => {
                      setRevisionSummary(event.target.value);
                      setRevisionDirty(true);
                    }}
                    placeholder="Revision summary (optional)"
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none"
                  />
                  <textarea
                    value={revisionDraft}
                    onChange={(event) => {
                      setRevisionDraft(event.target.value);
                      setRevisionDirty(true);
                    }}
                    rows={12}
                    placeholder="Edit section markdown here..."
                    className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      runAction(`revise-${selectedSection.id}`, async () => {
                        const markdown = revisionDraft.trim();
                        if (!markdown) {
                          throw new Error("Section markdown cannot be empty.");
                        }
                        await reviseWorkspaceSection(workspaceId, selectedSection.id, {
                          markdown,
                          summary: revisionSummary.trim() || undefined,
                          createdByRole: "Editor",
                        });
                        await refreshAll(selectedRunId || undefined);
                        await loadSectionRevisions(selectedSection.id, { forceReplaceDraft: true });
                      })
                    }
                    disabled={busyAction !== null}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save revision
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900">Decision Timeline</h3>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                {events.length}
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {events.length ? (
                events
                  .slice()
                  .reverse()
                  .slice(0, 32)
                  .map((event) => (
                    <article key={event.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-zinc-700">{titleCaseToken(event.type)}</span>
                        <span className="text-[10px] text-zinc-500">{formatTime(event.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-800">{event.message}</p>
                    </article>
                  ))
              ) : (
                <p className="text-xs text-zinc-500">No process events recorded yet.</p>
              )}
            </div>
          </section>

          {loadingRun ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Updating run state...
            </div>
          ) : run.status === "READY" ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Final policy gate passed. Run is ready.
            </div>
          ) : run.status === "NEEDS_HUMAN_REVIEW" ? (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-2 py-2 text-xs text-rose-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              Run is escalated and requires human review.
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
