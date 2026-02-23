import assert from 'node:assert/strict';
import { inferHeuristicToolCalls } from '../services/ai/chat/tool-hints';

const postCalls = inferHeuristicToolCalls({
  userMessage: 'What was my best post last week? Please link it.',
});
const evidencePosts = postCalls.find((entry) => entry.name === 'evidence.posts');
assert.ok(evidencePosts, 'Expected evidence.posts call for best post question');
assert.equal(evidencePosts?.args.lastNDays, 7, 'Expected lastNDays=7 for last week queries');

const videoCalls = inferHeuristicToolCalls({
  userMessage: 'Show me 3 videos about competitor hooks on YouTube',
});
assert.ok(videoCalls.some((entry) => entry.name === 'evidence.videos'), 'Expected evidence.videos call');

const newsCalls = inferHeuristicToolCalls({
  userMessage: 'Any recent press news about our category?',
});
assert.ok(newsCalls.some((entry) => entry.name === 'evidence.news'), 'Expected evidence.news call');

const noCalls = inferHeuristicToolCalls({
  userMessage: 'Thanks',
});
assert.equal(noCalls.length, 0, 'Expected no heuristic tool calls for generic smalltalk');

console.log('chat-tool-hints tests passed');
