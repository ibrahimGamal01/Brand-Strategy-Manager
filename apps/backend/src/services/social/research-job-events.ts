import { Prisma, ResearchJobEvent } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export type ResearchJobEventLevel = 'info' | 'warn' | 'error';

export type ResearchJobEventInput = {
  researchJobId: string;
  runId?: string | null;
  source: string;
  code: string;
  level?: ResearchJobEventLevel;
  message: string;
  platform?: string | null;
  handle?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metrics?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type ResearchJobEventRecord = {
  id: number;
  researchJobId: string;
  runId: string | null;
  source: string;
  code: string;
  level: ResearchJobEventLevel;
  message: string;
  platform: string | null;
  handle: string | null;
  entityType: string | null;
  entityId: string | null;
  metrics: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
};

type EventListener = (event: ResearchJobEventRecord) => void;

const SENSITIVE_KEY_PATTERN =
  /(token|cookie|authorization|api[_-]?key|password|secret|session|bearer)/i;
const subscribersByJob = new Map<string, Set<EventListener>>();

let pruneTimer: NodeJS.Timeout | null = null;

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeLevel(level: unknown): ResearchJobEventLevel {
  if (level === 'warn' || level === 'error' || level === 'info') return level;
  return 'info';
}

function stripQueryStringFromUrl(raw: string): string {
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return raw;
  }
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (value == null) return value;

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }

  if (typeof value === 'string') {
    return stripQueryStringFromUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key));
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(input)) {
      sanitized[childKey] = sanitizeValue(childValue, childKey);
    }
    return sanitized;
  }

  return value;
}

function toClientEvent(event: ResearchJobEvent): ResearchJobEventRecord {
  return {
    id: event.id,
    researchJobId: event.researchJobId,
    runId: event.runId,
    source: event.source,
    code: event.code,
    level: normalizeLevel(event.level),
    message: event.message,
    platform: event.platform,
    handle: event.handle,
    entityType: event.entityType,
    entityId: event.entityId,
    metrics: event.metrics as Prisma.JsonValue | null,
    metadata: event.metadata as Prisma.JsonValue | null,
    createdAt: event.createdAt.toISOString(),
  };
}

function publish(event: ResearchJobEventRecord) {
  const listeners = subscribersByJob.get(event.researchJobId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error: any) {
      console.warn(`[ResearchEvents] Listener dispatch failed: ${error?.message || error}`);
    }
  }
}

async function persistEvent(input: ResearchJobEventInput): Promise<void> {
  try {
    const sanitizedMetrics = sanitizeValue(input.metrics ?? null, 'metrics') as
      | Prisma.InputJsonValue
      | null;
    const sanitizedMetadata = sanitizeValue(input.metadata ?? null, 'metadata') as
      | Prisma.InputJsonValue
      | null;

    const event = await prisma.researchJobEvent.create({
      data: {
        researchJobId: input.researchJobId,
        runId: input.runId ?? null,
        source: input.source,
        code: input.code,
        level: normalizeLevel(input.level),
        message: input.message,
        platform: input.platform ?? null,
        handle: input.handle ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metrics: sanitizedMetrics === null ? undefined : sanitizedMetrics,
        metadata: sanitizedMetadata === null ? undefined : sanitizedMetadata,
      },
    });

    publish(toClientEvent(event));
  } catch (error: any) {
    console.warn(`[ResearchEvents] Failed to persist event: ${error?.message || error}`);
  }
}

export function emitResearchJobEvent(input: ResearchJobEventInput): void {
  void persistEvent(input);
}

export function emitResearchJobEvents(inputs: ResearchJobEventInput[]): void {
  for (const input of inputs) {
    void persistEvent(input);
  }
}

export async function listResearchJobEvents(
  researchJobId: string,
  options: { afterId?: number | null; limit?: number } = {}
): Promise<ResearchJobEventRecord[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const hasAfterId = Boolean(options.afterId && options.afterId > 0);
  const afterId = hasAfterId ? Number(options.afterId) : undefined;
  const where: Prisma.ResearchJobEventWhereInput = { researchJobId };

  if (hasAfterId) {
    where.id = { gt: afterId };
  }

  const events = await prisma.researchJobEvent.findMany({
    where,
    // Initial load should show the latest activity window; incremental loads keep ascending order.
    orderBy: { id: hasAfterId ? 'asc' : 'desc' },
    take: limit,
  });

  if (!hasAfterId) {
    events.reverse();
  }

  return events.map(toClientEvent);
}

export function subscribeResearchJobEvents(
  researchJobId: string,
  listener: EventListener
): () => void {
  const listeners = subscribersByJob.get(researchJobId) ?? new Set<EventListener>();
  listeners.add(listener);
  subscribersByJob.set(researchJobId, listeners);

  return () => {
    const currentListeners = subscribersByJob.get(researchJobId);
    if (!currentListeners) return;
    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      subscribersByJob.delete(researchJobId);
    }
  };
}

export function serializeResearchJobEventSse(event: ResearchJobEventRecord): string {
  const payload = JSON.stringify(event);
  return `id: ${event.id}\nevent: research-job-event\ndata: ${payload}\n\n`;
}

export async function pruneResearchJobEvents(): Promise<{
  deletedCount: number;
  retentionDays: number;
  maxPerJob: number;
}> {
  const retentionDays = toPositiveInt(process.env.RESEARCH_EVENTS_RETENTION_DAYS, 30);
  const maxPerJob = toPositiveInt(process.env.RESEARCH_EVENTS_MAX_PER_JOB, 5000);
  let deletedCount = 0;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const retentionResult = await prisma.researchJobEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  deletedCount += retentionResult.count;

  if (maxPerJob > 0) {
    const grouped = await prisma.researchJobEvent.groupBy({
      by: ['researchJobId'],
      _count: { _all: true },
    });

    for (const group of grouped) {
      const count = group._count._all;
      if (!count || count <= maxPerJob) continue;

      while (true) {
        const staleEvents = await prisma.researchJobEvent.findMany({
          where: { researchJobId: group.researchJobId },
          orderBy: { id: 'desc' },
          skip: maxPerJob,
          take: 500,
          select: { id: true },
        });

        if (staleEvents.length === 0) break;

        const deleteResult = await prisma.researchJobEvent.deleteMany({
          where: { id: { in: staleEvents.map((item) => item.id) } },
        });
        deletedCount += deleteResult.count;

        if (staleEvents.length < 500) break;
      }
    }
  }

  return { deletedCount, retentionDays, maxPerJob };
}

export function startResearchJobEventPruning() {
  if (pruneTimer) return;

  const intervalMs = toPositiveInt(process.env.RESEARCH_EVENTS_PRUNE_INTERVAL_MS, 21600000);

  const runPrune = async () => {
    try {
      const result = await pruneResearchJobEvents();
      if (result.deletedCount > 0) {
        console.log(
          `[ResearchEvents] Pruned ${result.deletedCount} events (retention=${result.retentionDays}d maxPerJob=${result.maxPerJob})`
        );
      }
    } catch (error: any) {
      console.warn(`[ResearchEvents] Prune failed: ${error?.message || error}`);
    }
  };

  void runPrune();
  pruneTimer = setInterval(() => {
    void runPrune();
  }, intervalMs);
}

export function stopResearchJobEventPruning() {
  if (!pruneTimer) return;
  clearInterval(pruneTimer);
  pruneTimer = null;
}
