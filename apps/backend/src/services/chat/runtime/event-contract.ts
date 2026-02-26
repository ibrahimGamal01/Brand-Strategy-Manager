import { ProcessEventLevel, ProcessEventType, type ProcessEvent } from '@prisma/client';

export const RUNTIME_EVENT_V2_VERSION = 2 as const;

export type RuntimeEventPhase =
  | 'queued'
  | 'planning'
  | 'tools'
  | 'writing'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RuntimeEventKind =
  | 'run.started'
  | 'run.queued'
  | 'run.planning'
  | 'run.progress'
  | 'run.writing'
  | 'run.waiting_input'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.log'
  | 'tool.started'
  | 'tool.output'
  | 'tool.failed'
  | 'decision.required';

export type RuntimeEventStatus = 'info' | 'warn' | 'error';

export type RuntimeEventV2 = {
  version: typeof RUNTIME_EVENT_V2_VERSION;
  event: RuntimeEventKind;
  phase: RuntimeEventPhase;
  status: RuntimeEventStatus;
  runId?: string;
  toolRunId?: string;
  toolName?: string;
  createdAt?: string;
};

type NormalizeRuntimeEventInput = {
  type: ProcessEventType | string;
  level?: ProcessEventLevel | string | null;
  message?: unknown;
  agentRunId?: unknown;
  toolRunId?: unknown;
  payloadJson?: unknown;
  createdAt?: Date | string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function normalizeStatus(level: unknown): RuntimeEventStatus {
  const normalized = String(level || 'INFO').trim().toUpperCase();
  if (normalized === 'ERROR') return 'error';
  if (normalized === 'WARN' || normalized === 'WARNING') return 'warn';
  return 'info';
}

function normalizePhase(value: unknown): RuntimeEventPhase | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (
    normalized === 'queued' ||
    normalized === 'planning' ||
    normalized === 'tools' ||
    normalized === 'writing' ||
    normalized === 'waiting_input' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  return null;
}

function normalizeEvent(value: unknown): RuntimeEventKind | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'run.started' ||
    normalized === 'run.queued' ||
    normalized === 'run.planning' ||
    normalized === 'run.progress' ||
    normalized === 'run.writing' ||
    normalized === 'run.waiting_input' ||
    normalized === 'run.completed' ||
    normalized === 'run.failed' ||
    normalized === 'run.cancelled' ||
    normalized === 'run.log' ||
    normalized === 'tool.started' ||
    normalized === 'tool.output' ||
    normalized === 'tool.failed' ||
    normalized === 'decision.required'
  ) {
    return normalized;
  }
  return null;
}

function inferPhaseFromText(message: string, fallback: RuntimeEventPhase): RuntimeEventPhase {
  const normalized = message.toLowerCase();
  if (/\bqueue|queued\b/.test(normalized)) return 'queued';
  if (/\bplanning?\b/.test(normalized)) return 'planning';
  if (/\bwriting|drafting|final response|final answer\b/.test(normalized)) return 'writing';
  if (/\bapproval|decision|required|waiting for input\b/.test(normalized)) return 'waiting_input';
  return fallback;
}

function inferEventAndPhase(input: {
  type: string;
  message: string;
  payload: Record<string, unknown> | null;
  toolRunId?: string;
}): { event: RuntimeEventKind; phase: RuntimeEventPhase } {
  const normalizedType = input.type.toUpperCase();
  const toolName = asNonEmptyString(input.payload?.toolName);
  const toolLike = Boolean(toolName || input.toolRunId);

  if (normalizedType === 'PROCESS_STARTED') {
    return { event: 'run.started', phase: 'planning' };
  }

  if (normalizedType === 'PROCESS_PROGRESS') {
    if (toolLike) return { event: 'tool.started', phase: 'tools' };
    const inferredPhase = inferPhaseFromText(input.message, 'planning');
    if (inferredPhase === 'writing') {
      return { event: 'run.writing', phase: inferredPhase };
    }
    if (inferredPhase === 'planning') {
      return { event: 'run.planning', phase: inferredPhase };
    }
    return { event: 'run.progress', phase: inferredPhase };
  }

  if (normalizedType === 'PROCESS_RESULT') {
    return { event: 'tool.output', phase: 'tools' };
  }

  if (normalizedType === 'DECISION_REQUIRED') {
    return { event: 'decision.required', phase: 'waiting_input' };
  }

  if (normalizedType === 'WAITING_FOR_INPUT') {
    return { event: 'run.waiting_input', phase: 'waiting_input' };
  }

  if (normalizedType === 'DONE') {
    return { event: 'run.completed', phase: 'completed' };
  }

  if (normalizedType === 'PROCESS_CANCELLED') {
    return { event: 'run.cancelled', phase: 'cancelled' };
  }

  if (normalizedType === 'FAILED') {
    if (toolLike) return { event: 'tool.failed', phase: 'tools' };
    return { event: 'run.failed', phase: 'failed' };
  }

  if (normalizedType === 'PROCESS_LOG') {
    const inferredPhase = inferPhaseFromText(input.message, 'tools');
    if (inferredPhase === 'queued') return { event: 'run.queued', phase: inferredPhase };
    if (inferredPhase === 'planning') return { event: 'run.planning', phase: inferredPhase };
    if (inferredPhase === 'writing') return { event: 'run.writing', phase: inferredPhase };
    return { event: 'run.log', phase: inferredPhase };
  }

  return { event: 'run.log', phase: 'tools' };
}

export function normalizeRuntimeEventV2(input: NormalizeRuntimeEventInput): RuntimeEventV2 {
  const payload = isRecord(input.payloadJson) ? input.payloadJson : null;
  const payloadV2 = payload && isRecord(payload.eventV2) ? payload.eventV2 : null;
  const message = String(input.message || '').trim();

  const inferred = inferEventAndPhase({
    type: String(input.type || ''),
    message,
    payload,
    toolRunId: asNonEmptyString(input.toolRunId),
  });

  const event = normalizeEvent(payloadV2?.event) || inferred.event;
  const phase = normalizePhase(payloadV2?.phase) || inferred.phase;
  const status = normalizeStatus(payloadV2?.status || input.level);

  const createdAtRaw = payloadV2?.createdAt || input.createdAt;
  const createdAt =
    createdAtRaw instanceof Date
      ? createdAtRaw.toISOString()
      : asNonEmptyString(createdAtRaw) || undefined;

  const runId = asNonEmptyString(payloadV2?.runId) || asNonEmptyString(input.agentRunId);
  const toolRunId = asNonEmptyString(payloadV2?.toolRunId) || asNonEmptyString(input.toolRunId);
  const toolName = asNonEmptyString(payloadV2?.toolName) || asNonEmptyString(payload?.toolName);

  return {
    version: RUNTIME_EVENT_V2_VERSION,
    event,
    phase,
    status,
    ...(runId ? { runId } : {}),
    ...(toolRunId ? { toolRunId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

export function attachRuntimeEventV2Payload(input: {
  type: ProcessEventType | string;
  level?: ProcessEventLevel | string | null;
  message: string;
  agentRunId?: string | null;
  toolRunId?: string | null;
  payload?: unknown;
  createdAt?: Date | string | null;
}) {
  const eventV2 = normalizeRuntimeEventV2({
    type: input.type,
    level: input.level,
    message: input.message,
    agentRunId: input.agentRunId,
    toolRunId: input.toolRunId,
    payloadJson: input.payload,
    createdAt: input.createdAt,
  });

  if (isRecord(input.payload)) {
    return {
      ...input.payload,
      eventV2,
    };
  }

  if (input.payload === undefined || input.payload === null) {
    return { eventV2 };
  }

  return {
    eventV2,
    rawPayload: input.payload,
  };
}

export function serializeRuntimeProcessEvent(event: ProcessEvent) {
  return {
    ...event,
    eventV2: normalizeRuntimeEventV2({
      type: event.type,
      level: event.level,
      message: event.message,
      agentRunId: event.agentRunId,
      toolRunId: event.toolRunId,
      payloadJson: event.payloadJson,
      createdAt: event.createdAt,
    }),
  };
}
