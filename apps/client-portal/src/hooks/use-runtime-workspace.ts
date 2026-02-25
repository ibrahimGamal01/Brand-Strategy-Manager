"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelRuntimeQueueItem,
  createRuntimeBranch,
  createRuntimeThread,
  fetchRuntimeBranchState,
  listRuntimeEvents,
  listRuntimeMessages,
  listRuntimeQueue,
  listRuntimeThreads,
  pinRuntimeBranch,
  reorderRuntimeQueue,
  sendRuntimeMessage,
  interruptRuntimeBranch,
} from "@/lib/runtime-api";
import {
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
  setPreference: <K extends keyof SessionPreferences>(key: K, value: SessionPreferences[K]) => void;
  refreshNow: () => Promise<void>;
};

const DEFAULT_PREFERENCES: SessionPreferences = {
  tone: "balanced",
  sourceFocus: "mixed",
  transparency: true,
  askQuestionsFirst: false,
};

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

function asArrayOfStrings(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function mapMessages(messages: Array<Record<string, unknown>>): ChatMessage[] {
  return messages
    .filter((message) => String(message.role || "").toUpperCase() !== "TOOL")
    .map((message) => {
      const reasoningRaw = isRecord(message.reasoningJson) ? message.reasoningJson : null;
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
  const latest = [...events].slice(-60).reverse();
  return latest.map((event) => {
    const type = String(event.type || "").toUpperCase();
    const actionLabel =
      type === "PROCESS_RESULT" ? "Open result" : type === "DECISION_REQUIRED" ? "Review options" : undefined;
    return {
      id: String(event.id || `${event.createdAt || Math.random()}`),
      timestamp: formatTime(toIso(event.createdAt)),
      message: String(event.message || ""),
      ...(actionLabel ? { actionLabel } : {}),
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

function mapRuns(activeRuns: Array<Record<string, unknown>>): ProcessRun[] {
  return activeRuns.map((run) => {
    const statusRaw = String(run.status || "RUNNING").toUpperCase();
    const toolRuns = Array.isArray(run.toolRuns) ? run.toolRuns : [];
    const total = toolRuns.length || 1;
    const done = toolRuns.filter((tool) => isRecord(tool) && String(tool.status || "").toUpperCase() === "DONE").length;
    const progress = statusRaw === "DONE" ? 100 : Math.min(95, Math.round((done / total) * 100));

    const stage =
      statusRaw === "WAITING_USER"
        ? "Waiting for approval"
        : statusRaw === "WAITING_TOOLS"
          ? `Running ${toolRuns.length || 1} task(s)`
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
      label: `Run ${String(run.triggerType || "workflow").toLowerCase().replace(/_/g, " ")}`,
      stage,
      progress,
      status,
    };
  });
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

  const [preferences, setPreferences] = useState<SessionPreferences>(DEFAULT_PREFERENCES);

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        setMessages(normalizedMessages);
        setFeedItems(mapFeedItems(events));
        setDecisions(mapDecisionsFromEvents(events, activeRuns));
        setProcessRuns(mapRuns(activeRuns));
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
        setSyncing(false);
      }
    },
    [workspaceId]
  );

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
    await syncBranch(activeBranchId);
  }, [activeBranchId, syncBranch]);

  const sendMessage = useCallback(
    async (content: string, mode: "send" | "queue") => {
      if (!activeBranchId) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const effectiveMode =
        mode === "queue" ? "queue" : processRuns.some((run) => run.status === "running") ? "interrupt" : "send";

      await sendRuntimeMessage(workspaceId, activeBranchId, {
        content: trimmed,
        userId: "portal-user",
        mode: effectiveMode,
        policy: buildPolicyFromPreferences(preferences),
      });

      await syncBranch(activeBranchId);
    },
    [activeBranchId, preferences, processRuns, syncBranch, workspaceId]
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
      await sendMessage(`Decision ${decisionId}: ${option}`, "send");
    },
    [sendMessage]
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

    pollerRef.current = setInterval(() => {
      void syncBranch(activeBranchId);
    }, 2200);

    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
    };
  }, [activeBranchId, syncBranch]);

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
    isStreaming: processRuns.some((run) => run.status === "running" || run.status === "waiting_input"),
    libraryItems: deriveLibrary(messages),
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
    setPreference,
    refreshNow,
  };
}
