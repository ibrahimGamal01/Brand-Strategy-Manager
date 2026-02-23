import assert from 'node:assert/strict';
import type { ChatRagContext } from '../services/ai/chat/chat-rag-context';
import { createAgentLinkHelpers, type AgentContext } from '../services/ai/chat/agent-context';
import { TOOL_REGISTRY, getTool } from '../services/ai/chat/tools/tool-registry';

const rag = {} as ChatRagContext;
const links = createAgentLinkHelpers('https://brand-strategy-manager-frontend.vercel.app', 'job-123');

const context: AgentContext = {
  researchJobId: 'job-123',
  sessionId: 'session-1',
  userMessage: 'test',
  chatRag: rag,
  userContexts: [],
  links,
  runtime: {
    nowIso: new Date().toISOString(),
    requestId: 'req-1',
  },
};

assert.equal(context.links.appOrigin, 'https://brand-strategy-manager-frontend.vercel.app');
assert.equal(context.links.jobBase, 'https://brand-strategy-manager-frontend.vercel.app/research/job-123');
assert.equal(context.links.moduleLink('intelligence', { intelSection: 'competitors' }), 'https://brand-strategy-manager-frontend.vercel.app/research/job-123?module=intelligence&intelSection=competitors');
assert.ok(Array.isArray(TOOL_REGISTRY));
assert.ok(getTool('evidence.posts'));

console.log('Chat tool foundations compile test passed.');
