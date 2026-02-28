"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapRuntimeBranch,
  cancelRuntimeQueueItem,
  createRuntimeBranch,
  createRuntimeEventsSocket,
  createRuntimeThread,
  fetchRuntimeBranchState,
  fetchWorkspaceLibrary,
  issueRuntimeWsToken,
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
  RuntimeSocketMessage,
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
  tone: "detailed",
  sourceFocus: "mixed",
  transparency: true,
  askQuestionsFirst: false,
};

const ACTIVE_POLL_INTERVAL_MS = 1200;
const IDLE_POLL_INTERVAL_MS = 3200;
const LIBRARY_POLL_INTERVAL_MS = 15_000;
const WS_HEARTBEAT_INTERVAL_MS = 20_000;

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
  eventSeq?: string;
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
  const eventSeq = String(event.eventSeq || "").trim() || undefined;

  return {
    id: String(event.id || `${timestamp}-${Math.random()}`),
    ...(eventSeq ? { eventSeq } : {}),
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

function mergeRuntimeEvents(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
  max = 320
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  const push = (event: Record<string, unknown>) => {
    const id = String(event.id || "").trim();
    if (!id) return;
    byId.set(id, event);
  };
  for (const event of existing) push(event);
  for (const event of incoming) push(event);

  const merged = Array.from(byId.values()).sort((a, b) => {
    const aSeq = Number(String(a.eventSeq || "").trim());
    const bSeq = Number(String(b.eventSeq || "").trim());
    if (Number.isFinite(aSeq) && Number.isFinite(bSeq)) return aSeq - bSeq;
    const aTime = Date.parse(toIso(a.createdAt));
    const bTime = Date.parse(toIso(b.createdAt));
    return aTime - bTime;
  });
  return merged.slice(Math.max(0, merged.length - max));
}

function requiresStructuralSync(event: Record<string, unknown>): boolean {
  const normalized = normalizeRuntimeEvent(event);
  if (normalized.event === "run.completed") return true;
  if (normalized.event === "run.failed") return true;
  if (normalized.event === "run.cancelled") return true;
  if (normalized.event === "decision.required") return true;
  if (normalized.event === "run.waiting_input") return true;
  return false;
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
                ...(typeof reasoningRaw.runId === "string" && reasoningRaw.runId.trim()
                  ? { runId: reasoningRaw.runId.trim() }
                  : {}),
                ...(typeof reasoningRaw.ledgerVersionId === "string" && reasoningRaw.ledgerVersionId.trim()
                  ? { ledgerVersionId: reasoningRaw.ledgerVersionId.trim() }
                  : {}),
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
  if (normalized === "search.web") return "Web search";
  if (normalized === "competitors.discover_v3") return "V3 competitor finder";
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

function previewItemsFromUnknown(value: unknown, max = 5): Array<{ label: string; url?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const label = String(item.label || item.title || item.name || "").replace(/\s+/g, " ").trim();
      if (!label) return null;
      const url = String(item.url || item.href || item.profileUrl || "").trim();
      return {
        label,
        ...(url ? { url } : {}),
      };
    })
    .filter((item): item is { label: string; url?: string } => Boolean(item))
    .slice(0, max);
}

function toolOutputPreviewPayload(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload || !isRecord(payload.toolOutput)) return null;
  const toolOutput = payload.toolOutput;
  return isRecord(toolOutput.preview) ? toolOutput.preview : null;
}

function toValueFirstToolMessage(
  toolName: string | undefined,
  inputMessage: string,
  payload?: Record<string, unknown> | null
): string {
  const raw = String(inputMessage || "").trim();
  if (!raw) return `${readableToolName(toolName)} updated.`;
  const preview = toolOutputPreviewPayload(payload || null);

  if (toolName === "competitors.discover_v3" && preview) {
    const stats = isRecord(preview.stats) ? preview.stats : null;
    const persisted = Number(stats?.candidatesPersisted);
    const topPicks = Number(stats?.topPicks);
    const shortlisted = Number(stats?.shortlisted);
    const topCandidates = previewItemsFromUnknown(preview.topCandidates, 3).map((item) => item.label);
    const parts = [
      Number.isFinite(persisted) ? `${Math.max(0, Math.floor(persisted))} candidates` : "",
      Number.isFinite(topPicks) ? `${Math.max(0, Math.floor(topPicks))} top picks` : "",
      Number.isFinite(shortlisted) ? `${Math.max(0, Math.floor(shortlisted))} shortlisted` : "",
    ].filter(Boolean);
    return parts.length
      ? `V3 competitor finder ranked ${parts.join(", ")}${topCandidates.length ? `. Top signals: ${topCandidates.join(", ")}.` : "."}`
      : "V3 competitor finder updated the competitor landscape.";
  }

  if (toolName === "search.web" && preview) {
    const query = String(preview.query || "").trim();
    const provider = String(preview.provider || "").trim();
    const count = Number(preview.count);
    const top = previewItemsFromUnknown(preview.items, 2).map((item) => item.label);
    const countLabel = Number.isFinite(count) ? `${Math.max(0, Math.floor(count))} result(s)` : "search results";
    return `Web search returned ${countLabel}${provider ? ` via ${provider}` : ""}${query ? ` for "${query}"` : ""}${top.length ? `. Top: ${top.join(", ")}` : "."}`;
  }

  const numberResult = parseNumericResult(raw);
  if (toolName === "intel.list" && numberResult) {
    const sectionMatch = raw.match(/\bfrom\s+([a-z_]+)\b/i);
    const section = sectionMatch?.[1] ? humanizeToken(sectionMatch[1]) : "workspace section";
    const sampleItems = preview ? previewItemsFromUnknown(preview.items, 3).map((item) => item.label) : [];
    return `Loaded ${pluralize(numberResult.count, "record", "records")} from ${section}${sampleItems.length ? `. Examples: ${sampleItems.join(", ")}` : "."}`;
  }

  if (toolName === "evidence.posts" && numberResult) {
    const sampleItems = preview ? previewItemsFromUnknown(preview.items, 3).map((item) => item.label) : [];
    return `Found ${pluralize(numberResult.count, "social post", "social posts")} for review${sampleItems.length ? `: ${sampleItems.join(", ")}` : "."}`;
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
      message = toValueFirstToolMessage(event.toolName, event.message, event.payload);
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

function metricsFromDiscoverV3Result(result: Record<string, unknown>): Array<{ key: string; value: string }> {
  const stats = isRecord(result.stats) ? result.stats : isRecord(result.summary) ? result.summary : null;
  if (!stats) return [];
  const readInt = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
  };
  const metrics: Array<{ key: string; value: string }> = [];
  const persisted = readInt(stats.candidatesPersisted);
  const topPicks = readInt(stats.topPicks);
  const shortlisted = readInt(stats.shortlisted);
  const queries = readInt(stats.queriesExecuted);
  const searchResults = readInt(stats.searchResults);
  const enriched = readInt(stats.enriched);
  const canonicalEntities = readInt(stats.canonicalEntities);
  const canonicalSurfaces = readInt(stats.canonicalSurfaces);
  const canonicalEvidenceRefs = readInt(stats.canonicalEvidenceRefs);
  if (persisted !== null) metrics.push({ key: "Candidates", value: String(persisted) });
  if (canonicalEntities !== null) metrics.push({ key: "Entities", value: String(canonicalEntities) });
  if (canonicalSurfaces !== null) metrics.push({ key: "Surfaces", value: String(canonicalSurfaces) });
  if (canonicalEvidenceRefs !== null) metrics.push({ key: "Evidence refs", value: String(canonicalEvidenceRefs) });
  if (topPicks !== null) metrics.push({ key: "Top picks", value: String(topPicks) });
  if (shortlisted !== null) metrics.push({ key: "Shortlisted", value: String(shortlisted) });
  if (queries !== null) metrics.push({ key: "Queries", value: String(queries) });
  if (searchResults !== null) metrics.push({ key: "Search hits", value: String(searchResults) });
  if (enriched !== null) metrics.push({ key: "Enriched", value: String(enriched) });
  return metrics.slice(0, 8);
}

function extractRunInsightsFromToolRuns(toolRuns: Array<Record<string, unknown>>) {
  const details: string[] = [];
  const metrics: Array<{ key: string; value: string }> = [];
  const highlights: Array<{ label: string; url?: string }> = [];

  const pushDetail = (line: string) => {
    const value = String(line || "").replace(/\s+/g, " ").trim();
    if (!value) return;
    if (!details.includes(value)) details.push(value);
  };
  const pushMetric = (entry: { key: string; value: string }) => {
    if (!entry.key || !entry.value) return;
    if (!metrics.some((item) => item.key === entry.key && item.value === entry.value)) {
      metrics.push(entry);
    }
  };
  const pushHighlight = (entry: { label: string; url?: string }) => {
    const label = String(entry.label || "").trim();
    if (!label) return;
    if (!highlights.some((item) => item.label === label && item.url === entry.url)) {
      highlights.push(entry);
    }
  };

  for (const toolRun of toolRuns) {
    const toolName = String(toolRun.toolName || "").trim().toLowerCase();
    const result = isRecord(toolRun.resultJson) ? toolRun.resultJson : null;
    if (!result) continue;

    if (toolName === "competitors.discover_v3") {
      for (const metric of metricsFromDiscoverV3Result(result)) {
        pushMetric(metric);
      }
      const laneStats = isRecord(result.laneStats) ? result.laneStats : null;
      if (laneStats) {
        const activeLanes = Object.keys(laneStats).length;
        if (activeLanes > 0) {
          pushMetric({ key: "Lanes", value: String(activeLanes) });
        }
      }
      const topCandidates = previewItemsFromUnknown(result.topCandidates, 5);
      for (const candidate of topCandidates) {
        pushHighlight(candidate);
      }
      if (topCandidates.length > 0) {
        pushDetail(`Top competitors: ${topCandidates.map((item) => item.label).join(", ")}`);
      }
      continue;
    }

    if (toolName === "search.web") {
      const query = String(result.query || "").trim();
      const provider = String(result.provider || "").trim();
      const count = Number(result.count);
      if (Number.isFinite(count)) pushMetric({ key: "Search results", value: String(Math.floor(count)) });
      if (provider) pushMetric({ key: "Provider", value: provider });
      if (query) pushDetail(`Search query: ${query}`);
      for (const item of previewItemsFromUnknown(result.items, 3)) {
        pushHighlight(item);
      }
      continue;
    }

    if (toolName === "intel.list") {
      const section = String(result.section || "").trim();
      const count = Number(result.count);
      if (section && Number.isFinite(count)) {
        pushDetail(`Loaded ${Math.floor(count)} records from ${humanizeToken(section)}.`);
      }
      for (const item of previewItemsFromUnknown(Array.isArray(result.items) ? result.items : result.data, 3)) {
        pushHighlight(item);
      }
      continue;
    }
  }

  return {
    details: details.slice(0, 8),
    metrics: metrics.slice(0, 8),
    highlights: highlights.slice(0, 8),
  };
}

function mapDecisionItems(rawDecisions: unknown, runId?: string): DecisionItem[] {
  if (!Array.isArray(rawDecisions)) return [];
  const items: DecisionItem[] = [];
  for (const decision of rawDecisions) {
    if (!isRecord(decision)) continue;
    const id = String(decision.id || "").trim();
    const prompt = String(decision.title || decision.prompt || "").trim();
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
    items.push({
      id,
      prompt,
      options,
      ...(runId ? { runId } : {}),
    });
  }
  return items;
}

function mapDecisionsFromEvents(
  events: Array<Record<string, unknown>>,
  activeRuns: Array<Record<string, unknown>>
): DecisionItem[] {
  const waitingRunIds = new Set(
    activeRuns
      .filter((run) => String(run.status || "").toUpperCase() === "WAITING_USER")
      .map((run) => String(run.id || "").trim())
      .filter(Boolean)
  );
  if (waitingRunIds.size === 0) return [];

  const latest = normalizeRuntimeEvents(events).slice(-180);
  const items: DecisionItem[] = [];
  for (const event of latest) {
    const runId = String(event.runId || "").trim();
    if (!runId || !waitingRunIds.has(runId) || !event.payload) continue;
    const nextItems = mapDecisionItems(event.payload.decisions, runId);
    for (const entry of nextItems) {
      if (items.some((item) => item.id === entry.id && item.runId === entry.runId)) continue;
      items.push(entry);
    }
  }
  return items;
}

function extractRunApprovals(runId: string, normalizedEvents: NormalizedRuntimeEvent[]): DecisionItem[] {
  const items: DecisionItem[] = [];
  for (const event of normalizedEvents) {
    if (String(event.runId || "").trim() !== runId || !event.payload) continue;
    const nextItems = mapDecisionItems(event.payload.decisions, runId);
    for (const item of nextItems) {
      if (items.some((existing) => existing.id === item.id)) continue;
      items.push(item);
    }
  }
  return items.slice(0, 8);
}

function laneStatsFromUnknown(value: unknown): Array<{ lane: string; queries: number; hits: number }> {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([laneKey, laneValue]) => {
      if (!isRecord(laneValue)) return null;
      const queries = Number(laneValue.queries);
      const hits = Number(laneValue.hits);
      return {
        lane: humanizeToken(laneKey),
        queries: Number.isFinite(queries) ? Math.max(0, Math.floor(queries)) : 0,
        hits: Number.isFinite(hits) ? Math.max(0, Math.floor(hits)) : 0,
      };
    })
    .filter((entry): entry is { lane: string; queries: number; hits: number } => Boolean(entry))
    .sort((a, b) => b.hits - a.hits || b.queries - a.queries)
    .slice(0, 12);
}

function v3CandidatesFromUnknown(value: unknown, max = 10): Array<{ label: string; url?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate) => {
      if (!isRecord(candidate)) return null;
      const name = String(candidate.name || candidate.label || candidate.title || "").trim();
      const handle = String(candidate.handle || "").trim();
      const relationship = String(candidate.relationship || "").trim();
      const score = Number(candidate.score);
      const laneHits = Array.isArray(candidate.laneHits)
        ? candidate.laneHits
            .map((lane) => String(lane || "").trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];
      const labelParts = [
        [name, handle ? `@${handle}` : ""].filter(Boolean).join(" "),
        relationship ? humanizeToken(relationship) : "",
        Number.isFinite(score) ? `score ${score.toFixed(2)}` : "",
        laneHits.length ? `lanes: ${laneHits.join(", ")}` : "",
      ].filter(Boolean);
      const label = labelParts.join(" • ").trim();
      if (!label) return null;
      const url = String(candidate.profileUrl || candidate.url || candidate.href || "").trim();
      return {
        label,
        ...(url ? { url } : {}),
      };
    })
    .filter((entry): entry is { label: string; url?: string } => Boolean(entry))
    .slice(0, max);
}

function extractV3RunDetail(
  runId: string,
  toolRuns: Array<Record<string, unknown>>,
  normalizedEvents: NormalizedRuntimeEvent[]
): ProcessRun["v3Detail"] | undefined {
  const v3ToolRun = [...toolRuns]
    .reverse()
    .find((toolRun) => String(toolRun.toolName || "").trim().toLowerCase() === "competitors.discover_v3");
  if (!v3ToolRun) return undefined;

  const result = isRecord(v3ToolRun.resultJson) ? v3ToolRun.resultJson : null;
  if (!result) return undefined;

  const laneStats = laneStatsFromUnknown(result.laneStats);
  const topCandidates = v3CandidatesFromUnknown(result.topCandidates, 10);
  const evidenceLinks = previewItemsFromUnknown(result.evidence, 12);
  const warnings = asArrayOfStrings(result.warnings, 12);
  const approvals = extractRunApprovals(runId, normalizedEvents);
  const stats = metricsFromDiscoverV3Result(result);
  const mode = String(result.mode || "").trim().toLowerCase();

  if (!laneStats.length && !topCandidates.length && !evidenceLinks.length && !warnings.length && !approvals.length) {
    return undefined;
  }

  return {
    ...(mode ? { mode } : {}),
    ...(stats.length ? { stats } : {}),
    laneStats,
    topCandidates,
    evidenceLinks,
    warnings,
    approvals,
  };
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
      latestEvent?.toolName ? toValueFirstToolMessage(latestEvent.toolName, latestEvent.message, latestEvent.payload) : latestEvent?.message;

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
      ...(latestEvent?.toolName
        ? [`Latest update: ${toValueFirstToolMessage(latestEvent.toolName, latestEvent.message, latestEvent.payload)}`]
        : []),
    ];

    const insight = extractRunInsightsFromToolRuns(
      toolRuns.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    );
    const v3Detail = extractV3RunDetail(
      runId,
      toolRuns.filter((entry): entry is Record<string, unknown> => isRecord(entry)),
      normalizedEvents
    );
    for (const line of insight.details) {
      if (!details.includes(line)) details.push(line);
    }

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
      ...(insight.metrics.length ? { metrics: insight.metrics } : {}),
      ...(insight.highlights.length ? { highlights: insight.highlights } : {}),
      ...(v3Detail ? { v3Detail } : {}),
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
    maxToolRuns: normalizedTone === "detailed" ? 6 : 4,
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
  const wsRef = useRef<WebSocket | null>(null);
  const wsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestEventCursorRef = useRef<Record<string, string>>({});
  const eventsByBranchRef = useRef<Record<string, Array<Record<string, unknown>>>>({});
  const activeRunsByBranchRef = useRef<Record<string, Array<Record<string, unknown>>>>({});
  const syncInFlightRef = useRef(false);
  const bootstrapAttemptedRef = useRef<Set<string>>(new Set());
  const [wsConnectedByBranch, setWsConnectedByBranch] = useState<Record<string, boolean>>({});

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads]
  );

  const branches = useMemo(() => activeThread?.branches || [], [activeThread]);
  const activeRunIds = useMemo(() => {
    if (!activeBranchId) return [];
    return activeRunIdsByBranch[activeBranchId] || [];
  }, [activeBranchId, activeRunIdsByBranch]);
  const isSocketConnected = useMemo(() => {
    if (!activeBranchId) return false;
    return Boolean(wsConnectedByBranch[activeBranchId]);
  }, [activeBranchId, wsConnectedByBranch]);

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
        eventsByBranchRef.current = {
          ...eventsByBranchRef.current,
          [branchId]: events,
        };
        const latestEvent = events[events.length - 1];
        const latestCursor = String(latestEvent?.eventSeq || latestEvent?.id || "").trim();
        if (latestCursor) {
          latestEventCursorRef.current = {
            ...latestEventCursorRef.current,
            [branchId]: latestCursor,
          };
        }
        const activeRuns = (statePayload.activeRuns || []) as Array<Record<string, unknown>>;
        activeRunsByBranchRef.current = {
          ...activeRunsByBranchRef.current,
          [branchId]: activeRuns,
        };
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

  const applyRealtimeEvents = useCallback(
    (branchId: string, incoming: Array<Record<string, unknown>>): boolean => {
      if (!incoming.length) return false;
      const existing = eventsByBranchRef.current[branchId] || [];
      const merged = mergeRuntimeEvents(existing, incoming);
      eventsByBranchRef.current = {
        ...eventsByBranchRef.current,
        [branchId]: merged,
      };

      const latest = merged[merged.length - 1];
      const latestCursor = String(latest?.eventSeq || latest?.id || "").trim();
      if (latestCursor) {
        latestEventCursorRef.current = {
          ...latestEventCursorRef.current,
          [branchId]: latestCursor,
        };
      }

      const normalizedIncoming = normalizeRuntimeEvents(incoming);
      const hasRunDrift = (runs: ProcessRun[]): boolean => {
        const trackedRunIds = new Set(
          runs
            .map((run) => String(run.id || "").trim())
            .filter(Boolean)
        );
        return normalizedIncoming.some((event) => {
          const runId = String(event.runId || "").trim();
          if (!runId) return false;
          if (!["planning", "tools", "writing", "waiting_input"].includes(event.phase)) return false;
          return !trackedRunIds.has(runId);
        });
      };

      if (branchId !== activeBranchId) {
        const activeRuns = activeRunsByBranchRef.current[branchId] || [];
        const inferredRuns = mapRuns(activeRuns, merged);
        return hasRunDrift(inferredRuns);
      }

      const activeRuns = activeRunsByBranchRef.current[branchId] || [];
      const nextRuns = mapRuns(activeRuns, merged);
      setFeedItems(mapFeedItems(merged));
      setDecisions(mapDecisionsFromEvents(merged, activeRuns));
      setProcessRuns(nextRuns);
      const runningIds = nextRuns
        .filter((run) => run.status === "running" || run.status === "waiting_input")
        .map((run) => String(run.id || "").trim())
        .filter(Boolean);
      setActiveRunIdsByBranch((previous) => ({
        ...previous,
        [branchId]: runningIds,
      }));
      return hasRunDrift(nextRuns);
    },
    [activeBranchId]
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

    if (!isSocketConnected) {
      const intervalMs = isBranchHot ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
      pollerRef.current = setInterval(() => {
        void syncBranch(activeBranchId);
      }, intervalMs);
    }

    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
    };
  }, [activeBranchId, isBranchHot, isSocketConnected, syncBranch]);

  useEffect(() => {
    if (!activeBranchId) return;

    let isCancelled = false;
    let socket: WebSocket | null = null;
    setWsConnectedByBranch((previous) => ({
      ...previous,
      [activeBranchId]: false,
    }));

    const scheduleSync = (delayMs = 80) => {
      if (isCancelled) return;
      if (wsSyncTimerRef.current) return;
      wsSyncTimerRef.current = setTimeout(() => {
        wsSyncTimerRef.current = null;
        void syncBranch(activeBranchId);
      }, Math.max(0, delayMs));
    };

    const connectSocket = async () => {
      const rawCursor = String(latestEventCursorRef.current[activeBranchId] || "").trim();
      const cursor: { afterSeq?: string; afterId?: string; wsToken?: string } = {};
      if (/^\d+$/.test(rawCursor)) {
        cursor.afterSeq = rawCursor;
      } else if (rawCursor) {
        cursor.afterId = rawCursor;
      }

      try {
        const issued = await issueRuntimeWsToken(workspaceId, activeBranchId);
        const token = String(issued.token || "").trim();
        if (token) cursor.wsToken = token;
      } catch {
        // Token issuance can fail transiently; fallback to cookie path + polling safety net.
      }

      if (isCancelled) return;

      socket = createRuntimeEventsSocket(workspaceId, activeBranchId, cursor);
      wsRef.current = socket;

      socket.onopen = () => {
        if (isCancelled) return;
        setWsConnectedByBranch((previous) => ({
          ...previous,
          [activeBranchId]: true,
        }));
        // Always do one full refresh after (re)connect to avoid state drift.
        scheduleSync(0);
      };

      socket.onmessage = (event) => {
        if (isCancelled) return;
        let payload: RuntimeSocketMessage | null = null;
        try {
          payload = JSON.parse(String(event.data || "")) as RuntimeSocketMessage;
        } catch {
          payload = null;
        }
        if (!payload) return;

        if (payload.type === "EVENT" && payload.event?.id) {
          const rawEvent = payload.event as unknown as Record<string, unknown>;
          const drift = applyRealtimeEvents(activeBranchId, [rawEvent]);
          if (requiresStructuralSync(rawEvent) || drift) {
            scheduleSync(drift ? 0 : 160);
          }
          return;
        }

        if (payload.type === "EVENT_BATCH") {
          const batchEvents = Array.isArray(payload.events)
            ? payload.events
                .map((entry) => entry as unknown as Record<string, unknown>)
            : [];
          if (batchEvents.length) {
            applyRealtimeEvents(activeBranchId, batchEvents);
          }
          // Backlog delivery on reconnect should reconcile against full branch state once.
          scheduleSync(0);
          return;
        }

        if (payload.type === "ERROR") {
          setError((previous) => previous || payload.details || payload.error || "Runtime websocket error");
        }
      };

      socket.onclose = () => {
        if (isCancelled) return;
        setWsConnectedByBranch((previous) => ({
          ...previous,
          [activeBranchId]: false,
        }));
      };

      socket.onerror = () => {
        if (isCancelled) return;
        setWsConnectedByBranch((previous) => ({
          ...previous,
          [activeBranchId]: false,
        }));
      };
    };

    void connectSocket();

    const heartbeat = setInterval(() => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "PING" }));
    }, WS_HEARTBEAT_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(heartbeat);
      if (wsSyncTimerRef.current) {
        clearTimeout(wsSyncTimerRef.current);
        wsSyncTimerRef.current = null;
      }
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      try {
        socket?.close();
      } catch {
        // no-op
      }
      setWsConnectedByBranch((previous) => ({
        ...previous,
        [activeBranchId]: false,
      }));
    };
  }, [activeBranchId, applyRealtimeEvents, syncBranch, workspaceId]);

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
