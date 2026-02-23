import { useCallback, useEffect, useRef, useState } from 'react';

type ChatSocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export type ChatSocketEvent = Record<string, unknown> & { type: string };

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
  const reconnectAttemptRef = useRef(0);
  const connectionIdRef = useRef(0);
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

  const connect = useCallback(function connectSocket() {
    if (!researchJobId || !mountedRef.current) return;
    if (reconnectRef.current) {
      window.clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    if (socketRef.current) {
      // Clear stale handlers before closing so session switches do not trigger reconnect loops.
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
    const url = buildWsUrl(researchJobId);
    const socket = new WebSocket(url);
    socketRef.current = socket;
    setStatus(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting');

    socket.onopen = () => {
      if (connectionIdRef.current !== connectionId || socketRef.current !== socket) return;
      reconnectAttemptRef.current = 0;
      setStatus('open');
      // Only send the explicitly requested sessionId; avoid auto-switching to latest.
      socket.send(JSON.stringify({ type: 'AUTH', researchJobId, sessionId: sessionId || undefined }));
    };

    socket.onmessage = (event) => {
      if (connectionIdRef.current !== connectionId || socketRef.current !== socket) return;
      try {
        const data = JSON.parse(event.data);
        onEventRef.current(data);
      } catch {
        // ignore malformed payloads
      }
    };

    socket.onerror = () => {
      if (connectionIdRef.current !== connectionId || socketRef.current !== socket) return;
      setStatus('error');
    };

    socket.onclose = () => {
      if (connectionIdRef.current !== connectionId || socketRef.current !== socket) return;
      socketRef.current = null;
      if (!mountedRef.current) {
        setStatus('closed');
        return;
      }
      const retryCount = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = retryCount;
      const delay = Math.min(5000, 500 + retryCount * 500);
      setStatus('reconnecting');
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }
      reconnectRef.current = window.setTimeout(() => {
        connectSocket();
      }, delay);
    };
  }, [researchJobId, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onerror = null;
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
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
