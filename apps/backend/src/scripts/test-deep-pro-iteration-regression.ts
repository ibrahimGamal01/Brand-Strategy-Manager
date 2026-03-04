import assert from 'node:assert/strict';
import { __testOnlyRuntimeLoop, normalizePolicy } from '../services/chat/runtime/run-engine';
import type { RuntimeToolCall } from '../services/chat/runtime/types';

function buildSeedCalls(): RuntimeToolCall[] {
  return [
    {
      tool: 'search.web',
      args: {
        query: 'eluumis swot competitor positioning',
        count: 10,
      },
    },
  ];
}

function runDefaultPolicyAssertions() {
  const normalized = normalizePolicy();
  assert.equal(normalized.responseMode, 'deep', 'Default response mode must be deep.');
  assert.equal(normalized.targetLength, 'long', 'Default target length must be long.');
}

function runDiversityAssertions() {
  const deepPolicy = normalizePolicy({
    responseMode: 'deep',
    sourceScope: {
      workspaceData: true,
      libraryPinned: true,
      uploadedDocs: true,
      webSearch: true,
      liveWebsiteCrawl: true,
      socialIntel: true,
    },
  });

  const deepResult = __testOnlyRuntimeLoop.enforceToolFamilyDiversity({
    toolCalls: buildSeedCalls(),
    policy: deepPolicy,
    userMessage: 'SWOT please for ELUUMIS. Website: https://eluumis.com',
    maxToolRuns: deepPolicy.maxToolRuns,
    runtimeContextSnapshot: {
      websites: ['https://eluumis.com'],
    },
  });

  assert.ok(
    deepResult.familiesUsed.length >= 3,
    `Deep mode should use >=3 tool families, got ${deepResult.familiesUsed.length}`
  );

  const proPolicy = normalizePolicy({
    responseMode: 'pro',
    sourceScope: {
      workspaceData: true,
      libraryPinned: true,
      uploadedDocs: true,
      webSearch: true,
      liveWebsiteCrawl: true,
      socialIntel: true,
    },
  });

  const proResult = __testOnlyRuntimeLoop.enforceToolFamilyDiversity({
    toolCalls: buildSeedCalls(),
    policy: proPolicy,
    userMessage: 'Build a deep market analysis for https://eluumis.com',
    maxToolRuns: proPolicy.maxToolRuns,
    runtimeContextSnapshot: {
      websites: ['https://eluumis.com'],
    },
  });

  assert.ok(
    proResult.familiesUsed.length >= 4,
    `Pro mode should use >=4 tool families, got ${proResult.familiesUsed.length}`
  );

  const preservedDocumentGenerate = __testOnlyRuntimeLoop.enforceToolFamilyDiversity({
    toolCalls: [
      {
        tool: 'document.generate',
        args: { docType: 'SWOT', depth: 'deep' },
      },
      ...buildSeedCalls(),
    ],
    policy: deepPolicy,
    userMessage: 'SWOT please for ELUUMIS. Website: https://eluumis.com',
    maxToolRuns: 3,
    runtimeContextSnapshot: {
      websites: ['https://eluumis.com'],
    },
  });
  assert.ok(
    preservedDocumentGenerate.toolCalls.some((call) => call.tool === 'document.generate'),
    'document.generate call should not be dropped by family-balancing cap trimming.'
  );
}

function runAntiStallAssertions() {
  const stalled = __testOnlyRuntimeLoop.countConsecutiveLowDeltaLoops([1, 0, -1, 0], [2, 0, 0, 0]);
  assert.equal(stalled, 3, `Expected 3 consecutive low-delta loops, got ${stalled}`);

  const alternate = __testOnlyRuntimeLoop.chooseAlternateFamiliesForStall({
    availableFamilies: ['web_search', 'workspace_intel', 'competitor_discovery', 'social_signals', 'news_signals'],
    currentFamilies: ['web_search', 'workspace_intel'],
    familyHistory: ['web_search', 'web_search', 'workspace_intel', 'news_signals'],
    preferredFamilies: ['social_signals', 'competitor_discovery'],
  });

  assert.ok(alternate.length > 0, 'Expected at least one alternate family for stalled loops.');
  assert.ok(
    alternate[0] === 'social_signals' || alternate.includes('social_signals'),
    `Expected social_signals to be prioritized; got ${alternate.join(', ')}`
  );
}

function runLaneAndVariantAssertions() {
  const preferredFamilies = __testOnlyRuntimeLoop.preferredFamiliesFromLanePriority([
    'competitors',
    'web',
    'news',
    'social',
  ]);
  assert.ok(preferredFamilies.includes('competitor_discovery'));
  assert.ok(preferredFamilies.includes('web_search'));
  assert.ok(preferredFamilies.includes('news_signals'));
  assert.ok(preferredFamilies.includes('social_signals'));

  const queryVariant2 = __testOnlyRuntimeLoop.pickQueryVariantForLoop(['v1', 'v2', 'v3'], 2);
  const queryVariant5 = __testOnlyRuntimeLoop.pickQueryVariantForLoop(['v1', 'v2', 'v3'], 5);
  assert.equal(queryVariant2, 'v2');
  assert.equal(queryVariant5, 'v2');

  const lane2 = __testOnlyRuntimeLoop.pickLaneForLoop(['web', 'competitors', 'news'], 2);
  const lane4 = __testOnlyRuntimeLoop.pickLaneForLoop(['web', 'competitors', 'news'], 4);
  assert.equal(lane2, 'competitors');
  assert.equal(lane4, 'web');
}

function main() {
  runDefaultPolicyAssertions();
  runDiversityAssertions();
  runAntiStallAssertions();
  runLaneAndVariantAssertions();

  console.log('[Deep/Pro Iteration Regression] Passed.');
}

main();
