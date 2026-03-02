import assert from 'node:assert/strict';
import {
  buildPlanFromMessage,
  collectContinuationTools,
  inferToolCallsFromMessage,
  normalizePolicy,
  stripLegacyBoilerplateResponse,
} from '../services/chat/runtime/run-engine';
import { executeToolWithContract } from '../services/chat/runtime/tool-contract';
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

  const v3DiscoveryCalls = inferToolCallsFromMessage(
    'Run a wide V3 competitor finder workflow using adjacent and substitute competitors.'
  );
  assert.ok(
    v3DiscoveryCalls.some((entry) => entry.tool === 'competitors.discover_v3'),
    'Expected V3 competitor finder phrasing to trigger competitors.discover_v3.'
  );

  const explicitSearchCalls = inferToolCallsFromMessage('Search the web for best biophoton energy programs.');
  assert.ok(
    explicitSearchCalls.some((entry) => entry.tool === 'search.web'),
    'Expected explicit web search phrasing to trigger search.web.'
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

  const originalFormCalls = inferToolCallsFromMessage('what was my original form response');
  assert.ok(
    originalFormCalls.some((entry) => entry.tool === 'workspace.intake.get'),
    'Expected original form response request to trigger workspace.intake.get.'
  );

  const slashShowSourcesCalls = inferToolCallsFromMessage('/show_sources');
  assert.ok(
    slashShowSourcesCalls.some(
      (entry) => entry.tool === 'intel.list' && String((entry.args as Record<string, unknown>).section || '') === 'web_snapshots'
    ),
    'Expected /show_sources to trigger intel.list for web_snapshots.'
  );
  assert.ok(
    slashShowSourcesCalls.some((entry) => entry.tool === 'evidence.news'),
    'Expected /show_sources to trigger evidence.news.'
  );

  const slashGeneratePdfCalls = inferToolCallsFromMessage('/generate_pdf');
  assert.ok(
    slashGeneratePdfCalls.some((entry) => entry.tool === 'document.generate'),
    'Expected /generate_pdf to trigger document.generate.'
  );
  assert.ok(
    !slashGeneratePdfCalls.some((entry) => entry.tool === 'document.plan'),
    'Expected /generate_pdf not to schedule document.plan.'
  );

  const slashV3Calls = inferToolCallsFromMessage('/competitors.discover_v3 {"mode":"wide"}');
  assert.ok(
    slashV3Calls.some((entry) => entry.tool === 'competitors.discover_v3'),
    'Expected explicit /competitors.discover_v3 command to trigger V3 competitor discovery.'
  );

  const mentionCrawlRunCalls = inferToolCallsFromMessage('Please use @library[item-1|Crawl run crawl-e8] in this answer.');
  assert.ok(
    mentionCrawlRunCalls.some((entry) => entry.tool === 'web.crawl.list_snapshots'),
    'Expected @library mention with crawl run title to trigger web.crawl.list_snapshots.'
  );

  const mentionUrlCalls = inferToolCallsFromMessage('Ground this using @library[item-2|consciouslifeexpo.com/refund-policy/]');
  assert.ok(
    mentionUrlCalls.some((entry) => entry.tool === 'web.fetch'),
    'Expected @library mention with URL title to trigger web.fetch.'
  );

  const quotedDocumentEditCalls = inferToolCallsFromMessage(
    'Please replace "Increase SQL pipeline" with "Increase qualified patient bookings" in [document:doc-11aa22bb33] and keep tone concise.'
  );
  const quotedEditCall = quotedDocumentEditCalls.find((entry) => entry.tool === 'document.propose_edit');
  assert.ok(quotedEditCall, 'Expected quoted document edit request to trigger document.propose_edit.');
  assert.equal(
    String((quotedEditCall?.args as Record<string, unknown>)?.quotedText || ''),
    'Increase SQL pipeline',
    'Quoted edit should map source quote into document.propose_edit args.'
  );
  assert.equal(
    String((quotedEditCall?.args as Record<string, unknown>)?.replacementText || ''),
    'Increase qualified patient bookings',
    'Quoted edit should map replacement quote into document.propose_edit args.'
  );

  const quoteLocateCalls = inferToolCallsFromMessage(
    'Edit [document:doc-11aa22bb33] around this quote: "Pricing assumptions may be stale."'
  );
  assert.ok(
    quoteLocateCalls.some((entry) => entry.tool === 'document.search'),
    'Expected quote-only document edit phrasing to trigger document.search for anchor lookup.'
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
          suggestedToolCalls: [
            { tool: 'web.crawl.list_snapshots', args: { runId: 'crawl-e8', limit: 20 } },
          ],
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
  assert.deepEqual(continuationTools, [
    'intel.list',
    'evidence.news',
    'evidence.posts',
    'web.crawl.list_snapshots',
  ]);
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

  const modePolicy = normalizePolicy(
    {
      responseMode: 'balanced',
      targetLength: 'medium',
      strictValidation: false,
      sourceScope: {
        workspaceData: true,
        libraryPinned: true,
        uploadedDocs: true,
        webSearch: true,
        liveWebsiteCrawl: true,
        socialIntel: true,
      },
    },
    {
      modeLabel: 'pro',
      sourceScope: {
        webSearch: false,
        socialIntel: false,
      },
    }
  );
  assert.equal(modePolicy.responseMode, 'pro', 'Input options should override response mode.');
  assert.equal(modePolicy.targetLength, 'long', 'Pro mode should default to long target length.');
  assert.equal(modePolicy.strictValidation, true, 'Pro mode should enforce strict validation.');
  assert.equal(modePolicy.sourceScope.webSearch, false, 'Input options should override source scope for webSearch.');
  assert.equal(modePolicy.sourceScope.socialIntel, false, 'Input options should override source scope for socialIntel.');
}

async function testSourceScopeBlockingInToolContract() {
  const webSearchBlockedPolicy = normalizePolicy({
    sourceScope: {
      workspaceData: true,
      libraryPinned: true,
      uploadedDocs: true,
      webSearch: false,
      liveWebsiteCrawl: true,
      socialIntel: true,
    },
  });
  const webSearchBlocked = await executeToolWithContract({
    researchJobId: 'runtime-test-job',
    syntheticSessionId: 'runtime-runtime-test-branch',
    userMessage: 'Search this on web',
    toolName: 'search.web',
    args: { query: 'eluumis competitors' },
    policy: webSearchBlockedPolicy,
  });
  assert.equal(webSearchBlocked.ok, false, 'Blocked source-scope call should return ok=false.');
  assert.match(
    webSearchBlocked.summary,
    /blocked by selected source scope/i,
    'Blocked tool summary should explain source scope restriction.'
  );
  assert.ok(
    webSearchBlocked.warnings.some((warning) => /web_search is disabled/i.test(warning)),
    'Expected warning to mention web_search restriction.'
  );
  assert.equal(
    webSearchBlocked.continuations?.[0]?.suggestedToolCalls?.[0]?.tool,
    'intel.list',
    'Blocked tool should propose intel.list fallback continuation.'
  );

  const socialBlockedPolicy = normalizePolicy({
    sourceScope: {
      workspaceData: true,
      libraryPinned: true,
      uploadedDocs: true,
      webSearch: true,
      liveWebsiteCrawl: true,
      socialIntel: false,
    },
  });
  const socialBlocked = await executeToolWithContract({
    researchJobId: 'runtime-test-job',
    syntheticSessionId: 'runtime-runtime-test-branch',
    userMessage: 'Fetch social evidence',
    toolName: 'evidence.posts',
    args: { limit: 5 },
    policy: socialBlockedPolicy,
  });
  assert.equal(socialBlocked.ok, false, 'Social blocked call should return ok=false.');
  assert.ok(
    socialBlocked.warnings.some((warning) => /social_intel is disabled/i.test(warning)),
    'Expected warning to mention social_intel restriction.'
  );
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

async function main() {
  testPlannerHeuristics();
  testContinuationCollection();
  testPolicyNormalization();
  testLegacyBoilerplateStripping();
  await testSourceScopeBlockingInToolContract();
  console.log('[Runtime Engine] Heuristic + continuation tests passed.');
}

main().catch((error) => {
  console.error('[Runtime Engine] Heuristic + continuation tests failed.', error);
  process.exit(1);
});
