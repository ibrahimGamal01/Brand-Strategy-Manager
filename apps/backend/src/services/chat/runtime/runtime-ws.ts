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
import { verifyRuntimeWsToken } from './runtime-ws-auth';

type SchemaReadyProvider = () => boolean;

const RUNTIME_WS_PATH_REGEX = /^\/api\/ws\/research-jobs\/([^/]+)\/runtime\/branches\/([^/]+)$/;
const DEFAULT_RUNTIME_WS_DB_POLL_MS = 1_000;

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

function resolveRuntimeWsPollMs(): number {
  const parsed = Number(process.env.RUNTIME_WS_DB_POLL_MS || DEFAULT_RUNTIME_WS_DB_POLL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_RUNTIME_WS_DB_POLL_MS;
  return Math.max(250, Math.floor(parsed));
}

function toEventSeqCursor(value: unknown): string | undefined {
  if (typeof value === 'bigint') return value.toString();
  const raw = String(value || '').trim();
  return /^\d+$/.test(raw) ? raw : undefined;
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
    const wsToken = String(url.searchParams.get('wsToken') || '').trim() || undefined;

    if (!researchJobId || !branchId) {
      safeSend(socket, { type: 'ERROR', error: 'INVALID_PATH', details: 'Missing workspace or branch id.' });
      socket.close();
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let lastEventSeq = toEventSeqCursor(afterSeq);

    const closeWithError = (error: string, details?: string) => {
      safeSend(socket, { type: 'ERROR', error, ...(details ? { details } : {}) });
      socket.close();
    };

    const deliverEvents = (events: Awaited<ReturnType<typeof listProcessEvents>>) => {
      const nextEvents = events.filter((event) => {
        const cursor = toEventSeqCursor(event.eventSeq);
        if (!cursor) return true;
        if (!lastEventSeq) return true;
        return BigInt(cursor) > BigInt(lastEventSeq);
      });

      if (nextEvents.length === 0) return;

      lastEventSeq = toEventSeqCursor(nextEvents[nextEvents.length - 1]?.eventSeq) || lastEventSeq;
      safeSend(socket, {
        type: nextEvents.length === 1 ? 'EVENT' : 'EVENT_BATCH',
        workspaceId: researchJobId,
        branchId,
        ...(nextEvents.length === 1
          ? { event: serializeRuntimeProcessEvent(nextEvents[0]) }
          : { events: nextEvents.map((event) => serializeRuntimeProcessEvent(event)) }),
      });
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
          session.user.memberships.some(
            (membership: { researchJobId: string }) => membership.researchJobId === researchJobId
          );
        if (!hasAccess) {
          closeWithError('FORBIDDEN_WORKSPACE');
          return;
        }

        if (wsToken) {
          const verified = verifyRuntimeWsToken({
            token: wsToken,
            researchJobId,
            branchId,
          });
          if (!verified.ok) {
            closeWithError('INVALID_WS_TOKEN', verified.reason);
            return;
          }
        }

        const branch = await getBranch(branchId, researchJobId);
        if (!branch) {
          closeWithError('BRANCH_NOT_FOUND');
          return;
        }

        if (session?.id) {
          void touchPortalSession(session.id).catch(() => {
            // Best-effort session touch for websocket connections.
          });
        }

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
          lastEventSeq = toEventSeqCursor(backlog[backlog.length - 1]?.eventSeq) || lastEventSeq;
          safeSend(socket, {
            type: 'EVENT_BATCH',
            workspaceId: researchJobId,
            branchId,
            events: backlog.map((event) => serializeRuntimeProcessEvent(event)),
          });
        }

        unsubscribe = subscribeProcessEvents(branchId, (event) => {
          deliverEvents([event]);
        });

        const pollMs = resolveRuntimeWsPollMs();
        pollTimer = setInterval(() => {
          void listProcessEvents(branchId, {
            afterSeq: lastEventSeq,
            limit: 100,
          })
            .then((events) => {
              deliverEvents(events);
            })
            .catch((error: any) => {
              console.warn('[Runtime WS] Poll failed:', error?.message || error);
            });
        }, pollMs);
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
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    });
  });

  return wss;
}
