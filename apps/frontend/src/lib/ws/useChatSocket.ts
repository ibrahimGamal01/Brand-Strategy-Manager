import { useCallback, useEffect, useRef, useState } from 'react';

type ChatSocketStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type ChatSocketEvent = {
  type: string;
  [key: string]: any;
};

interface UseChatSocketOptions {
  researchJobId: string;
  sessionId: string | null;
  onEvent: (event: ChatSocketEvent) => void;
}

function buildWsUrl(researchJobId: string): string {
  const rawOrigin =
    process.env.NEXT_PUBLIC_API_ORIGIN ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const origin = rawOrigin.replace(/\/+$/, '').replace(/\/api$/, '');
  const wsOrigin = origin.replace(/^http/i, 'ws');
  return `${wsOrigin}/api/ws/research-jobs/${researchJobId}/chat`;
}

export function useChatSocket({ researchJobId, sessionId, onEvent }: UseChatSocketOptions) {
  const [status, setStatus] = useState<ChatSocketStatus>('idle');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(false);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const sendRaw = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }, []);

  const connect = useCallback(() => {
    if (!researchJobId) return;
    if (socketRef.current) {
      socketRef.current.close();
    }
    const url = buildWsUrl(researchJobId);
    const socket = new WebSocket(url);
    socketRef.current = socket;
    setStatus('connecting');

    socket.onopen = () => {
      retryCountRef.current = 0;
      setStatus('open');
      // Only send the explicitly requested sessionId; avoid auto-switching to latest.
      sendRaw({ type: 'AUTH', researchJobId, sessionId: sessionId || undefined });
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onEventRef.current(data);
      } catch {
        // ignore malformed payloads
      }
    };

    socket.onerror = () => {
      setStatus('error');
    };

    socket.onclose = () => {
      setStatus('closed');
      if (!mountedRef.current) return;
      const retryCount = retryCountRef.current + 1;
      retryCountRef.current = retryCount;
      const delay = Math.min(5000, 500 + retryCount * 500);
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      reconnectRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };
  }, [researchJobId, sessionId, sendRaw]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  const sendUserMessage = useCallback(
    (content: string, clientMessageId?: string, attachments?: string[]) => {
      sendRaw({
        type: 'USER_MESSAGE',
        sessionId,
        content,
        clientMessageId,
        attachments,
      });
    },
    [sendRaw, sessionId]
  );

  const sendBlockEvent = useCallback(
    (payload: { messageId: string; blockId: string; eventType: string; payload?: Record<string, unknown> }) => {
      sendRaw({
        type: 'BLOCK_EVENT',
        sessionId,
        ...payload,
      });
    },
    [sendRaw, sessionId]
  );

  const sendDesignSelection = useCallback(
    (payload: { messageId: string; designId: string }) => {
      sendRaw({
        type: 'SELECT_DESIGN',
        sessionId,
        ...payload,
      });
    },
    [sendRaw, sessionId]
  );

  return {
    status,
    sendUserMessage,
    sendBlockEvent,
    sendDesignSelection,
  };
}
