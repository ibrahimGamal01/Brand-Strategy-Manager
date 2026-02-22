import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { ChatAttachment, ChatBlock, ChatDesignOption, ChatMessageRecord, ChatRole } from './chat-types';

export async function listChatSessions(researchJobId: string, limit = 30) {
  return prisma.chatSession.findMany({
    where: { researchJobId },
    orderBy: { lastActiveAt: 'desc' },
    take: limit,
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
}

export async function createChatSession(researchJobId: string, title?: string) {
  return prisma.chatSession.create({
    data: {
      researchJobId,
      title: title?.trim().slice(0, 140) || null,
    },
  });
}

export async function getChatSession(researchJobId: string, sessionId: string) {
  return prisma.chatSession.findFirst({
    where: { id: sessionId, researchJobId },
  });
}

export async function touchChatSession(sessionId: string) {
  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { lastActiveAt: new Date() },
  });
}

export async function listChatMessages(sessionId: string, limit = 200) {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  const ids = messages.map((m) => m.id);
  const attachments = ids.length
    ? await prisma.screenshotAttachment.findMany({ where: { chatMessageId: { in: ids } } })
    : [];
  const attachmentMap = attachments.reduce<Record<string, ChatAttachment[]>>((acc, att) => {
    acc[att.chatMessageId || ''] = acc[att.chatMessageId || ''] || [];
    acc[att.chatMessageId || ''].push({
      id: att.id,
      storagePath: att.storagePath,
      mimeType: att.mimeType,
      aiSummary: att.aiSummary,
      recordType: att.recordType,
      recordId: att.recordId,
      isAppScreenshot: att.isAppScreenshot,
    });
    return acc;
  }, {});
  return messages.map((m) => ({
    ...m,
    attachments: attachmentMap[m.id] || [],
  })) as ChatMessageRecord[];
}

export async function createChatMessage(
  sessionId: string,
  role: ChatRole,
  content: string,
  options?: { blocks?: ChatBlock[] | null; designOptions?: ChatDesignOption[] | null; attachments?: string[] }
) {
  return prisma.chatMessage.create({
    data: {
      sessionId,
      role,
      content,
      blocks: options?.blocks === undefined ? undefined : options.blocks ?? Prisma.JsonNull,
      designOptions: options?.designOptions === undefined ? undefined : options.designOptions ?? Prisma.JsonNull,
    },
  });
}

export async function updateChatMessage(
  messageId: string,
  data: Partial<Pick<ChatMessageRecord, 'content' | 'blocks' | 'designOptions'>>
) {
  return prisma.chatMessage.update({
    where: { id: messageId },
    data: {
      ...(data.content !== undefined ? { content: data.content } : {}),
      ...(data.blocks !== undefined
        ? { blocks: data.blocks ?? Prisma.JsonNull }
        : {}),
      ...(data.designOptions !== undefined
        ? { designOptions: data.designOptions ?? Prisma.JsonNull }
        : {}),
    },
  });
}

export async function listSavedBlocks(sessionId: string) {
  return prisma.chatSavedBlock.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function recordChatBlockEvent(params: {
  sessionId: string;
  messageId: string;
  blockId: string;
  eventType: 'VIEW' | 'PIN' | 'UNPIN' | 'SELECT_DESIGN' | 'FORM_SUBMIT' | 'ATTACH_VIEW';
  payload?: Record<string, unknown> | null;
}) {
  return prisma.chatBlockEvent.create({
    data: {
      sessionId: params.sessionId,
      messageId: params.messageId,
      blockId: params.blockId,
      eventType: params.eventType,
      payload: params.payload ? (params.payload as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

export async function findLatestDesignSelections(sessionId: string, messageIds?: string[]) {
  const selections = await prisma.chatBlockEvent.findMany({
    where: {
      sessionId,
      eventType: 'SELECT_DESIGN',
      ...(messageIds && messageIds.length > 0 ? { messageId: { in: messageIds } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const map = new Map<string, string>();
  for (const event of selections) {
    if (!map.has(event.messageId)) {
      const designId = typeof (event.payload as any)?.designId === 'string' ? (event.payload as any).designId : '';
      if (designId) map.set(event.messageId, designId);
    }
  }
  return map;
}
