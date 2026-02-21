import { prisma } from '../../lib/prisma';
import type { ChatBlock } from './chat-types';
import { recordChatBlockEvent } from './chat-repository';

function findBlockById(blocks: unknown, blockId: string): ChatBlock | null {
  if (!Array.isArray(blocks)) return null;
  const found = blocks.find((block) => typeof block === 'object' && block && (block as any).blockId === blockId);
  return (found as ChatBlock) || null;
}

function findBlockInMessage(
  message: { blocks?: unknown | null; designOptions?: unknown | null },
  blockId: string
): ChatBlock | null {
  const direct = findBlockById(message.blocks, blockId);
  if (direct) return direct;
  if (!Array.isArray(message.designOptions)) return null;
  for (const option of message.designOptions) {
    const blocks = (option as any)?.blocks;
    const found = findBlockById(blocks, blockId);
    if (found) return found;
  }
  return null;
}

export async function handleChatBlockEvent(params: {
  sessionId: string;
  messageId: string;
  blockId: string;
  eventType: 'VIEW' | 'PIN' | 'UNPIN' | 'SELECT_DESIGN' | 'FORM_SUBMIT' | 'ATTACH_VIEW';
  payload?: Record<string, unknown> | null;
}) {
  const event = await recordChatBlockEvent(params);

  if (params.eventType === 'PIN') {
    const payloadBlock = (params.payload as any)?.blockData as ChatBlock | undefined;
    const message = await prisma.chatMessage.findUnique({
      where: { id: params.messageId },
      select: { blocks: true, designOptions: true },
    });
    const blockData = payloadBlock || (message ? findBlockInMessage(message, params.blockId) : null);
    if (blockData) {
      await prisma.chatSavedBlock.upsert({
        where: { sessionId_blockId: { sessionId: params.sessionId, blockId: params.blockId } },
        create: {
          sessionId: params.sessionId,
          blockId: params.blockId,
          messageId: params.messageId,
          blockData: blockData as any,
        },
        update: {
          messageId: params.messageId,
          blockData: blockData as any,
        },
      });
    }
  }

  if (params.eventType === 'UNPIN') {
    await prisma.chatSavedBlock.deleteMany({
      where: { sessionId: params.sessionId, blockId: params.blockId },
    });
  }

  return event;
}
