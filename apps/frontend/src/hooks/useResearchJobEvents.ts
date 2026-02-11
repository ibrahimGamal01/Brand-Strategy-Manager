'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ResearchJobEvent } from '@/lib/api-client';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

const MAX_EVENTS = 1500;
const POLL_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 3000;

function normalizeEvent(raw: unknown): ResearchJobEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ResearchJobEvent>;
  if (typeof candidate.id !== 'number') return null;
  if (typeof candidate.researchJobId !== 'string') return null;
  if (typeof candidate.code !== 'string') return null;
  if (typeof candidate.message !== 'string') return null;
  if (typeof candidate.createdAt !== 'string') return null;

  return {
    id: candidate.id,
    researchJobId: candidate.researchJobId,
    runId: candidate.runId ?? null,
    source: candidate.source || 'system',
    code: candidate.code,
    level: candidate.level || 'info',
    message: candidate.message,
    platform: candidate.platform ?? null,
    handle: candidate.handle ?? null,
    entityType: candidate.entityType ?? null,
    entityId: candidate.entityId ?? null,
    metrics: (candidate.metrics as Record<string, unknown>) || null,
    metadata: (candidate.metadata as Record<string, unknown>) || null,
    createdAt: candidate.createdAt,
  };
}

export function useResearchJobEvents(jobId?: string) {
  const [events, setEvents] = useState<ResearchJobEvent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isSseHealthy, setIsSseHealthy] = useState(false);

  const streamRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const lastEventIdRef = useRef<number>(0);

  const appendEvents = useCallback((incoming: ResearchJobEvent[]) => {
    if (!incoming.length) return;

    let maxId = lastEventIdRef.current;
    for (const event of incoming) {
      maxId = Math.max(maxId, event.id);
    }
    lastEventIdRef.current = maxId;

    setEvents((previous) => {
      const merged = new Map<number, ResearchJobEvent>();
      for (const event of previous) merged.set(event.id, event);
      for (const event of incoming) merged.set(event.id, event);
      const sorted = Array.from(merged.values()).sort((a, b) => a.id - b.id);
      return sorted.length > MAX_EVENTS ? sorted.slice(sorted.length - MAX_EVENTS) : sorted;
    });
  }, []);

  const clearPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
  }, []);

  const fetchIncrementalEvents = useCallback(async () => {
    if (!jobId) return;

    try {
      const payload = await apiClient.getResearchJobEvents(
        jobId,
        lastEventIdRef.current > 0 ? lastEventIdRef.current : undefined,
        250
      );
      appendEvents((payload.events || []).map((event) => normalizeEvent(event)).filter(Boolean) as ResearchJobEvent[]);
    } catch (error) {
      console.warn('[useResearchJobEvents] Failed polling events:', error);
    }
  }, [appendEvents, jobId]);

  const connectStream = useCallback(() => {
    if (!jobId) return;

    closeStream();
    clearReconnect();
    setConnectionState('connecting');

    const stream = apiClient.streamResearchJobEvents(
      jobId,
      lastEventIdRef.current > 0 ? lastEventIdRef.current : undefined
    );
    streamRef.current = stream;

    stream.onopen = () => {
      setConnectionState('connected');
      setIsSseHealthy(true);
    };

    stream.addEventListener('research-job-event', (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data);
        const normalized = normalizeEvent(parsed);
        if (!normalized) return;
        appendEvents([normalized]);
        setConnectionState('connected');
        setIsSseHealthy(true);
      } catch (error) {
        console.warn('[useResearchJobEvents] Failed parsing SSE payload:', error);
      }
    });

    stream.onerror = () => {
      setConnectionState('disconnected');
      setIsSseHealthy(false);
      closeStream();

      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectStream();
        }, RECONNECT_DELAY_MS);
      }
    };
  }, [appendEvents, clearReconnect, closeStream, jobId]);

  useEffect(() => {
    if (!jobId) return;

    setEvents([]);
    setConnectionState('connecting');
    setIsSseHealthy(false);
    lastEventIdRef.current = 0;

    void fetchIncrementalEvents();
    connectStream();

    return () => {
      clearPolling();
      clearReconnect();
      closeStream();
    };
  }, [clearPolling, clearReconnect, closeStream, connectStream, fetchIncrementalEvents, jobId]);

  useEffect(() => {
    if (!jobId) return;

    if (connectionState === 'connected') {
      clearPolling();
      return;
    }

    void fetchIncrementalEvents();
    pollTimerRef.current = window.setInterval(() => {
      void fetchIncrementalEvents();
    }, POLL_INTERVAL_MS);

    return () => {
      clearPolling();
    };
  }, [clearPolling, connectionState, fetchIncrementalEvents, jobId]);

  return {
    events,
    connectionState,
    isSseHealthy,
  };
}
