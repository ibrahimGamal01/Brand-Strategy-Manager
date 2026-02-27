import {
  createPortalIntakeScanEvent,
  listPortalIntakeScanEvents,
} from './portal-intake-events-repository';

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
const listenersByWorkspace = new Map<string, Set<PortalIntakeEventListener>>();
const eventsByWorkspace = new Map<string, PortalIntakeEvent[]>();
let eventSequence = 0;

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
  const existing = eventsByWorkspace.get(event.workspaceId) || [];
  const nextEvents = [...existing, event];
  if (nextEvents.length > MAX_EVENTS_PER_WORKSPACE) {
    eventsByWorkspace.set(event.workspaceId, nextEvents.slice(nextEvents.length - MAX_EVENTS_PER_WORKSPACE));
  } else {
    eventsByWorkspace.set(event.workspaceId, nextEvents);
  }
}

function publishToListeners(event: PortalIntakeEvent) {
  for (const listener of getListeners(event.workspaceId)) {
    listener(event);
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
        const created = await createPortalIntakeScanEvent({
          workspaceId,
          scanRunId,
          type,
          message,
          ...(payload ? { payload } : {}),
        });
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
    appendMemoryEvent(event);
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
    const events = eventsByWorkspace.get(workspaceId) || [];
    const filtered = events.filter((event) => {
      if (event.id <= afterId) return false;
      if (scanRunId && event.scanRunId !== scanRunId) return false;
      return true;
    });
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  try {
    const rows = await listPortalIntakeScanEvents(workspaceId, {
      afterId,
      limit,
      ...(scanRunId ? { scanRunId } : {}),
    });
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
    if (mode !== 'dual') throw error;
    const events = eventsByWorkspace.get(workspaceId) || [];
    const filtered = events.filter((event) => {
      if (event.id <= afterId) return false;
      if (scanRunId && event.scanRunId !== scanRunId) return false;
      return true;
    });
    return filtered.slice(Math.max(0, filtered.length - limit));
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
