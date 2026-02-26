import assert from 'node:assert/strict';
import {
  buildPlanFromMessage,
  collectContinuationTools,
  inferToolCallsFromMessage,
  normalizePolicy,
  stripLegacyBoilerplateResponse,
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

  const multilineCompetitorMessage = [
    'please add these (I have already told you before)',
    '',
    '**Competitors or inspiration accounts (3 links)**',
    'https://www.instagram.com/giuliadallacostaa',
    'https://www.instagram.com/quantum__manifestation',
  ].join('\n');
  const competitorCalls = inferToolCallsFromMessage(multilineCompetitorMessage);
  const competitorToolNames = competitorCalls.map((entry) => entry.tool);
  assert.ok(
    competitorToolNames.includes('competitors.add_links'),
    'Expected multiline competitor add request to trigger competitors.add_links.'
  );

  const intakeUpdateMessage = [
    'Can you please update the original form content',
    '**What services do you offer? (list)**',
    '- Offer one',
    '- Offer two',
  ].join('\n');
  const intakeCalls = inferToolCallsFromMessage(intakeUpdateMessage);
  const intakeToolNames = intakeCalls.map((entry) => entry.tool);
  assert.ok(
    intakeToolNames.includes('intake.update_from_text'),
    'Expected intake form update request to trigger intake.update_from_text.'
  );

  const deepResearchMessage =
    'Use DDG and Scraply to deeply investigate these instagram accounts and people for competitor details.';
  const deepResearchCalls = inferToolCallsFromMessage(deepResearchMessage);
  const deepResearchToolNames = deepResearchCalls.map((entry) => entry.tool);
  assert.ok(
    deepResearchToolNames.includes('research.gather'),
    'Expected deep DDG/Scraply investigation request to trigger research.gather.'
  );

  const crawlRunReferenceCalls = inferToolCallsFromMessage('Use evidence from: Crawl run crawl-e8');
  const crawlRunListCall = crawlRunReferenceCalls.find((entry) => entry.tool === 'web.crawl.list_snapshots');
  assert.ok(crawlRunListCall, 'Expected crawl run evidence reference to trigger web.crawl.list_snapshots.');
  assert.equal(
    String((crawlRunListCall?.args as Record<string, unknown>)?.runId || ''),
    'crawl-e8',
    'Expected crawl run evidence reference to preserve crawl run id in filter args.'
  );

  const urlEvidenceCalls = inferToolCallsFromMessage('Use evidence from: consciouslifeexpo.com/refund-policy/');
  assert.ok(
    urlEvidenceCalls.some((entry) => entry.tool === 'web.fetch'),
    'Expected URL evidence reference to trigger web.fetch.'
  );

  const workspaceOverviewCalls = inferToolCallsFromMessage('what do you see on the application that we have here?');
  assert.ok(
    workspaceOverviewCalls.some(
      (entry) => entry.tool === 'intel.list' && String((entry.args as Record<string, unknown>).section || '') === 'web_snapshots'
    ),
    'Expected workspace overview phrasing to trigger intel.list for web_snapshots.'
  );
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

function testLegacyBoilerplateStripping() {
  const raw = [
    'Fork from here',
    'Here is the actual answer.',
    '',
    'No tools executed in this run.',
    '',
    'Next actions',
    '',
    'Do A',
    'How BAT got here',
    'Plan',
    '- Step',
  ].join('\n');
  const cleaned = stripLegacyBoilerplateResponse(raw);
  assert.equal(cleaned, 'Here is the actual answer.', 'Expected legacy scaffold text to be stripped from response.');
}

function main() {
  testPlannerHeuristics();
  testContinuationCollection();
  testPolicyNormalization();
  testLegacyBoilerplateStripping();
  console.log('[Runtime Engine] Heuristic + continuation tests passed.');
}

main();
