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

function extractToolNameFromEvent(event: Record<string, unknown>): string | undefined {
  const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
  const toolName = String(payload?.toolName || "").trim();
  return toolName || undefined;
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

function mapFeedItems(events: Array<Record<string, unknown>>): ProcessFeedItem[] {
  const latest = [...events].slice(-120).reverse();
  return latest.map((event) => {
    const type = String(event.type || "").toUpperCase();
    const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
    const toolName = extractToolNameFromEvent(event);
    const runId = String(event.agentRunId || "").trim() || undefined;

    let message = String(event.message || "Runtime event");
    if (type === "PROCESS_STARTED") {
      message = `${humanizeTriggerType(payload?.triggerType || "workflow")} started.`;
    } else if (type === "PROCESS_PROGRESS" && toolName) {
      message = `Running ${toolName}...`;
    } else if (type === "PROCESS_RESULT" && toolName) {
      const raw = String(event.message || "Done").trim();
      message =
        raw.toLowerCase().startsWith(toolName.toLowerCase()) || raw.toLowerCase().startsWith(`${toolName.toLowerCase()}:`)
          ? raw
          : `${toolName} completed: ${raw}`;
    } else if (type === "FAILED" && toolName) {
      const raw = String(event.message || "Failed").trim();
      message =
        raw.toLowerCase().startsWith(toolName.toLowerCase()) || raw.toLowerCase().startsWith(`${toolName.toLowerCase()}:`)
          ? raw
          : `${toolName} failed: ${raw}`;
    } else if (type === "DONE") {
      const toolRuns = Array.isArray(payload?.toolRuns) ? payload?.toolRuns : [];
      const tools = toolRuns
        .map((row) => (isRecord(row) ? String(row.toolName || "").trim() : ""))
        .filter(Boolean);
      if (tools.length) {
        const preview = tools.slice(0, 3).join(", ");
        message = `Run completed (${tools.length} tools): ${preview}${tools.length > 3 ? "..." : ""}`;
      } else {
        message = runId ? `Run ${runId.slice(0, 8)} completed.` : "Run completed.";
      }
    } else if (type === "DECISION_REQUIRED") {
      message = "Approval needed before BAT can continue.";
    }

    const actionLabel =
      type === "PROCESS_RESULT"
        ? "View result"
        : type === "DECISION_REQUIRED"
          ? "Review approval"
          : type === "FAILED"
            ? "Inspect issue"
            : undefined;

    return {
      id: String(event.id || `${event.createdAt || Math.random()}`),
      timestamp: formatTime(toIso(event.createdAt)),
      message,
      ...(actionLabel ? { actionLabel } : {}),
      ...(runId ? { runId } : {}),
      ...(toolName ? { toolName } : {}),
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

  const latest = [...events].slice(-160);

  for (const event of latest) {
    const runId = String(event.agentRunId || "").trim();
    if (!runId || !waitingRunIds.has(runId)) continue;

    const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
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
    status: ProcessRun["status"];
    tools: Set<string>;
  };

  const aggregates = new Map<string, RecentRunAggregate>();
  const now = Date.now();

  for (const event of events) {
    const runId = String(event.agentRunId || "").trim();
    if (!runId) continue;
    const createdAt = toIso(event.createdAt);
    const createdAtMs = Date.parse(createdAt);
    if (Number.isFinite(createdAtMs) && now - createdAtMs > 1000 * 60 * 45) continue;

    const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
    const type = String(event.type || "").toUpperCase();
    const toolName = extractToolNameFromEvent(event);
    const aggregate = aggregates.get(runId) || {
      id: runId,
      triggerType: String(payload?.triggerType || "workflow"),
      latestMessage: String(event.message || "Recent runtime activity"),
      latestAt: createdAt,
      status: "running" as const,
      tools: new Set<string>(),
    };

    if (toolName) {
      aggregate.tools.add(toolName);
    }
    if (type === "DONE" && Array.isArray(payload?.toolRuns)) {
      for (const row of payload.toolRuns) {
        if (!isRecord(row)) continue;
        const completedTool = String(row.toolName || "").trim();
        if (completedTool) {
          aggregate.tools.add(completedTool);
        }
      }
    }
    if (payload?.triggerType && String(payload.triggerType).trim()) {
      aggregate.triggerType = String(payload.triggerType);
    }
    aggregate.latestMessage = String(event.message || aggregate.latestMessage || "Recent runtime activity");
    aggregate.latestAt = createdAt;

    if (type === "DONE") {
      aggregate.status = "done";
    } else if (type === "FAILED") {
      aggregate.status = "failed";
    } else if (type === "WAITING_FOR_INPUT" || type === "DECISION_REQUIRED") {
      aggregate.status = "waiting_input";
    } else if (type === "PROCESS_CANCELLED") {
      aggregate.status = "cancelled";
    }

    aggregates.set(runId, aggregate);
  }

  return Array.from(aggregates.values())
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))
    .slice(0, 8)
    .map((run) => {
      const tools = Array.from(run.tools);
      const details = tools.length ? [`Tools: ${tools.slice(0, 4).join(", ")}${tools.length > 4 ? "..." : ""}`] : [];
      return {
        id: run.id,
        label: `${humanizeTriggerType(run.triggerType)} • ${shortId(run.id)}`,
        stage: run.latestMessage,
        progress: run.status === "done" || run.status === "failed" || run.status === "cancelled" ? 100 : 88,
        status: run.status,
        ...(details.length ? { details } : {}),
      };
    });
}

function mapRuns(activeRuns: Array<Record<string, unknown>>, events: Array<Record<string, unknown>>): ProcessRun[] {
  const mappedActive = activeRuns.map((run) => {
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
    const progress = statusRaw === "DONE" ? 100 : Math.min(95, Math.round((done / total) * 100));

    const stage =
      statusRaw === "WAITING_USER"
        ? "Waiting for approval"
        : statusRaw === "WAITING_TOOLS"
          ? inFlightToolNames.length
            ? `Running ${inFlightToolNames.join(", ")}`
            : `Running ${toolRuns.length || 1} task(s)`
          : statusRaw === "QUEUED"
            ? "Queued"
            : statusRaw === "FAILED"
              ? "Failed"
              : statusRaw === "CANCELLED"
                ? "Cancelled"
                : statusRaw === "DONE"
                  ? "Completed"
                  : "Running";

    const status: ProcessRun["status"] =
      statusRaw === "WAITING_USER"
        ? "waiting_input"
        : statusRaw === "DONE"
          ? "done"
          : statusRaw === "FAILED"
            ? "failed"
            : statusRaw === "CANCELLED"
              ? "cancelled"
              : "running";

    return {
      id: String(run.id || ""),
      label: `${humanizeTriggerType(run.triggerType)} • ${shortId(run.id)}`,
      stage,
      progress,
      status,
      details: [
        `Completed ${done}/${total} tool run(s)`,
        ...(inFlightToolNames.length ? [`In progress: ${inFlightToolNames.slice(0, 3).join(", ")}${inFlightToolNames.length > 3 ? "..." : ""}`] : []),
      ],
    };
  });

  if (mappedActive.length > 0) return mappedActive;
  return mapRecentRunsFromEvents(events);
}

function deriveLibrary(messages: ChatMessage[]): LibraryItem[] {
  const items: LibraryItem[] = [];
  for (const message of messages) {
    if (!message.reasoning?.evidence?.length) continue;
    for (const evidence of message.reasoning.evidence) {
      items.push({
        id: `${message.id}-${evidence.id}`,
        collection: "web",
        title: evidence.label,
        summary: `Referenced in assistant message ${message.id.slice(0, 8)}`,
        freshness: formatTime(message.createdAt),
        tags: ["evidence", "chat"],
        evidenceLabel: evidence.label,
        ...(evidence.href ? { evidenceHref: evidence.href } : {}),
      });
    }
  }

  return items.slice(0, 60);
}

function mergeLibraryItems(remote: LibraryItem[], derived: LibraryItem[]): LibraryItem[] {
  const byId = new Map<string, LibraryItem>();
  for (const item of [...remote, ...derived]) {
    if (!item?.id) continue;
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
      continue;
    }
    const previous = byId.get(item.id)!;
    const prevTs = Date.parse(previous.freshness || '');
    const nextTs = Date.parse(item.freshness || '');
    if (Number.isFinite(nextTs) && (!Number.isFinite(prevTs) || nextTs > prevTs)) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values()).sort((a, b) => Date.parse(b.freshness || '') - Date.parse(a.freshness || ''));
}

function buildPolicyFromPreferences(preferences: SessionPreferences): Record<string, unknown> {
  return {
    autoContinue: !preferences.askQuestionsFirst,
    maxAutoContinuations: preferences.tone === "concise" ? 0 : 1,
    maxToolRuns: preferences.tone === "concise" ? 2 : 4,
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
  const [activeRunIds, setActiveRunIds] = useState<string[]>([]);

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
        setActiveRunIds(
          activeRuns
            .map((run) => String(run.id || "").trim())
            .filter(Boolean)
        );
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

      const effectiveMode = mode === "queue" ? "queue" : activeRunIds.length > 0 ? "queue" : "send";

      await sendRuntimeMessage(workspaceId, activeBranchId, {
        content: trimmed,
        userId: "portal-user",
        mode: effectiveMode,
        policy: buildPolicyFromPreferences(preferences),
      });

      await syncBranch(activeBranchId);
    },
    [activeBranchId, preferences, activeRunIds, syncBranch, workspaceId]
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

  const mergedLibraryItems = useMemo(
    () => mergeLibraryItems(libraryItemsRemote, deriveLibrary(messages)),
    [libraryItemsRemote, messages]
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
    libraryItems: mergedLibraryItems,
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
