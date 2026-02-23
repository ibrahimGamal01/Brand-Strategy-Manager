import { Router } from 'express';
import { prisma } from '../lib/prisma';
import {
  listChatSessions,
  createChatSession,
  getChatSession,
  listChatMessages,
  createChatMessage,
  updateChatMessage,
  touchChatSession,
  findLatestDesignSelections,
  listSavedBlocks,
} from '../services/chat/chat-repository';
import { attachScreenshotsToMessage } from '../services/chat/chat-attachments';
import { handleChatBlockEvent } from '../services/chat/chat-events';
import { streamChatCompletion } from '../services/ai/chat/chat-generator';
import {
  listUserContexts,
  deactivateUserContext,
  upsertUserContext,
  UscCategory,
} from '../services/chat/user-context-repository';


const router = Router();
const ALLOWED_USER_CONTEXT_CATEGORIES: UscCategory[] = [
  'website',
  'social_profile',
  'fact',
  'correction',
  'document_url',
  'free_text',
];

router.get('/:id/chat/sessions', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const sessions = await listChatSessions(researchJobId, 30);
    return res.json({
      sessions: sessions.map((session) => ({
        ...session,
        lastMessage: session.messages?.[0] || null,
      })),
    });
  } catch (error: any) {
    console.error('[Chat] Failed to list sessions:', error);
    return res.status(500).json({ error: 'Failed to list chat sessions', details: error.message });
  }
});

router.post('/:id/chat/sessions', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const job = await prisma.researchJob.findUnique({ where: { id: researchJobId }, select: { id: true } });
    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const session = await createChatSession(researchJobId, title);
    return res.json({ session });
  } catch (error: any) {
    console.error('[Chat] Failed to create session:', error);
    return res.status(500).json({ error: 'Failed to create chat session', details: error.message });
  }
});

router.get('/:id/chat/sessions/:sessionId', async (req, res) => {
  try {
    const { id: researchJobId, sessionId } = req.params;
    const session = await getChatSession(researchJobId, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    const messages = await listChatMessages(session.id, 300);
    const messageIds = messages.map((message) => message.id);
    const designSelections = await findLatestDesignSelections(session.id, messageIds);
    return res.json({
      session,
      messages: messages.map((message) => ({
        ...message,
        selectedDesignId: designSelections.get(message.id) || null,
      })),
    });
  } catch (error: any) {
    console.error('[Chat] Failed to fetch session:', error);
    return res.status(500).json({ error: 'Failed to fetch chat session', details: error.message });
  }
});

router.post('/:id/chat/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { id: researchJobId, sessionId } = req.params;
    const content = String(req.body?.content || '').trim();
    const attachments = Array.isArray(req.body?.attachments)
      ? (req.body.attachments as string[])
      : [];
    if (!content && attachments.length === 0) {
      return res.status(400).json({ error: 'content is required' });
    }
    const session = await getChatSession(researchJobId, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const userMessage = await createChatMessage(session.id, 'USER', content);
    if (attachments.length) {
      await attachScreenshotsToMessage(userMessage.id, attachments);
    }
    const assistantMessage = await createChatMessage(session.id, 'ASSISTANT', '');

    const result = await streamChatCompletion({
      researchJobId,
      sessionId: session.id,
      userMessage: content,
    });

    await updateChatMessage(assistantMessage.id, {
      content: result.content,
      blocks: result.blocks,
      designOptions: result.designOptions,
    });

    await touchChatSession(session.id);

    return res.json({
      sessionId: session.id,
      userMessage,
      assistantMessage: {
        ...assistantMessage,
        content: result.content,
        blocks: result.blocks,
        designOptions: result.designOptions,
      },
    });
  } catch (error: any) {
    console.error('[Chat] Failed to post message:', error);
    return res.status(500).json({ error: 'Failed to post chat message', details: error.message });
  }
});

router.post('/:id/chat/sessions/:sessionId/system-message', async (req, res) => {
  try {
    const { id: researchJobId, sessionId } = req.params;
    const content = String(req.body?.content || '').trim();
    const attachments = Array.isArray(req.body?.attachments)
      ? (req.body.attachments as string[]).filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
      : [];
    const roleRaw = String(req.body?.role || 'SYSTEM').trim().toUpperCase();
    const role = roleRaw === 'ASSISTANT' ? 'ASSISTANT' : 'SYSTEM';
    const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : undefined;
    const designOptions = Array.isArray(req.body?.designOptions) ? req.body.designOptions : undefined;

    if (!content && attachments.length === 0) {
      return res.status(400).json({ error: 'content is required' });
    }

    const session = await getChatSession(researchJobId, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const message = await createChatMessage(session.id, role, content, {
      blocks: blocks ?? null,
      designOptions: designOptions ?? null,
    });
    if (attachments.length) {
      await attachScreenshotsToMessage(message.id, attachments);
    }
    await touchChatSession(session.id);

    return res.json({ ok: true, message });
  } catch (error: any) {
    console.error('[Chat] Failed to post system message:', error);
    return res.status(500).json({ error: 'Failed to post system message', details: error.message });
  }
});

router.post('/:id/chat/sessions/:sessionId/events', async (req, res) => {
  try {
    const { id: researchJobId, sessionId } = req.params;
    const { messageId, blockId, eventType, payload } = req.body || {};
    if (!messageId || !blockId || !eventType) {
      return res.status(400).json({ error: 'messageId, blockId, and eventType are required' });
    }
    const session = await getChatSession(researchJobId, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const normalizedType = String(eventType).toUpperCase();
    const allowed = new Set(['VIEW', 'PIN', 'UNPIN', 'SELECT_DESIGN', 'FORM_SUBMIT', 'ATTACH_VIEW']);
    if (!allowed.has(normalizedType)) {
      return res.status(400).json({ error: 'Invalid eventType' });
    }

    const event = await handleChatBlockEvent({
      sessionId: session.id,
      messageId,
      blockId,
      eventType: normalizedType as any,
      payload: payload ?? null,
    });

    await touchChatSession(session.id);

    return res.json({ event });
  } catch (error: any) {
    console.error('[Chat] Failed to record event:', error);
    return res.status(500).json({ error: 'Failed to record event', details: error.message });
  }
});

router.get('/:id/chat/sessions/:sessionId/saved-blocks', async (req, res) => {
  try {
    const { id: researchJobId, sessionId } = req.params;
    const session = await getChatSession(researchJobId, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    const blocks = await listSavedBlocks(session.id);
    return res.json({ blocks });
  } catch (error: any) {
    console.error('[Chat] Failed to list saved blocks:', error);
    return res.status(500).json({ error: 'Failed to list saved blocks', details: error.message });
  }
});

// ---- User-Supplied Context endpoints ----

router.get('/:id/chat/user-context', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const items = await listUserContexts(researchJobId);
    return res.json({ items });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to list user contexts', details: error.message });
  }
});

router.post('/:id/chat/user-context', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const categoryRaw = String(req.body?.category || '').trim().toLowerCase();
    const value = String(req.body?.value || '').trim();
    const keyRaw = req.body?.key;
    const labelRaw = req.body?.label;
    const sourceMessageRaw = req.body?.sourceMessage;

    if (!categoryRaw || !ALLOWED_USER_CONTEXT_CATEGORIES.includes(categoryRaw as UscCategory)) {
      return res.status(400).json({
        error: 'Invalid category',
        details: `category must be one of: ${ALLOWED_USER_CONTEXT_CATEGORIES.join(', ')}`,
      });
    }
    if (!value) {
      return res.status(400).json({ error: 'value is required' });
    }

    const item = await upsertUserContext(
      researchJobId,
      categoryRaw as UscCategory,
      typeof keyRaw === 'string' ? keyRaw : null,
      value,
      typeof labelRaw === 'string' ? labelRaw : null,
      typeof sourceMessageRaw === 'string' ? sourceMessageRaw : null
    );
    return res.json({ ok: true, item });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to upsert user context', details: error.message });
  }
});

router.delete('/:id/chat/user-context/:contextId', async (req, res) => {
  try {
    const { contextId } = req.params;
    await deactivateUserContext(contextId);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to remove user context', details: error.message });
  }
});

export default router;
