import type { ChatBlock, ChatDesignOption } from './blocks/types';

export type ChatSession = {
  id: string;
  title?: string | null;
  createdAt: string;
  lastActiveAt: string;
};

export type ChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  blocks?: ChatBlock[] | null;
  designOptions?: ChatDesignOption[] | null;
  selectedDesignId?: string | null;
  attachments?: ChatAttachment[] | null;
  followUp?: string[] | null;
  createdAt: string;
  pending?: boolean;
};


export type ChatSavedBlock = {
  id: string;
  sessionId: string;
  blockId: string;
  messageId: string;
  blockData: ChatBlock;
  createdAt: string;
};

export type ChatAttachment = {
  id: string;
  storagePath: string;
  mimeType: string;
  aiSummary?: string | null;
  recordType?: string | null;
  recordId?: string | null;
  isAppScreenshot?: boolean;
};
