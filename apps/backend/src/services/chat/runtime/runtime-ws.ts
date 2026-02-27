import type http from 'http';
import type { RawData } from 'ws';
import { WebSocket, WebSocketServer } from 'ws';
import { getBranch, listProcessEvents } from './repository';
import { serializeRuntimeProcessEvent } from './event-contract';
import { subscribeProcessEvents } from './process-event-bus';
import {
  getPortalSessionFromToken,
  PORTAL_SESSION_COOKIE_NAME,
  touchPortalSession,
} from '../../portal/portal-auth';

type SchemaReadyProvider = () => boolean;

const RUNTIME_WS_PATH_REGEX = /^\/api\/ws\/research-jobs\/([^/]+)\/runtime\/branches\/([^/]+)$/;

function parseCookieValue(header: string | undefined, key: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const [rawName, ...rest] = part.split('=');
    const name = String(rawName || '').trim();
    if (!name || name !== key) continue;
    const value = rest.join('=').trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function safeSend(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

export function attachRuntimeWebSocketServer(server: http.Server, isSchemaReady: SchemaReadyProvider) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(RUNTIME_WS_PATH_REGEX);
    if (!match) return;

    if (!isSchemaReady()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', 'http://localhost');
    const match = url.pathname.match(RUNTIME_WS_PATH_REGEX);
    const researchJobId = String(match?.[1] || '').trim();
    const branchId = String(match?.[2] || '').trim();
    const afterId = String(url.searchParams.get('afterId') || '').trim() || undefined;
    const afterSeq = String(url.searchParams.get('afterSeq') || '').trim() || undefined;

    if (!researchJobId || !branchId) {
      safeSend(socket, { type: 'ERROR', error: 'INVALID_PATH', details: 'Missing workspace or branch id.' });
      socket.close();
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const closeWithError = (error: string, details?: string) => {
      safeSend(socket, { type: 'ERROR', error, ...(details ? { details } : {}) });
      socket.close();
    };

    const initialize = async () => {
      try {
        const token = parseCookieValue(req.headers.cookie, PORTAL_SESSION_COOKIE_NAME);
        if (!token) {
          closeWithError('AUTH_REQUIRED');
          return;
        }

        const session = await getPortalSessionFromToken(token);
        if (!session) {
          closeWithError('AUTH_REQUIRED');
          return;
        }

        const hasAccess =
          session.user.isAdmin ||
          session.user.memberships.some((membership: { researchJobId: string }) => membership.researchJobId === researchJobId);
        if (!hasAccess) {
          closeWithError('FORBIDDEN_WORKSPACE');
          return;
        }

        const branch = await getBranch(branchId, researchJobId);
        if (!branch) {
          closeWithError('BRANCH_NOT_FOUND');
          return;
        }

        void touchPortalSession(session.id).catch(() => {
          // Best-effort session touch for websocket connections.
        });

        const backlog = await listProcessEvents(branchId, {
          afterId,
          afterSeq,
          limit: 160,
        });

        safeSend(socket, {
          type: 'AUTH_OK',
          workspaceId: researchJobId,
          branchId,
          hasBacklog: backlog.length > 0,
        });

        if (backlog.length > 0) {
          safeSend(socket, {
            type: 'EVENT_BATCH',
            workspaceId: researchJobId,
            branchId,
            events: backlog.map((event) => serializeRuntimeProcessEvent(event)),
          });
        }

        unsubscribe = subscribeProcessEvents(branchId, (event) => {
          safeSend(socket, {
            type: 'EVENT',
            workspaceId: researchJobId,
            branchId,
            event: serializeRuntimeProcessEvent(event),
          });
        });
      } catch (error: any) {
        closeWithError('WS_INIT_FAILED', String(error?.message || error));
      }
    };

    void initialize();

    socket.on('message', (raw: RawData) => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        payload = null;
      }
      const type = String(payload?.type || '').trim().toUpperCase();
      if (type === 'PING') {
        safeSend(socket, { type: 'PONG', ts: new Date().toISOString() });
      }
    });

    socket.on('close', () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    });
  });

  return wss;
}
