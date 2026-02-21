export type ChatRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export type ChatBlock = {
  type: string;
  blockId: string;
  title?: string;
  [key: string]: any;
};

export type ChatDesignOption = {
  designId: string;
  label: string;
  blocks: ChatBlock[];
};

export type ChatAttachment = {
  id: string;
  storagePath: string;
  mimeType: string;
  aiSummary?: string | null;
  recordType?: string | null;
  recordId?: string | null;
};

export type ChatMessageRecord = {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  blocks?: ChatBlock[] | null;
  designOptions?: ChatDesignOption[] | null;
  attachments?: ChatAttachment[] | null;
  createdAt: Date;
};

export type ChatBlockEventType = 'VIEW' | 'PIN' | 'UNPIN' | 'SELECT_DESIGN' | 'FORM_SUBMIT' | 'ATTACH_VIEW';
