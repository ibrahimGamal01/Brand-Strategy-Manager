import assert from 'node:assert/strict';
import { formatUserContextsForLLM } from '../services/ai/chat/context/format-user-context';
import { buildDeterministicEvidenceBlocks, mergeDeterministicBlocks } from '../services/ai/chat/evidence-blocks';
import type { ToolExecutionResult } from '../services/ai/chat/chat-tool-runtime';
import type { ChatBlock } from '../services/chat/chat-types';

const formattedMemory = formatUserContextsForLLM([
  {
    category: 'fact',
    key: 'primary_audience',
    value: 'Founders and growth leads in DTC wellness brands.',
    label: 'Audience',
    createdAt: new Date('2026-02-20T10:00:00Z').toISOString(),
    lastMentionedAt: new Date('2026-02-22T09:00:00Z').toISOString(),
  },
  {
    category: 'website',
    key: 'homepage',
    value: 'https://example.com',
    createdAt: new Date('2026-02-21T10:00:00Z').toISOString(),
  },
]);

assert.match(formattedMemory, /Persistent Workspace Memory/i);
assert.match(formattedMemory, /Founders and growth leads/i);
assert.match(formattedMemory, /https:\/\/example\.com/i);

const toolResults: ToolExecutionResult[] = [
  {
    name: 'evidence.posts',
    args: { sort: 'engagement' },
    result: {
      items: [
        {
          postId: 'post-1',
          handle: 'eluumis',
          platform: 'instagram',
          captionSnippet: 'Post about competitor gap',
          postedAt: '2026-02-23T08:00:00.000Z',
          metrics: { engagementScore: 432 },
          permalink: 'https://instagram.com/p/abc',
          internalLink: 'https://app/research/job?module=intelligence',
        },
      ],
    },
  },
  {
    name: 'evidence.news',
    args: {},
    result: {
      items: [
        {
          title: 'Industry shift',
          source: 'The Journal',
          snippet: 'A relevant article',
          url: 'https://news.example.com/story',
        },
      ],
    },
  },
];

const deterministicBlocks = buildDeterministicEvidenceBlocks(toolResults);
const evidenceBlock = deterministicBlocks.find((block) => block.type === 'evidence_list');
const sourceBlock = deterministicBlocks.find((block) => block.type === 'source_list');

assert.ok(evidenceBlock, 'Expected evidence_list block from tool results.');
assert.ok(sourceBlock, 'Expected source_list block from tool results.');
assert.ok(Array.isArray((evidenceBlock as any).items), 'Evidence block should contain items.');
assert.ok(
  ((evidenceBlock as any).items as Array<Record<string, unknown>>).some((item) => item.url || item.internalLink),
  'At least one evidence item should include a URL or internal link.',
);

const mergedBlocks = mergeDeterministicBlocks(
  [
    {
      type: 'evidence_list',
      blockId: 'model-evidence',
      items: [{ title: 'Old model evidence' }],
    } as ChatBlock,
    {
      type: 'guided_question_card',
      blockId: 'model-guided',
      question: 'Next step?',
      options: [{ id: 'a', label: 'A' }],
    } as ChatBlock,
  ],
  deterministicBlocks,
);

assert.ok(mergedBlocks.some((block) => block.blockId === 'evidence-list-deterministic'));
assert.ok(!mergedBlocks.some((block) => block.blockId === 'model-evidence'), 'Model evidence block should be replaced.');
assert.ok(mergedBlocks.some((block) => block.blockId === 'model-guided'), 'Non-evidence model blocks should remain.');

const noEvidenceBlocks = buildDeterministicEvidenceBlocks([
  {
    name: 'evidence.posts',
    args: {},
    result: { items: [], reason: 'No posts in the requested timeframe.' },
  },
]);

assert.ok(noEvidenceBlocks.some((block) => block.type === 'insight'), 'No-evidence path should include insight block.');
assert.ok(noEvidenceBlocks.some((block) => block.type === 'source_list'), 'No-evidence path should still include source_list.');

console.log('chat-context-and-evidence tests passed');
