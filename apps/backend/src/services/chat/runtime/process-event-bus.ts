import type { ProcessEvent } from '@prisma/client';

type ProcessEventListener = (event: ProcessEvent) => void;

const listenersByBranch = new Map<string, Set<ProcessEventListener>>();

export function subscribeProcessEvents(branchId: string, listener: ProcessEventListener): () => void {
  const listeners = listenersByBranch.get(branchId) ?? new Set<ProcessEventListener>();
  listeners.add(listener);
  listenersByBranch.set(branchId, listeners);

  return () => {
    const current = listenersByBranch.get(branchId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByBranch.delete(branchId);
    }
  };
}

export function publishProcessEvent(event: ProcessEvent) {
  const listeners = listenersByBranch.get(event.branchId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error: any) {
      console.warn('[Runtime ProcessEventBus] Listener failed:', error?.message || error);
    }
  }
}
