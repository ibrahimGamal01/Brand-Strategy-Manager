import type http from 'http';
import type { RawData } from 'ws';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  listChatMessages,
  createChatMessage,
  updateChatMessage,
  touchChatSession,
  findLatestDesignSelections,
} from './chat-repository';
import { attachScreenshotsToMessage } from './chat-attachments';
import { handleChatBlockEvent } from './chat-events';
import { streamChatCompletion } from '../ai/chat/chat-generator';
import type { ChatBlock, ChatDesignOption } from './chat-types';
import { extractUserContext } from './user-context-extractor';
import { upsertUserContext } from './user-context-repository';

type ChatSocketState = {
  researchJobId: string;
  sessionId: string | null;
  isGenerating: boolean;
};

type SchemaReadyProvider = () => boolean;

const PATH_REGEX = /^\/api\/ws\/research-jobs\/([^/]+)\/chat$/;

function safeSend(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

async function sendHistory(socket: WebSocket, sessionId: string) {
  const messages = await listChatMessages(sessionId, 300);
  const messageIds = messages.map((message) => message.id);
  const designSelections = await findLatestDesignSelections(sessionId, messageIds);
  safeSend(socket, {
    type: 'HISTORY',
    sessionId,
    messages: messages.map((message) => ({
      ...message,
      selectedDesignId: designSelections.get(message.id) || null,
    })),
  });
}

export function attachChatWebSocketServer(server: http.Server, isSchemaReady: SchemaReadyProvider) {
  const wss = new WebSocketServer({ noServer: true });
  const stateMap = new Map<WebSocket, ChatSocketState>();

  server.on('upgrade', (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(PATH_REGEX);
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
    const match = url.pathname.match(PATH_REGEX);
    const researchJobId = match?.[1];
    if (!researchJobId) {
      safeSend(socket, { type: 'ERROR', error: 'INVALID_PATH', details: 'Missing research job id' });
      socket.close();
      return;
    }

    const state: ChatSocketState = { researchJobId, sessionId: null, isGenerating: false };
    stateMap.set(socket, state);

    socket.on('message', async (raw: RawData) => {
      let payload: any;
      try {
        payload = JSON.parse(raw.toString());
      } catch (error) {
        safeSend(socket, { type: 'ERROR', error: 'INVALID_JSON' });
        return;
      }

      const type = String(payload?.type || '').toUpperCase();
      try {
        if (type === 'AUTH') {
          const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
          const jobId = typeof payload?.researchJobId === 'string' ? payload.researchJobId : researchJobId;
          if (jobId !== researchJobId) {
            safeSend(socket, { type: 'ERROR', error: 'JOB_MISMATCH' });
            return;
          }

          let session = sessionId ? await getChatSession(researchJobId, sessionId) : null;
          // Do NOT auto-create or swap sessions if client provided an ID; only create when none provided.
          if (!session && !sessionId) {
            const existing = await listChatSessions(researchJobId, 1);
            session = existing[0] || null;
          }
          if (!session) {
            session = await createChatSession(researchJobId);
          }
          state.sessionId = session.id;
          safeSend(socket, { type: 'AUTH_OK', sessionId: session.id });
          await sendHistory(socket, session.id);
          return;
        }

        if (type === 'USER_MESSAGE') {
          if (!state.sessionId) {
            safeSend(socket, { type: 'ERROR', error: 'UNAUTHORIZED', details: 'AUTH required first' });
            return;
          }
          if (state.isGenerating) {
            safeSend(socket, { type: 'ERROR', error: 'CHAT_BUSY', details: 'Wait for current response to finish' });
            return;
          }
          const content = String(payload?.content || '').trim();
          const attachments: string[] = Array.isArray(payload?.attachments) ? payload.attachments : [];
          if (!content && attachments.length === 0) {
            safeSend(socket, { type: 'ERROR', error: 'EMPTY_MESSAGE' });
            return;
          }
          const clientMessageId = typeof payload?.clientMessageId === 'string' ? payload.clientMessageId : null;

          const userMessage = await createChatMessage(state.sessionId, 'USER', content);
          if (attachments.length) {
            await attachScreenshotsToMessage(userMessage.id, attachments);
          }

          // Auto-extract and persist any user-supplied context (websites, handles, notes)
          const uscItems = extractUserContext(content);
          if (uscItems.length > 0) {
            await Promise.all(
              uscItems.map((item) =>
                upsertUserContext(researchJobId, item.category, item.key, item.value, item.label, content).catch(() => {}),
              ),
            );
            safeSend(socket, {
              type: 'CONTEXT_SAVED',
              items: uscItems.map((i) => ({ category: i.category, label: i.label, value: i.value })),
            });
          }

          const assistantMessage = await createChatMessage(state.sessionId, 'ASSISTANT', '');

          safeSend(socket, {
            type: 'ASSISTANT_START',
            messageId: assistantMessage.id,
            clientMessageId,
          });

          state.isGenerating = true;
          let fullContent = '';
          let cachedBlocks: ChatBlock[] = [];
          let cachedDesigns: ChatDesignOption[] = [];
          let lastFlushAt = Date.now();
          let lastFlushLength = 0;

          const flushContent = () => {
            const now = Date.now();
            const lengthDelta = fullContent.length - lastFlushLength;
            if (lengthDelta >= 400 || now - lastFlushAt > 1000) {
              lastFlushAt = now;
              lastFlushLength = fullContent.length;
              void updateChatMessage(assistantMessage.id, { content: fullContent });
            }
          };

          try {
            const result = await streamChatCompletion({
              researchJobId,
              sessionId: state.sessionId,
              userMessage: content,
              callbacks: {
                onDelta: (delta) => {
                  fullContent += delta;
                  safeSend(socket, { type: 'ASSISTANT_DELTA', messageId: assistantMessage.id, delta });
                  flushContent();
                },
                onBlocks: (blocks, designOptions) => {
                  cachedBlocks = blocks;
                  cachedDesigns = designOptions;
                  safeSend(socket, {
                    type: 'ASSISTANT_BLOCKS',
                    messageId: assistantMessage.id,
                    blocks,
                    designOptions,
                  });
                },
              },
            });

            fullContent = result.content;
            cachedBlocks = result.blocks;
            cachedDesigns = result.designOptions;

            await updateChatMessage(assistantMessage.id, {
              content: fullContent,
              blocks: cachedBlocks,
              designOptions: cachedDesigns,
            });
            await touchChatSession(state.sessionId);
            safeSend(socket, { type: 'ASSISTANT_DONE', messageId: assistantMessage.id });
          } catch (error: any) {
            console.error('[Chat WS] Failed to generate response:', error);
            safeSend(socket, { type: 'ERROR', error: 'GENERATION_FAILED', details: error.message });
          } finally {
            state.isGenerating = false;
          }

          return;
        }

        if (type === 'BLOCK_EVENT') {
          if (!state.sessionId) {
            safeSend(socket, { type: 'ERROR', error: 'UNAUTHORIZED', details: 'AUTH required first' });
            return;
          }
          const { messageId, blockId, eventType, payload: eventPayload } = payload || {};
          if (!messageId || !blockId || !eventType) {
            safeSend(socket, { type: 'ERROR', error: 'INVALID_EVENT' });
            return;
          }
          await handleChatBlockEvent({
            sessionId: state.sessionId,
            messageId,
            blockId,
            eventType: String(eventType).toUpperCase() as any,
            payload: eventPayload ?? null,
          });
          await touchChatSession(state.sessionId);
          return;
        }

        if (type === 'SELECT_DESIGN') {
          if (!state.sessionId) {
            safeSend(socket, { type: 'ERROR', error: 'UNAUTHORIZED', details: 'AUTH required first' });
            return;
          }
          const { messageId, designId } = payload || {};
          if (!messageId || !designId) {
            safeSend(socket, { type: 'ERROR', error: 'INVALID_EVENT' });
            return;
          }
          await handleChatBlockEvent({
            sessionId: state.sessionId,
            messageId,
            blockId: String(designId),
            eventType: 'SELECT_DESIGN',
            payload: { designId: String(designId) },
          });
          await touchChatSession(state.sessionId);
        }
      } catch (error: any) {
        console.error('[Chat WS] Socket error:', error);
        safeSend(socket, { type: 'ERROR', error: 'SERVER_ERROR', details: error.message });
      }
    });

    socket.on('close', () => {
      stateMap.delete(socket);
    });
  });

  return wss;
}
