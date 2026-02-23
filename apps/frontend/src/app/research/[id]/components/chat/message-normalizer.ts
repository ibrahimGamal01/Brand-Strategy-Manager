import type { ChatBlock, ChatDesignOption } from './blocks/types';
import type { ChatAttachment, ChatMessage } from './types';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeRole(value: unknown): ChatMessage['role'] {
  const role = asString(value).toUpperCase();
  if (role === 'USER') return 'USER';
  if (role === 'SYSTEM') return 'SYSTEM';
  return 'ASSISTANT';
}

function normalizeDate(value: unknown): string {
  const input = asString(value);
  return input || new Date().toISOString();
}

export function sanitizeChatBlock(value: unknown, index = 0): ChatBlock {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const type = asString(raw.type, 'insight');
  const blockId = asString(raw.blockId, `block-${index + 1}-${type}`);
  return {
    ...raw,
    type,
    blockId,
  } as ChatBlock;
}

export function sanitizeChatBlocks(value: unknown): ChatBlock[] {
  return asArray<unknown>(value).map((block, index) => sanitizeChatBlock(block, index));
}

export function sanitizeChatDesignOptions(value: unknown): ChatDesignOption[] {
  return asArray<unknown>(value).map((entry, index) => {
    const raw = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const designId = asString(raw.designId, `design-${index + 1}`);
    const label = asString(raw.label, designId);
    return {
      designId,
      label,
      blocks: sanitizeChatBlocks(raw.blocks),
    };
  });
}

export function sanitizeChatAttachments(value: unknown): ChatAttachment[] {
  return asArray<unknown>(value).map((entry, index) => {
    const raw = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
      id: asString(raw.id, `attachment-${index + 1}`),
      storagePath: asString(raw.storagePath),
      mimeType: asString(raw.mimeType),
      aiSummary: typeof raw.aiSummary === 'string' ? raw.aiSummary : null,
      recordType: typeof raw.recordType === 'string' ? raw.recordType : null,
      recordId: typeof raw.recordId === 'string' ? raw.recordId : null,
      isAppScreenshot: Boolean(raw.isAppScreenshot),
    };
  });
}

export function sanitizeFollowUp(value: unknown): string[] {
  return asArray<unknown>(value)
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
}

export function sanitizeChatMessage(value: unknown, index = 0): ChatMessage {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const blocks = sanitizeChatBlocks(raw.blocks);
  const designOptions = sanitizeChatDesignOptions(raw.designOptions);
  const attachments = sanitizeChatAttachments(raw.attachments);
  const followUp = sanitizeFollowUp(raw.followUp);

  return {
    id: asString(raw.id, `message-${index + 1}`),
    role: normalizeRole(raw.role),
    content: asString(raw.content),
    blocks: blocks.length ? blocks : [],
    designOptions: designOptions.length ? designOptions : [],
    selectedDesignId: typeof raw.selectedDesignId === 'string' ? raw.selectedDesignId : null,
    attachments: attachments.length ? attachments : [],
    followUp: followUp.length ? followUp : [],
    createdAt: normalizeDate(raw.createdAt),
    pending: Boolean(raw.pending),
  };
}

export function sanitizeChatMessages(value: unknown): ChatMessage[] {
  return asArray<unknown>(value).map((entry, index) => sanitizeChatMessage(entry, index));
}
