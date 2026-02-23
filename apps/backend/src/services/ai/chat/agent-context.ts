import type { ChatRagContext } from './chat-rag-context';

export type AgentContextUserItem = {
  category: string;
  key: string | null;
  value: string;
  label?: string | null;
  createdAt: string | Date;
  lastMentionedAt?: string | Date | null;
};

export type AgentContext = {
  researchJobId: string;
  sessionId: string;
  userMessage: string;
  chatRag: ChatRagContext;
  userContexts: AgentContextUserItem[];
  links: {
    appOrigin: string;
    jobBase: string;
    moduleLink: (module: string, params?: Record<string, string>) => string;
  };
  runtime: {
    nowIso: string;
    requestId: string;
  };
};

export function createAgentLinkHelpers(appOrigin: string, researchJobId: string): AgentContext['links'] {
  const normalizedOrigin = appOrigin.replace(/\/$/, '');
  const jobBase = `${normalizedOrigin}/research/${researchJobId}`;

  return {
    appOrigin: normalizedOrigin,
    jobBase,
    moduleLink: (module: string, params: Record<string, string> = {}) => {
      const search = new URLSearchParams({ module, ...params });
      return `${jobBase}?${search.toString()}`;
    },
  };
}
