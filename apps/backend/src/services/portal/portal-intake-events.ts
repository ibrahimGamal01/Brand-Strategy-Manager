import * as intakeEventsRepository from './portal-intake-events-repository';

type PortalIntakeEventListener = (event: PortalIntakeEvent) => void;

export type PortalIntakeEventType =
  | 'SCAN_STARTED'
  | 'SCAN_TARGET_STARTED'
  | 'SNAPSHOT_SAVED'
  | 'CRAWL_COMPLETED'
  | 'SCAN_WARNING'
  | 'SCAN_FAILED'
  | 'SCAN_DONE';

export type PortalIntakeEventStoreMode = 'memory' | 'dual' | 'db';

export type PortalIntakeEvent = {
  id: number;
  workspaceId: string;
  type: PortalIntakeEventType;
  message: string;
  payload?: Record<string, unknown>;
  scanRunId?: string;
  createdAt: string;
};

const MAX_EVENTS_PER_WORKSPACE = 300;
const FALLBACK_WARNING_INTERVAL_MS = (() => {
  const raw = Number(process.env.PORTAL_INTAKE_DB_FALLBACK_WARNING_MS);
  if (!Number.isFinite(raw)) return 60_000;
  return Math.max(10_000, Math.min(600_000, Math.floor(raw)));
})();

const listenersByWorkspace = new Map<string, Set<PortalIntakeEventListener>>();
const eventsByWorkspace = new Map<string, PortalIntakeEvent[]>();
const fallbackWarningByWorkspace = new Map<string, number>();
let eventSequence = 0;

type PortalIntakeEventsRepository = {
  createPortalIntakeScanEvent: typeof intakeEventsRepository.createPortalIntakeScanEvent;
  listPortalIntakeScanEvents: typeof intakeEventsRepository.listPortalIntakeScanEvents;
};

let portalIntakeEventsRepository: PortalIntakeEventsRepository = {
  createPortalIntakeScanEvent: intakeEventsRepository.createPortalIntakeScanEvent,
  listPortalIntakeScanEvents: intakeEventsRepository.listPortalIntakeScanEvents,
};

type PortalIntakeEventStoreCounters = {
  dbWriteSuccess: number;
  dbWriteFailure: number;
  memoryWriteSuccess: number;
  memoryWriteFailure: number;
  dbReadSuccess: number;
  dbReadFailure: number;
  dbReadFallbackToMemory: number;
  fallbackWarningsEmitted: number;
};

const eventStoreCounters: PortalIntakeEventStoreCounters = {
  dbWriteSuccess: 0,
  dbWriteFailure: 0,
  memoryWriteSuccess: 0,
  memoryWriteFailure: 0,
  dbReadSuccess: 0,
  dbReadFailure: 0,
  dbReadFallbackToMemory: 0,
  fallbackWarningsEmitted: 0,
};

export type PortalIntakeEventStoreDiagnostics = {
  mode: PortalIntakeEventStoreMode;
  counters: PortalIntakeEventStoreCounters;
  fallbackWarningIntervalMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveEventStoreMode(): PortalIntakeEventStoreMode {
  const raw = String(process.env.PORTAL_INTAKE_EVENT_STORE_MODE || 'dual').trim().toLowerCase();
  if (raw === 'memory' || raw === 'db' || raw === 'dual') return raw;
  return 'dual';
}

function getListeners(workspaceId: string): Set<PortalIntakeEventListener> {
  const existing = listenersByWorkspace.get(workspaceId);
  if (existing) return existing;
  const created = new Set<PortalIntakeEventListener>();
  listenersByWorkspace.set(workspaceId, created);
  return created;
}

function appendMemoryEvent(event: PortalIntakeEvent) {
  eventSequence = Math.max(eventSequence, Number(event.id) || 0);
  const existing = eventsByWorkspace.get(event.workspaceId) || [];
  const nextEvents = [...existing, event];
  if (nextEvents.length > MAX_EVENTS_PER_WORKSPACE) {
    eventsByWorkspace.set(event.workspaceId, nextEvents.slice(nextEvents.length - MAX_EVENTS_PER_WORKSPACE));
  } else {
    eventsByWorkspace.set(event.workspaceId, nextEvents);
  }
  eventStoreCounters.memoryWriteSuccess += 1;
}

function publishToListeners(event: PortalIntakeEvent) {
  for (const listener of getListeners(event.workspaceId)) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[Portal Intake Events] listener dispatch failed:', (error as Error)?.message || String(error));
    }
  }
}

function createMemoryEvent(input: {
  workspaceId: string;
  type: PortalIntakeEventType;
  message: string;
  payload?: Record<string, unknown>;
  scanRunId?: string;
}): PortalIntakeEvent {
  return {
    id: ++eventSequence,
    workspaceId: input.workspaceId,
    type: input.type,
    message: input.message,
    ...(input.payload ? { payload: input.payload } : {}),
    ...(input.scanRunId ? { scanRunId: input.scanRunId } : {}),
    createdAt: new Date().toISOString(),
  };
}

function listMemoryEvents(
  workspaceId: string,
  options: {
    afterId: number;
    limit: number;
    scanRunId?: string;
  }
): PortalIntakeEvent[] {
  const events = eventsByWorkspace.get(workspaceId) || [];
  const filtered = events.filter((event) => {
    if (event.id <= options.afterId) return false;
    if (options.scanRunId && event.scanRunId !== options.scanRunId) return false;
    return true;
  });
  return filtered.slice(Math.max(0, filtered.length - options.limit));
}

function emitFallbackWarningEvent(input: {
  workspaceId: string;
  scanRunId?: string;
  reason: string;
  context: 'publish' | 'list';
}) {
  const throttleKey = `${input.workspaceId}::${input.scanRunId || 'none'}`;
  const now = Date.now();
  const last = fallbackWarningByWorkspace.get(throttleKey) || 0;
  if (now - last < FALLBACK_WARNING_INTERVAL_MS) return;
  fallbackWarningByWorkspace.set(throttleKey, now);

  const warningEvent = createMemoryEvent({
    workspaceId: input.workspaceId,
    type: 'SCAN_WARNING',
    message: 'Intake scan events are temporarily using in-memory fallback while DB recovers.',
    payload: {
      source: 'portal_intake_event_store',
      mode: resolveEventStoreMode(),
      context: input.context,
      reason: input.reason,
    },
    ...(input.scanRunId ? { scanRunId: input.scanRunId } : {}),
  });

  try {
    appendMemoryEvent(warningEvent);
  } catch {
    eventStoreCounters.memoryWriteFailure += 1;
  }
  eventStoreCounters.fallbackWarningsEmitted += 1;
  publishToListeners(warningEvent);
}

export function getPortalIntakeEventStoreDiagnostics(): PortalIntakeEventStoreDiagnostics {
  return {
    mode: resolveEventStoreMode(),
    counters: { ...eventStoreCounters },
    fallbackWarningIntervalMs: FALLBACK_WARNING_INTERVAL_MS,
  };
}

export function __setPortalIntakeEventsRepositoryForTests(repository: PortalIntakeEventsRepository | null) {
  portalIntakeEventsRepository = repository || {
    createPortalIntakeScanEvent: intakeEventsRepository.createPortalIntakeScanEvent,
    listPortalIntakeScanEvents: intakeEventsRepository.listPortalIntakeScanEvents,
  };
}

export async function publishPortalIntakeEvent(
  workspaceId: string,
  type: PortalIntakeEventType,
  message: string,
  payload?: Record<string, unknown>,
  options?: {
    scanRunId?: string;
  }
): Promise<PortalIntakeEvent> {
  const mode = resolveEventStoreMode();
  const scanRunId = String(options?.scanRunId || '').trim() || undefined;
  const writeToDb = mode === 'dual' || mode === 'db';
  const writeToMemory = mode === 'dual' || mode === 'memory';
  let event: PortalIntakeEvent | null = null;

  if (writeToDb) {
    if (!scanRunId) {
      if (mode === 'db') {
        throw new Error('scanRunId is required when PORTAL_INTAKE_EVENT_STORE_MODE=db');
      }
    } else {
      try {
        const created = await portalIntakeEventsRepository.createPortalIntakeScanEvent({
          workspaceId,
          scanRunId,
          type,
          message,
          ...(payload ? { payload } : {}),
        });
        eventStoreCounters.dbWriteSuccess += 1;
        event = {
          id: created.id,
          workspaceId: created.workspaceId,
          type: created.type as PortalIntakeEventType,
          message: created.message,
          ...(isRecord(created.payload) ? { payload: created.payload } : {}),
          scanRunId: created.scanRunId,
          createdAt: created.createdAt,
        };
      } catch (error) {
        eventStoreCounters.dbWriteFailure += 1;
        console.warn(
          '[Portal Intake Events] DB write failed, falling back to memory:',
          (error as Error)?.message || String(error)
        );
        if (mode === 'dual') {
          emitFallbackWarningEvent({
            workspaceId,
            ...(scanRunId ? { scanRunId } : {}),
            reason: (error as Error)?.message || String(error),
            context: 'publish',
          });
        }
        if (mode === 'db') {
          throw error;
        }
      }
    }
  }

  if (!event) {
    event = createMemoryEvent({
      workspaceId,
      type,
      message,
      ...(payload ? { payload } : {}),
      ...(scanRunId ? { scanRunId } : {}),
    });
  }

  if (writeToMemory) {
    try {
      appendMemoryEvent(event);
    } catch (error) {
      eventStoreCounters.memoryWriteFailure += 1;
      if (mode === 'memory') {
        throw error;
      }
      console.warn('[Portal Intake Events] Memory write failed:', (error as Error)?.message || String(error));
    }
  }

  publishToListeners(event);
  return event;
}

export async function listPortalIntakeEvents(
  workspaceId: string,
  options?: {
    afterId?: number;
    limit?: number;
    scanRunId?: string;
  }
): Promise<PortalIntakeEvent[]> {
  const afterId = typeof options?.afterId === 'number' ? options.afterId : 0;
  const limit = Math.max(1, Math.min(500, Number(options?.limit || 200)));
  const scanRunId = String(options?.scanRunId || '').trim() || undefined;
  const mode = resolveEventStoreMode();

  if (mode === 'memory') {
    return listMemoryEvents(workspaceId, { afterId, limit, ...(scanRunId ? { scanRunId } : {}) });
  }

  try {
    const rows = await portalIntakeEventsRepository.listPortalIntakeScanEvents(workspaceId, {
      afterId,
      limit,
      ...(scanRunId ? { scanRunId } : {}),
    });
    eventStoreCounters.dbReadSuccess += 1;
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      type: row.type as PortalIntakeEventType,
      message: row.message,
      ...(isRecord(row.payload) ? { payload: row.payload } : {}),
      scanRunId: row.scanRunId,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    eventStoreCounters.dbReadFailure += 1;
    if (mode !== 'dual') throw error;
    eventStoreCounters.dbReadFallbackToMemory += 1;
    emitFallbackWarningEvent({
      workspaceId,
      ...(scanRunId ? { scanRunId } : {}),
      reason: (error as Error)?.message || String(error),
      context: 'list',
    });
    return listMemoryEvents(workspaceId, { afterId, limit, ...(scanRunId ? { scanRunId } : {}) });
  }
}

export function subscribePortalIntakeEvents(
  workspaceId: string,
  listener: PortalIntakeEventListener
): () => void {
  const listeners = getListeners(workspaceId);
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByWorkspace.delete(workspaceId);
    }
  };
}
