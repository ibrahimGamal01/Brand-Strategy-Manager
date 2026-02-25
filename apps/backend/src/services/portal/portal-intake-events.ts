type PortalIntakeEventListener = (event: PortalIntakeEvent) => void;

export type PortalIntakeEventType =
  | 'SCAN_STARTED'
  | 'SCAN_TARGET_STARTED'
  | 'SNAPSHOT_SAVED'
  | 'CRAWL_COMPLETED'
  | 'SCAN_WARNING'
  | 'SCAN_FAILED'
  | 'SCAN_DONE';

export type PortalIntakeEvent = {
  id: number;
  workspaceId: string;
  type: PortalIntakeEventType;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

const MAX_EVENTS_PER_WORKSPACE = 300;
const listenersByWorkspace = new Map<string, Set<PortalIntakeEventListener>>();
const eventsByWorkspace = new Map<string, PortalIntakeEvent[]>();
let eventSequence = 0;

function getListeners(workspaceId: string): Set<PortalIntakeEventListener> {
  const existing = listenersByWorkspace.get(workspaceId);
  if (existing) return existing;
  const created = new Set<PortalIntakeEventListener>();
  listenersByWorkspace.set(workspaceId, created);
  return created;
}

export function publishPortalIntakeEvent(
  workspaceId: string,
  type: PortalIntakeEventType,
  message: string,
  payload?: Record<string, unknown>
): PortalIntakeEvent {
  const event: PortalIntakeEvent = {
    id: ++eventSequence,
    workspaceId,
    type,
    message,
    ...(payload ? { payload } : {}),
    createdAt: new Date().toISOString(),
  };

  const existing = eventsByWorkspace.get(workspaceId) || [];
  const nextEvents = [...existing, event];
  if (nextEvents.length > MAX_EVENTS_PER_WORKSPACE) {
    eventsByWorkspace.set(workspaceId, nextEvents.slice(nextEvents.length - MAX_EVENTS_PER_WORKSPACE));
  } else {
    eventsByWorkspace.set(workspaceId, nextEvents);
  }

  for (const listener of getListeners(workspaceId)) {
    listener(event);
  }

  return event;
}

export function listPortalIntakeEvents(
  workspaceId: string,
  options?: {
    afterId?: number;
    limit?: number;
  }
): PortalIntakeEvent[] {
  const afterId = typeof options?.afterId === 'number' ? options.afterId : 0;
  const limit = Math.max(1, Math.min(500, Number(options?.limit || 200)));
  const events = eventsByWorkspace.get(workspaceId) || [];
  const filtered = events.filter((event) => event.id > afterId);
  return filtered.slice(Math.max(0, filtered.length - limit));
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
