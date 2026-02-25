import assert from 'node:assert/strict';
import {
  buildPlanFromMessage,
  collectContinuationTools,
  inferToolCallsFromMessage,
  normalizePolicy,
} from '../services/chat/runtime/run-engine';
import type { RuntimeToolResult } from '../services/chat/runtime/types';

function testPlannerHeuristics() {
  const calls = inferToolCallsFromMessage('Run competitor and news analysis with social post examples.');
  const names = calls.map((entry) => entry.tool);

  assert.ok(names.includes('intel.list'), 'Expected intel.list tool call for competitor query.');
  assert.ok(names.includes('evidence.news'), 'Expected evidence.news tool call for news query.');
  assert.ok(names.includes('evidence.posts'), 'Expected evidence.posts tool call for social evidence query.');

  const plan = buildPlanFromMessage('Generate a short response with no tool usage hints.');
  assert.ok(Array.isArray(plan.plan), 'Plan steps should exist.');
}

function testContinuationCollection() {
  const results: RuntimeToolResult[] = [
    {
      ok: true,
      summary: 'First tool complete',
      artifacts: [],
      evidence: [],
      decisions: [],
      warnings: [],
      continuations: [
        {
          type: 'auto_continue',
          reason: 'Continue with evidence read',
          suggestedNextTools: ['intel.list', 'evidence.news'],
        },
      ],
    },
    {
      ok: true,
      summary: 'Second tool complete',
      artifacts: [],
      evidence: [],
      decisions: [],
      warnings: [],
      continuations: [
        {
          type: 'auto_continue',
          reason: 'Deduplicate names',
          suggestedNextTools: ['evidence.news', 'evidence.posts'],
        },
      ],
    },
  ];

  const continuationTools = collectContinuationTools(results);
  assert.deepEqual(continuationTools, ['intel.list', 'evidence.news', 'evidence.posts']);
}

function testPolicyNormalization() {
  const policy = normalizePolicy({
    maxAutoContinuations: 99,
    maxToolRuns: 0,
    toolConcurrency: 5,
    maxToolMs: 50,
  });

  assert.equal(policy.maxAutoContinuations, 4, 'Policy must clamp continuation max to 4.');
  assert.equal(policy.maxToolRuns, 1, 'Policy must clamp minimum tool runs to 1.');
  assert.equal(policy.toolConcurrency, 3, 'Policy must clamp tool concurrency to 3.');
  assert.equal(policy.maxToolMs, 1000, 'Policy must clamp tool timeout to minimum 1000ms.');
}

function main() {
  testPlannerHeuristics();
  testContinuationCollection();
  testPolicyNormalization();
  console.log('[Runtime Engine] Heuristic + continuation tests passed.');
}

main();
