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

const competitorListCalls = inferHeuristicToolCalls({
  userMessage: 'List my competitors and show inactive ones too.',
});
const intelList = competitorListCalls.find((entry) => entry.name === 'intel.list');
assert.ok(intelList, 'Expected intel.list call for competitor listing requests');
assert.equal(intelList?.args.section, 'competitors');
assert.equal(intelList?.args.includeInactive, true);

const recordCall = inferHeuristicToolCalls({
  userMessage: 'Get competitor row 58b36b53-0039-4d3a-9520-d5483035e81d',
});
assert.ok(recordCall.some((entry) => entry.name === 'intel.get'), 'Expected intel.get call for record id lookups');

const workspaceOverviewCalls = inferHeuristicToolCalls({
  userMessage: 'What do you see on the application that we have here?',
});
const workspaceIntelList = workspaceOverviewCalls.find((entry) => entry.name === 'intel.list');
assert.ok(workspaceIntelList, 'Expected intel.list call for workspace overview requests');
assert.equal(workspaceIntelList?.args.section, 'web_snapshots');

console.log('chat-tool-hints tests passed');
