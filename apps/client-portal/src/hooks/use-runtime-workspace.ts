"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapRuntimeBranch,
  cancelRuntimeQueueItem,
  createRuntimeBranch,
  createRuntimeThread,
  fetchRuntimeBranchState,
  fetchWorkspaceLibrary,
  listRuntimeEvents,
  listRuntimeMessages,
  listRuntimeQueue,
  listRuntimeThreads,
  pinRuntimeBranch,
  resolveRuntimeDecision,
  reorderRuntimeQueue,
  sendRuntimeMessage,
  steerRuntimeBranch,
  interruptRuntimeBranch,
} from "@/lib/runtime-api";
import {
  ChatMessageBlock,
  ChatMessage,
  DecisionItem,
  LibraryItem,
  ProcessFeedItem,
  ProcessRun,
  QueuedMessage,
  RuntimeBranch,
  RuntimeThread,
  SessionPreferences,
} from "@/types/chat";

type ThreadWithBranches = RuntimeThread & { branches?: RuntimeBranch[] };

type UseRuntimeWorkspaceResult = {
  loading: boolean;
  syncing: boolean;
  error: string | null;
  threads: ThreadWithBranches[];
  activeThreadId: string | null;
  activeBranchId: string | null;
  branches: RuntimeBranch[];
  messages: ChatMessage[];
  processRuns: ProcessRun[];
  feedItems: ProcessFeedItem[];
  decisions: DecisionItem[];
  queuedMessages: QueuedMessage[];
  isStreaming: boolean;
  libraryItems: LibraryItem[];
  preferences: SessionPreferences;
  setActiveThreadId: (threadId: string) => void;
  setActiveBranchId: (branchId: string) => void;
  createThread: (title: string) => Promise<void>;
  createBranch: (name: string, forkedFromMessageId?: string) => Promise<void>;
  pinBranch: (branchId: string) => Promise<void>;
  sendMessage: (content: string, mode: "send" | "queue") => Promise<void>;
  interruptRun: () => Promise<void>;
  reorderQueue: (from: number, to: number) => Promise<void>;
  removeQueued: (id: string) => Promise<void>;
  resolveDecision: (decisionId: string, option: string) => Promise<void>;
  steerRun: (note: string) => Promise<void>;
  setPreference: <K extends keyof SessionPreferences>(key: K, value: SessionPreferences[K]) => void;
  refreshNow: () => Promise<void>;
};

const DEFAULT_PREFERENCES: SessionPreferences = {
  tone: "balanced",
  sourceFocus: "mixed",
  transparency: true,
  askQuestionsFirst: false,
};

const ACTIVE_POLL_INTERVAL_MS = 1200;
const IDLE_POLL_INTERVAL_MS = 3200;
const LIBRARY_POLL_INTERVAL_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIso(input: unknown): string {
  const value = String(input || "").trim();
  return value || new Date().toISOString();
}

function toChatRole(role: string): "user" | "assistant" | "system" {
  const normalized = role.trim().toUpperCase();
  if (normalized === "USER") return "user";
  if (normalized === "ASSISTANT") return "assistant";
  return "system";
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeTriggerType(value: unknown): string {
  const normalized = String(value || "workflow").trim().toUpperCase();
  if (normalized === "USER_MESSAGE") return "User message run";
  if (normalized === "TOOL_RESULT") return "Tool continuation run";
  if (normalized === "SCHEDULED_LOOP") return "Scheduled run";
  if (normalized === "MUTATION_APPLIED") return "Mutation run";
  if (normalized === "MANUAL_RETRY") return "Retry run";
  return `${humanizeToken(normalized.toLowerCase()) || "Workflow"} run`;
}

function shortId(value: unknown): string {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 8) : "unknown";
}

type RuntimeEventPhase = ProcessRun["phase"];
type RuntimeEventStatus = "info" | "warn" | "error";

type NormalizedRuntimeEvent = {
  id: string;
  type: string;
  level: RuntimeEventStatus;
  message: string;
  createdAt: string;
  runId?: string;
  toolRunId?: string;
  toolName?: string;
  triggerType?: string;
  phase: RuntimeEventPhase;
  event: string;
  payload: Record<string, unknown> | null;
};

const RUNTIME_PHASES: RuntimeEventPhase[] = [
  "queued",
  "planning",
  "tools",
  "writing",
  "waiting_input",
  "completed",
  "failed",
  "cancelled",
];

function normalizeEventLevel(value: unknown): RuntimeEventStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "error") return "error";
  if (normalized === "warn" || normalized === "warning") return "warn";
  return "info";
}

function normalizeEventPhase(value: unknown): RuntimeEventPhase | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return RUNTIME_PHASES.includes(normalized as RuntimeEventPhase)
    ? (normalized as RuntimeEventPhase)
    : null;
}

function inferLegacyRuntimeEvent(
  type: string,
  message: string,
  hasToolContext: boolean
): { event: string; phase: RuntimeEventPhase } {
  const normalizedType = type.toUpperCase();
  const normalizedMessage = message.toLowerCase();

  if (normalizedType === "PROCESS_STARTED") {
    return { event: "run.started", phase: "planning" };
  }
  if (normalizedType === "PROCESS_PROGRESS") {
    if (hasToolContext) return { event: "tool.started", phase: "tools" };
    if (/\bwriting|drafting|final response|final answer\b/.test(normalizedMessage)) {
      return { event: "run.writing", phase: "writing" };
    }
    if (/\bplanning?\b/.test(normalizedMessage)) {
      return { event: "run.planning", phase: "planning" };
    }
    return { event: "run.progress", phase: "tools" };
  }
  if (normalizedType === "PROCESS_RESULT") {
    return { event: "tool.output", phase: "tools" };
  }
  if (normalizedType === "DECISION_REQUIRED") {
    return { event: "decision.required", phase: "waiting_input" };
  }
  if (normalizedType === "WAITING_FOR_INPUT") {
    return { event: "run.waiting_input", phase: "waiting_input" };
  }
  if (normalizedType === "DONE") {
    return { event: "run.completed", phase: "completed" };
  }
  if (normalizedType === "FAILED") {
    return hasToolContext
      ? { event: "tool.failed", phase: "tools" }
      : { event: "run.failed", phase: "failed" };
  }
  if (normalizedType === "PROCESS_CANCELLED") {
    return { event: "run.cancelled", phase: "cancelled" };
  }
  if (normalizedType === "PROCESS_LOG") {
    if (/\bqueue|queued\b/.test(normalizedMessage)) return { event: "run.queued", phase: "queued" };
    if (/\bplanning?\b/.test(normalizedMessage)) return { event: "run.planning", phase: "planning" };
    if (/\bwriting|drafting|final response|final answer\b/.test(normalizedMessage)) {
      return { event: "run.writing", phase: "writing" };
    }
    return { event: "run.log", phase: "tools" };
  }
  return { event: "run.log", phase: "tools" };
}

function normalizeRuntimeEvent(event: Record<string, unknown>): NormalizedRuntimeEvent {
  const type = String(event.type || "").trim().toUpperCase();
  const message = String(event.message || "Runtime event").trim() || "Runtime event";
  const createdAt = toIso(event.createdAt);
  const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
  const payloadEventV2 = payload && isRecord(payload.eventV2) ? payload.eventV2 : null;
  const topEventV2 = isRecord(event.eventV2) ? event.eventV2 : null;
  const eventV2 = topEventV2 || payloadEventV2;

  const toolNameFromPayload = String(payload?.toolName || "").trim();
  const hasToolContext = Boolean(event.toolRunId || toolNameFromPayload);
  const fallback = inferLegacyRuntimeEvent(type, message, hasToolContext);

  const runId =
    String(eventV2?.runId || event.agentRunId || "").trim() || undefined;
  const toolRunId =
    String(eventV2?.toolRunId || event.toolRunId || "").trim() || undefined;
  const toolName =
    String(eventV2?.toolName || toolNameFromPayload || "").trim() || undefined;
  const triggerType = String(payload?.triggerType || "").trim() || undefined;
  const phase = normalizeEventPhase(eventV2?.phase) || fallback.phase;
  const normalizedEvent = String(eventV2?.event || "").trim().toLowerCase() || fallback.event;
  const level = normalizeEventLevel(eventV2?.status || event.level);
  const timestamp = toIso(eventV2?.createdAt || createdAt);

  return {
    id: String(event.id || `${timestamp}-${Math.random()}`),
    type,
    level,
    message,
    createdAt: timestamp,
    ...(runId ? { runId } : {}),
    ...(toolRunId ? { toolRunId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(triggerType ? { triggerType } : {}),
    phase,
    event: normalizedEvent,
    payload,
  };
}

function normalizeRuntimeEvents(events: Array<Record<string, unknown>>): NormalizedRuntimeEvent[] {
  return events.map((event) => normalizeRuntimeEvent(event));
}

function phaseToStatus(phase: RuntimeEventPhase): ProcessRun["status"] {
  if (phase === "waiting_input") return "waiting_input";
  if (phase === "completed") return "done";
  if (phase === "failed") return "failed";
  if (phase === "cancelled") return "cancelled";
  return "running";
}

function phaseToProgress(phase: RuntimeEventPhase, done = 0, total = 1): number {
  if (phase === "completed" || phase === "failed" || phase === "cancelled") return 100;
  if (phase === "queued") return 8;
  if (phase === "planning") return 20;
  if (phase === "writing") return 92;
  if (phase === "waiting_input") return 96;
  if (phase === "tools") {
    const boundedTotal = Math.max(1, total);
    const ratio = Math.max(0, Math.min(1, done / boundedTotal));
    return Math.max(32, Math.min(88, Math.round(32 + ratio * 54)));
  }
  return 60;
}

function buildRunStage(input: {
  phase: RuntimeEventPhase;
  latestMessage?: string;
  inFlightToolNames: string[];
  totalTools: number;
}): string {
  if (input.phase === "queued") return "Queued";
  if (input.phase === "planning") return "Planning next actions";
  if (input.phase === "writing") return "Writing final response";
  if (input.phase === "waiting_input") return "Waiting for approval";
  if (input.phase === "completed") return "Completed";
  if (input.phase === "failed") return "Failed";
  if (input.phase === "cancelled") return "Cancelled";
  if (input.inFlightToolNames.length) {
    return `Running ${input.inFlightToolNames.join(", ")}`;
  }
  if (input.latestMessage) return input.latestMessage;
  return `Running ${input.totalTools || 1} task(s)`;
}

function asArrayOfStrings(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeDecisionBlockItems(value: unknown): Array<{
  id: string;
  title: string;
  options: Array<{ value: string; label?: string }>;
  default?: string;
  blocking?: boolean;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = String(item.id || "").trim();
      const title = String(item.title || "").trim();
      if (!id || !title) return null;
      const options = Array.isArray(item.options)
        ? item.options
            .map((option) => {
              if (typeof option === "string") {
                const raw = option.trim();
                return raw ? { value: raw } : null;
              }
              if (!isRecord(option)) return null;
              const valueRaw = String(option.value || option.label || "").trim();
              if (!valueRaw) return null;
              const labelRaw = String(option.label || "").trim();
              return {
                value: valueRaw,
                ...(labelRaw ? { label: labelRaw } : {}),
              };
            })
            .filter((entry): entry is { value: string; label?: string } => Boolean(entry))
        : [];
      if (!options.length) return null;
      const defaultOption = String(item.default || "").trim();
      return {
        id,
        title,
        options,
        ...(defaultOption ? { default: defaultOption } : {}),
        ...(typeof item.blocking === "boolean" ? { blocking: item.blocking } : {}),
      };
    })
    .filter(
      (
        entry
      ): entry is {
        id: string;
        title: string;
        options: Array<{ value: string; label?: string }>;
        default?: string;
        blocking?: boolean;
      } => Boolean(entry)
    )
    .slice(0, 12);
}

function normalizeMessageBlocks(value: unknown): ChatMessageBlock[] {
  const block = isRecord(value) ? value : null;
  if (!block) return [];
  const type = String(block.type || "").trim().toLowerCase();
  if (!type) return [];

  if (type === "decision_requests") {
    const items = normalizeDecisionBlockItems(block.items);
    if (!items.length) return [];
    return [
      {
        type: "decision_requests",
        items,
      },
    ];
  }

  if (type === "action_buttons") {
    const actions = Array.isArray(block.actions)
      ? block.actions
          .map((action) => {
            if (!isRecord(action)) return null;
            const label = String(action.label || "").trim();
            const actionKey = String(action.action || "").trim();
            if (!label || !actionKey) return null;
            return {
              label,
              action: actionKey,
              ...(isRecord(action.payload) ? { payload: action.payload } : {}),
            };
          })
          .filter((item): item is { label: string; action: string; payload?: Record<string, unknown> } => Boolean(item))
      : [];
    const decisions = normalizeDecisionBlockItems(block.decisions);
    if (!actions.length && !decisions.length) return [];
    return [
      {
        type: "action_buttons",
        actions,
        decisions,
      },
    ];
  }

  return [
    {
      type,
      ...block,
    },
  ];
}

function mapMessages(messages: Array<Record<string, unknown>>): ChatMessage[] {
  return messages
    .filter(
      (message) =>
        String(message.role || "").toUpperCase() !== "TOOL" &&
        message.clientVisible !== false
    )
    .map((message) => {
      const reasoningRaw = isRecord(message.reasoningJson) ? message.reasoningJson : null;
      const blocks = normalizeMessageBlocks(message.blocksJson);
      const evidenceRaw = reasoningRaw && Array.isArray(reasoningRaw.evidence) ? reasoningRaw.evidence : [];
      const evidence = evidenceRaw
        .map((item) => {
          if (!isRecord(item)) return null;
          const id = String(item.id || "").trim();
          const label = String(item.label || "").trim();
          if (!id || !label) return null;
          return {
            id,
            label,
            ...(typeof item.url === "string" ? { href: item.url } : {}),
          };
        })
        .filter((item): item is { id: string; label: string; href?: string } => Boolean(item));

      return {
        id: String(message.id || ""),
        role: toChatRole(String(message.role || "SYSTEM")),
        content: String(message.content || ""),
        createdAt: toIso(message.createdAt),
        ...(blocks.length
          ? {
              blocks,
            }
          : {}),
        ...(reasoningRaw
          ? {
              reasoning: {
                plan: asArrayOfStrings(reasoningRaw.plan),
                tools: asArrayOfStrings(reasoningRaw.tools),
                assumptions: asArrayOfStrings(reasoningRaw.assumptions),
                nextSteps: asArrayOfStrings(reasoningRaw.nextSteps),
                evidence,
              },
            }
          : {}),
      } as ChatMessage;
    });
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function readableToolName(toolName?: string): string {
  const normalized = String(toolName || "").trim().toLowerCase();
  if (!normalized) return "Tool";
  if (normalized === "intel.list") return "Workspace records";
  if (normalized === "intel.get") return "Workspace record";
  if (normalized === "web.fetch") return "Page fetch";
  if (normalized === "web.crawl") return "Website crawl";
  if (normalized === "web.crawl.list_snapshots") return "Crawl snapshots";
  if (normalized === "evidence.posts") return "Social evidence";
  if (normalized === "evidence.news") return "News evidence";
  if (normalized === "evidence.videos") return "Video evidence";
  if (normalized === "document.plan") return "Document planner";
  if (normalized === "document.generate") return "Document generator";
  if (normalized === "research.gather") return "Deep research";
  return humanizeToken(normalized.replace(/\./g, " "));
}

function pluralize(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function parseNumericResult(raw: string): { count: number; unit: string } | null {
  const match = raw.match(
    /\b(\d+)\s+(item\(s\)|items?|row\(s\)|rows?|record\(s\)|records?|post\(s\)|posts?|video\(s\)|videos?|tool\(s\)|tools?|page snapshot\(s\)|page snapshots?)\b/i
  );
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count)) return null;
  const unitRaw = String(match[2] || "").toLowerCase();
  const normalizedUnit = unitRaw.replace(/\(s\)/g, "s");
  return { count, unit: normalizedUnit };
}

function toValueFirstToolMessage(toolName: string | undefined, inputMessage: string): string {
  const raw = String(inputMessage || "").trim();
  if (!raw) return `${readableToolName(toolName)} updated.`;

  const numberResult = parseNumericResult(raw);
  if (toolName === "intel.list" && numberResult) {
    const sectionMatch = raw.match(/\bfrom\s+([a-z_]+)\b/i);
    const section = sectionMatch?.[1] ? humanizeToken(sectionMatch[1]) : "workspace section";
    return `Loaded ${pluralize(numberResult.count, "record", "records")} from ${section}.`;
  }

  if (toolName === "evidence.posts" && numberResult) {
    return `Found ${pluralize(numberResult.count, "social post", "social posts")} for review.`;
  }

  if (toolName === "evidence.news" && numberResult) {
    return `Found ${pluralize(numberResult.count, "news source", "news sources")} to cite.`;
  }

  if (toolName === "web.crawl" && numberResult) {
    return `Captured ${pluralize(numberResult.count, "page snapshot", "page snapshots")} from the crawl.`;
  }

  if (toolName === "web.fetch") {
    const statusMatch = raw.match(/\bstatus\s+(\d{3})\b/i);
    if (statusMatch?.[1]) {
      return `Saved a page snapshot (HTTP ${statusMatch[1]}).`;
    }
    return "Saved a page snapshot for workspace evidence.";
  }

  if (/\bcompleted successfully\b/i.test(raw)) {
    return `${readableToolName(toolName)} completed.`;
  }

  return raw;
}

function mapFeedItems(events: Array<Record<string, unknown>>): ProcessFeedItem[] {
  const latest = normalizeRuntimeEvents(events).slice(-120).reverse();
  return latest.map((event) => {
    let message = event.message || "Runtime event";

    if (event.event === "run.started") {
      message = `${humanizeTriggerType(event.triggerType || "workflow")} started.`;
    } else if (event.event === "run.planning") {
      message = "Planning execution steps.";
    } else if (event.event === "tool.started" && event.toolName) {
      message = `Running ${event.toolName}...`;
    } else if (event.event === "tool.output" && event.toolName) {
      message = toValueFirstToolMessage(event.toolName, event.message);
    } else if (event.event === "tool.failed" && event.toolName) {
      const raw = String(event.message || "Failed").trim();
      message = `${readableToolName(event.toolName)} failed: ${raw}`;
    } else if (event.event === "run.completed") {
      const toolRuns = Array.isArray(event.payload?.toolRuns) ? event.payload.toolRuns : [];
      const tools = toolRuns
        .map((row) => (isRecord(row) ? String(row.toolName || "").trim() : ""))
        .filter(Boolean);
      if (tools.length) {
        const preview = tools.slice(0, 3).map((tool) => readableToolName(tool)).join(", ");
        message = `Run completed with ${pluralize(tools.length, "tool", "tools")}: ${preview}${tools.length > 3 ? "..." : ""}`;
      } else {
        message = event.runId ? `Run ${event.runId.slice(0, 8)} completed.` : "Run completed.";
      }
    } else if (event.event === "decision.required" || event.phase === "waiting_input") {
      message = "Approval needed before BAT can continue.";
    } else if (event.event === "run.writing") {
      message = "Writing final response.";
    }

    const actionLabel =
      event.event === "tool.output"
        ? "View result"
        : event.event === "decision.required" || event.phase === "waiting_input"
          ? "Review approval"
          : event.event === "tool.failed" || event.phase === "failed"
            ? "Inspect issue"
            : undefined;

    return {
      id: event.id,
      timestamp: formatTime(event.createdAt),
      message,
      ...(actionLabel ? { actionLabel } : {}),
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.toolName ? { toolName: event.toolName } : {}),
      phase: event.phase,
      level: event.level,
    };
  });
}

function mapDecisionsFromEvents(
  events: Array<Record<string, unknown>>,
  activeRuns: Array<Record<string, unknown>>
): DecisionItem[] {
  const items: DecisionItem[] = [];
  const waitingRunIds = new Set(
    activeRuns
      .filter((run) => String(run.status || "").toUpperCase() === "WAITING_USER")
      .map((run) => String(run.id || "").trim())
      .filter(Boolean)
  );

  if (waitingRunIds.size === 0) {
    return [];
  }

  const latest = normalizeRuntimeEvents(events).slice(-160);

  for (const event of latest) {
    const runId = String(event.runId || "").trim();
    if (!runId || !waitingRunIds.has(runId)) continue;

    const payload = event.payload;
    if (!payload || !Array.isArray(payload.decisions)) continue;
    for (const decision of payload.decisions) {
      if (!isRecord(decision)) continue;
      const id = String(decision.id || "").trim();
      const prompt = String(decision.title || "").trim();
      if (!id || !prompt) continue;
      const options = Array.isArray(decision.options)
        ? decision.options
            .map((option) => {
              if (typeof option === "string") return option.trim();
              if (!isRecord(option)) return "";
              return String(option.label || option.value || "").trim();
            })
            .filter(Boolean)
        : [];
      if (!options.length) continue;
      if (!items.some((item) => item.id === id)) {
        items.push({ id, prompt, options });
      }
    }
  }

  return items;
}

function mapRecentRunsFromEvents(events: Array<Record<string, unknown>>): ProcessRun[] {
  type RecentRunAggregate = {
    id: string;
    triggerType: string;
    latestMessage: string;
    latestAt: string;
    phase: RuntimeEventPhase;
    tools: Set<string>;
  };

  const normalizedEvents = normalizeRuntimeEvents(events);
  const aggregates = new Map<string, RecentRunAggregate>();
  const now = Date.now();

  for (const event of normalizedEvents) {
    const runId = String(event.runId || "").trim();
    if (!runId) continue;
    const createdAt = event.createdAt;
    const createdAtMs = Date.parse(createdAt);
    if (Number.isFinite(createdAtMs) && now - createdAtMs > 1000 * 60 * 45) continue;

    const aggregate = aggregates.get(runId) || {
      id: runId,
      triggerType: String(event.triggerType || "workflow"),
      latestMessage: String(event.message || "Recent runtime activity"),
      latestAt: createdAt,
      phase: "tools" as RuntimeEventPhase,
      tools: new Set<string>(),
    };

    if (event.toolName) {
      aggregate.tools.add(event.toolName);
    }
    if (event.event === "run.completed" && Array.isArray(event.payload?.toolRuns)) {
      for (const row of event.payload.toolRuns) {
        if (!isRecord(row)) continue;
        const completedTool = String(row.toolName || "").trim();
        if (completedTool) {
          aggregate.tools.add(completedTool);
        }
      }
    }
    if (event.triggerType) {
      aggregate.triggerType = event.triggerType;
    }
    aggregate.latestMessage = String(event.message || aggregate.latestMessage || "Recent runtime activity");
    aggregate.latestAt = createdAt;
    aggregate.phase = event.phase;

    aggregates.set(runId, aggregate);
  }

  return Array.from(aggregates.values())
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))
    .slice(0, 8)
    .map((run) => {
      const tools = Array.from(run.tools);
      const details = tools.length
        ? [
            `Used ${pluralize(tools.length, "tool", "tools")}: ${tools
              .slice(0, 4)
              .map((tool) => readableToolName(tool))
              .join(", ")}${tools.length > 4 ? "..." : ""}`,
          ]
        : [];
      return {
        id: run.id,
        label: `${humanizeTriggerType(run.triggerType)} • ${shortId(run.id)}`,
        stage: buildRunStage({
          phase: run.phase,
          latestMessage: run.latestMessage,
          inFlightToolNames: [],
          totalTools: tools.length,
        }),
        phase: run.phase,
        progress: phaseToProgress(run.phase, tools.length, tools.length || 1),
        status: phaseToStatus(run.phase),
        ...(details.length ? { details } : {}),
      };
    });
}

function mapRuns(activeRuns: Array<Record<string, unknown>>, events: Array<Record<string, unknown>>): ProcessRun[] {
  const normalizedEvents = normalizeRuntimeEvents(events);
  const latestByRun = new Map<string, NormalizedRuntimeEvent>();
  for (const event of normalizedEvents) {
    if (!event.runId) continue;
    const current = latestByRun.get(event.runId);
    if (!current || Date.parse(current.createdAt) <= Date.parse(event.createdAt)) {
      latestByRun.set(event.runId, event);
    }
  }

  const mappedActive = activeRuns.map((run) => {
    const runId = String(run.id || "");
    const statusRaw = String(run.status || "RUNNING").toUpperCase();
    const toolRuns = Array.isArray(run.toolRuns) ? run.toolRuns : [];
    const total = toolRuns.length || 1;
    const done = toolRuns.filter((tool) => isRecord(tool) && String(tool.status || "").toUpperCase() === "DONE").length;
    const inFlightToolNames = toolRuns
      .filter((tool) => {
        if (!isRecord(tool)) return false;
        const status = String(tool.status || "").toUpperCase();
        return status === "RUNNING" || status === "QUEUED";
      })
      .map((tool) => (isRecord(tool) ? String(tool.toolName || "").trim() : ""))
      .filter(Boolean);
    const latestEvent = latestByRun.get(runId);
    const phase: RuntimeEventPhase =
      statusRaw === "WAITING_USER"
        ? "waiting_input"
        : statusRaw === "DONE"
          ? "completed"
          : statusRaw === "FAILED"
            ? "failed"
            : statusRaw === "CANCELLED"
              ? "cancelled"
              : statusRaw === "QUEUED"
                ? "queued"
                : latestEvent?.phase || (statusRaw === "WAITING_TOOLS" ? "tools" : "planning");

    const latestToolSummary =
      latestEvent?.toolName ? toValueFirstToolMessage(latestEvent.toolName, latestEvent.message) : latestEvent?.message;

    const stage = buildRunStage({
      phase,
      latestMessage: latestToolSummary,
      inFlightToolNames,
      totalTools: toolRuns.length,
    });

    const details = [
      `${pluralize(done, "tool run", "tool runs")} finished out of ${total}`,
      ...(inFlightToolNames.length
        ? [
            `Running now: ${inFlightToolNames
              .slice(0, 3)
              .map((tool) => readableToolName(tool))
              .join(", ")}${inFlightToolNames.length > 3 ? "..." : ""}`,
          ]
        : []),
      ...(latestEvent?.toolName ? [`Latest update: ${toValueFirstToolMessage(latestEvent.toolName, latestEvent.message)}`] : []),
    ];

    if (phase === "waiting_input") {
      details.unshift("Waiting for your approval to continue.");
    }

    return {
      id: runId,
      label: `${humanizeTriggerType(run.triggerType)} • ${shortId(run.id)}`,
      stage,
      phase,
      progress: phaseToProgress(phase, done, total),
      status: phaseToStatus(phase),
      details,
    };
  });

  if (mappedActive.length > 0) return mappedActive;
  return mapRecentRunsFromEvents(events);
}

function buildPolicyFromPreferences(preferences: SessionPreferences): Record<string, unknown> {
  const normalizedTone = preferences.tone === "concise" ? "balanced" : preferences.tone;
  return {
    autoContinue: !preferences.askQuestionsFirst,
    maxAutoContinuations: 1,
    maxToolRuns: normalizedTone === "detailed" ? 5 : 4,
    toolConcurrency: preferences.sourceFocus === "mixed" ? 3 : 2,
    allowMutationTools: false,
    maxToolMs: 30000,
    sourceFocus: preferences.sourceFocus,
    transparency: preferences.transparency,
  };
}

export function useRuntimeWorkspace(workspaceId: string): UseRuntimeWorkspaceResult {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [threads, setThreads] = useState<ThreadWithBranches[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null);
  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [processRuns, setProcessRuns] = useState<ProcessRun[]>([]);
  const [feedItems, setFeedItems] = useState<ProcessFeedItem[]>([]);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [libraryItemsRemote, setLibraryItemsRemote] = useState<LibraryItem[]>([]);
  const [activeRunIdsByBranch, setActiveRunIdsByBranch] = useState<Record<string, string[]>>({});

  const [preferences, setPreferences] = useState<SessionPreferences>(DEFAULT_PREFERENCES);

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const libraryPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncInFlightRef = useRef(false);
  const bootstrapAttemptedRef = useRef<Set<string>>(new Set());

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads]
  );

  const branches = useMemo(() => activeThread?.branches || [], [activeThread]);
  const activeRunIds = useMemo(() => {
    if (!activeBranchId) return [];
    return activeRunIdsByBranch[activeBranchId] || [];
  }, [activeBranchId, activeRunIdsByBranch]);

  const setActiveThreadId = useCallback(
    (threadId: string) => {
      setActiveThreadIdState(threadId);
      const nextThread = threads.find((thread) => thread.id === threadId);
      if (!nextThread) return;
      const nextBranchId = nextThread.pinnedBranchId || nextThread.branches?.[0]?.id || null;
      setActiveBranchIdState(nextBranchId);
    },
    [threads]
  );

  const setActiveBranchId = useCallback((branchId: string) => {
    setActiveBranchIdState(branchId);
  }, []);

  const syncBranch = useCallback(
    async (branchId: string) => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      setSyncing(true);
      try {
        const [threadPayload, messagePayload, eventPayload, queuePayload, statePayload] = await Promise.all([
          listRuntimeThreads(workspaceId),
          listRuntimeMessages(workspaceId, branchId),
          listRuntimeEvents(workspaceId, branchId),
          listRuntimeQueue(workspaceId, branchId),
          fetchRuntimeBranchState(workspaceId, branchId),
        ]);

        setThreads(threadPayload);
        setActiveThreadIdState((prev) => {
          if (prev && threadPayload.some((thread) => thread.id === prev)) {
            return prev;
          }
          const owningThread =
            threadPayload.find((thread) => thread.branches?.some((branch) => branch.id === branchId)) ||
            threadPayload[0] ||
            null;
          return owningThread?.id || null;
        });

        const normalizedMessages = mapMessages(messagePayload.messages as Array<Record<string, unknown>>);
        const events = eventPayload.events as Array<Record<string, unknown>>;
        const activeRuns = (statePayload.activeRuns || []) as Array<Record<string, unknown>>;
        const activeIds = activeRuns
          .map((run) => String(run.id || "").trim())
          .filter(Boolean);
        setActiveRunIdsByBranch((previous) => ({
          ...previous,
          [branchId]: activeIds,
        }));
        setMessages(normalizedMessages);
        setFeedItems(mapFeedItems(events));
        setDecisions(mapDecisionsFromEvents(events, activeRuns));
        setProcessRuns(mapRuns(activeRuns, events));
        setQueuedMessages(
          (queuePayload.queue || []).map((item) => ({
            id: String(item.id),
            content: String(item.content),
            createdAt: toIso(item.createdAt),
          }))
        );
        setError(null);
      } catch (fetchError: any) {
        setError(String(fetchError?.message || "Failed to sync runtime data"));
      } finally {
        syncInFlightRef.current = false;
        setSyncing(false);
      }
    },
    [workspaceId]
  );

  const syncLibrary = useCallback(async () => {
    try {
      const payload = await fetchWorkspaceLibrary(workspaceId, { limit: 220 });
      setLibraryItemsRemote(Array.isArray(payload.items) ? payload.items : []);
    } catch (libraryError: any) {
      setError((previous) => previous || String(libraryError?.message || "Failed to sync workspace library"));
    }
  }, [workspaceId]);

  const ensureInitialThread = useCallback(async () => {
    const listed = await listRuntimeThreads(workspaceId);
    let resolved = listed;

    if (!resolved.length) {
      const created = await createRuntimeThread(workspaceId, {
        title: "Main workspace thread",
        createdBy: "portal-user",
      });
      resolved = [
        {
          ...created.thread,
          branches: created.thread.branches || [created.mainBranch],
        },
      ];
    }

    setThreads(resolved);

    const pickedThread = resolved[0];
    const pickedThreadId = pickedThread?.id || null;
    const pickedBranchId = pickedThread?.pinnedBranchId || pickedThread?.branches?.[0]?.id || null;

    setActiveThreadIdState(pickedThreadId);
    setActiveBranchIdState(pickedBranchId);
  }, [workspaceId]);

  const refreshNow = useCallback(async () => {
    if (!activeBranchId) return;
    await Promise.all([syncBranch(activeBranchId), syncLibrary()]);
  }, [activeBranchId, syncBranch, syncLibrary]);

  const sendMessage = useCallback(
    async (content: string, mode: "send" | "queue") => {
      if (!activeBranchId) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      await sendRuntimeMessage(workspaceId, activeBranchId, {
        content: trimmed,
        userId: "portal-user",
        mode,
        policy: buildPolicyFromPreferences(preferences),
      });

      await syncBranch(activeBranchId);
    },
    [activeBranchId, preferences, syncBranch, workspaceId]
  );

  const steerRun = useCallback(
    async (note: string) => {
      if (!activeBranchId) return;
      const trimmed = note.trim();
      if (!trimmed) return;
      await steerRuntimeBranch(workspaceId, activeBranchId, { note: trimmed });
      await syncBranch(activeBranchId);
    },
    [activeBranchId, syncBranch, workspaceId]
  );

  const interruptRun = useCallback(async () => {
    if (!activeBranchId) return;
    await interruptRuntimeBranch(workspaceId, activeBranchId, "Interrupted by user");
    await syncBranch(activeBranchId);
  }, [activeBranchId, syncBranch, workspaceId]);

  const reorderQueue = useCallback(
    async (from: number, to: number) => {
      if (!activeBranchId) return;
      if (from < 0 || to < 0 || from >= queuedMessages.length || to >= queuedMessages.length) return;
      const copy = [...queuedMessages];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      await reorderRuntimeQueue(
        workspaceId,
        activeBranchId,
        copy.map((entry) => entry.id)
      );
      await syncBranch(activeBranchId);
    },
    [activeBranchId, queuedMessages, syncBranch, workspaceId]
  );

  const removeQueued = useCallback(
    async (id: string) => {
      if (!activeBranchId) return;
      await cancelRuntimeQueueItem(workspaceId, activeBranchId, id);
      await syncBranch(activeBranchId);
    },
    [activeBranchId, syncBranch, workspaceId]
  );

  const resolveDecision = useCallback(
    async (decisionId: string, option: string) => {
      if (!activeBranchId) return;
      await resolveRuntimeDecision(workspaceId, activeBranchId, { decisionId, option });
      await syncBranch(activeBranchId);
    },
    [activeBranchId, syncBranch, workspaceId]
  );

  const createThread = useCallback(
    async (title: string) => {
      const created = await createRuntimeThread(workspaceId, {
        title: title.trim() || "New thread",
        createdBy: "portal-user",
      });

      setActiveThreadIdState(created.thread.id);
      setActiveBranchIdState(created.mainBranch.id);
      await syncBranch(created.mainBranch.id);
    },
    [syncBranch, workspaceId]
  );

  const createBranch = useCallback(
    async (name: string, forkedFromMessageId?: string) => {
      if (!activeThreadId || !activeBranchId) return;
      const payload = {
        name: name.trim() || `Branch ${new Date().toLocaleTimeString()}`,
        createdBy: "portal-user",
        forkedFromBranchId: activeBranchId,
        ...(forkedFromMessageId ? { forkedFromMessageId } : {}),
      };

      const created = await createRuntimeBranch(workspaceId, activeThreadId, payload);
      await pinRuntimeBranch(workspaceId, activeThreadId, created.branch.id);
      setActiveBranchIdState(created.branch.id);
      await syncBranch(created.branch.id);
    },
    [activeBranchId, activeThreadId, syncBranch, workspaceId]
  );

  const pinBranch = useCallback(
    async (branchId: string) => {
      const threadId =
        activeThreadId ||
        threads.find((thread) => thread.branches?.some((branch) => branch.id === branchId))?.id ||
        null;
      if (!threadId) return;
      await pinRuntimeBranch(workspaceId, threadId, branchId);
      setActiveThreadIdState(threadId);
      setActiveBranchIdState(branchId);
      await syncBranch(branchId);
    },
    [activeThreadId, syncBranch, threads, workspaceId]
  );

  const setPreference = useCallback(<K extends keyof SessionPreferences>(key: K, value: SessionPreferences[K]) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const isBranchHot = useMemo(
    () =>
      activeRunIds.length > 0 ||
      queuedMessages.length > 0,
    [activeRunIds.length, queuedMessages.length]
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    ensureInitialThread()
      .catch((setupError: any) => {
        if (!mounted) return;
        setError(String(setupError?.message || "Failed to initialize runtime workspace"));
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [ensureInitialThread, workspaceId]);

  useEffect(() => {
    if (!activeBranchId) return;

    void syncBranch(activeBranchId);

    if (pollerRef.current) {
      clearInterval(pollerRef.current);
      pollerRef.current = null;
    }

    const intervalMs = isBranchHot ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
    pollerRef.current = setInterval(() => {
      void syncBranch(activeBranchId);
    }, intervalMs);

    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
    };
  }, [activeBranchId, isBranchHot, syncBranch]);

  useEffect(() => {
    if (!activeBranchId) return;

    void syncLibrary();

    if (libraryPollerRef.current) {
      clearInterval(libraryPollerRef.current);
      libraryPollerRef.current = null;
    }

    libraryPollerRef.current = setInterval(() => {
      void syncLibrary();
    }, LIBRARY_POLL_INTERVAL_MS);

    return () => {
      if (libraryPollerRef.current) {
        clearInterval(libraryPollerRef.current);
        libraryPollerRef.current = null;
      }
    };
  }, [activeBranchId, syncLibrary]);

  useEffect(() => {
    if (!activeBranchId) return;
    if (loading || syncing) return;
    if (messages.length > 0) return;
    if (processRuns.length > 0) return;
    if (queuedMessages.length > 0) return;
    if (bootstrapAttemptedRef.current.has(activeBranchId)) return;

    bootstrapAttemptedRef.current.add(activeBranchId);

    void bootstrapRuntimeBranch(workspaceId, activeBranchId, {
      initiatedBy: "portal",
      policy: buildPolicyFromPreferences(preferences),
    })
      .then(() => syncBranch(activeBranchId))
      .catch((bootstrapError: any) => {
        setError((previous) => previous || String(bootstrapError?.message || "Failed to bootstrap runtime branch"));
      });
  }, [
    activeBranchId,
    loading,
    messages.length,
    preferences,
    processRuns.length,
    queuedMessages.length,
    syncing,
    syncBranch,
    workspaceId,
  ]);

  useEffect(() => {
    if (!activeThreadId) return;
    const thread = threads.find((entry) => entry.id === activeThreadId);
    if (!thread) return;

    const branchExists = thread.branches?.some((branch) => branch.id === activeBranchId);
    if (!branchExists) {
      const nextBranchId = thread.pinnedBranchId || thread.branches?.[0]?.id || null;
      setActiveBranchIdState(nextBranchId);
    }
  }, [activeBranchId, activeThreadId, threads]);

  return {
    loading,
    syncing,
    error,
    threads,
    activeThreadId,
    activeBranchId,
    branches,
    messages,
    processRuns,
    feedItems,
    decisions,
    queuedMessages,
    isStreaming: activeRunIds.length > 0,
    libraryItems: libraryItemsRemote,
    preferences,
    setActiveThreadId,
    setActiveBranchId,
    createThread,
    createBranch,
    pinBranch,
    sendMessage,
    interruptRun,
    reorderQueue,
    removeQueued,
    resolveDecision,
    steerRun,
    setPreference,
    refreshNow,
  };
}
