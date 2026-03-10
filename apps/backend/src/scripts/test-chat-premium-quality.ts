import assert from 'node:assert/strict';
import { applyWriterQualityGate, resolveWriterTaskForInput } from '../services/chat/runtime/prompt-suite';
import type { RuntimePlan, RuntimeToolResult, RunPolicy } from '../services/chat/runtime/types';

function sampleToolResult(): RuntimeToolResult {
  return {
    ok: true,
    summary: 'Reviewed web snapshots, competitors, and post evidence for the current workspace.',
    artifacts: [],
    evidence: [
      { kind: 'web', label: 'Programs page', url: 'https://example.com/programs' },
      { kind: 'post', label: 'Top Instagram post', url: 'https://instagram.com/p/example' },
      { kind: 'competitor', label: '@brand_competitor', url: 'https://instagram.com/brand_competitor' },
    ],
    continuations: [],
    decisions: [],
    warnings: ['Community evidence is thinner than web/post evidence.'],
    raw: {
      toolName: 'document.generate',
      runtimeEvidenceRefIds: ['ref:web:1', 'ref:post:1', 'ref:competitor:1'],
    },
  };
}

function samplePlan(): RuntimePlan {
  return {
    goal: 'Produce a grounded client-facing strategy response',
    plan: ['Review evidence', 'Synthesize implications', 'Recommend next actions'],
    toolCalls: [{ tool: 'document.generate', args: { docType: 'BUSINESS_STRATEGY' } }],
    needUserInput: false,
    decisionRequests: [],
    responseStyle: {
      depth: 'deep',
      tone: 'friendly',
    },
    runtime: {
      continuationDepth: 0,
    },
  };
}

function samplePolicy(): RunPolicy {
  return {
    autoContinue: true,
    maxAutoContinuations: 2,
    maxToolRuns: 6,
    toolConcurrency: 3,
    allowMutationTools: false,
    maxToolMs: 45_000,
    responseMode: 'deep',
    targetLength: 'long',
    strictValidation: false,
    sourceScope: {
      workspaceData: true,
      libraryPinned: true,
      uploadedDocs: true,
      webSearch: true,
      liveWebsiteCrawl: true,
      socialIntel: true,
    },
    pauseAfterPlanning: false,
  };
}

function runQualityGatePreservesSubstantiveResponse(): void {
  const original = [
    '## What I searched',
    '1. Reviewed the client website, top social posts, and direct competitors.',
    '',
    '## What I found',
    '1. The strongest demand signal is practical, low-friction transformation language.',
    '2. Competitors win attention by pairing proof with a very clear before/after promise.',
    '',
    '## Synthesis',
    'The market is not asking for more inspiration alone; it is rewarding clarity, proof, and fast applicability.',
    'That means the brand should tighten its promise around one measurable outcome and stop diluting it across multiple narratives.',
    '',
    '## Scenarios and tradeoffs',
    '### Scenario A',
    '- Launch now with the current promise and learn faster, but accept that conversion quality may stay uneven.',
    '### Scenario B',
    '- Run one more evidence loop and sharpen the promise first, which delays launch slightly but reduces messaging drift.',
    '',
    '## Recommendations',
    '1. Reframe the hero promise around one concrete customer outcome.',
    '2. Build the next two content assets around proof and objection handling.',
    '',
    '## Next loop / next actions',
    '1. Validate the refined promise against conversion behavior next week.',
  ].join('\n');

  const result = applyWriterQualityGate({
    userMessage: 'Create a deep strategic answer and then generate the document.',
    response: original,
    toolResults: [sampleToolResult()],
    runtimeContext: { clientName: 'ELUUMIS' },
    responseMode: 'deep',
    enforceDeepSections: true,
  });

  assert.equal(result.response, original, 'Substantive deep response should be preserved instead of flattened into boilerplate.');
  assert.ok(
    result.quality.notes?.some((note) => /preserved for editorial repair/i.test(note)),
    'Quality gate should explain that it preserved the response for editorial repair.',
  );
}

function runWriterTaskRoutingAssertions(): void {
  const task = resolveWriterTaskForInput({
    userMessage: 'Generate a PDF strategy brief with deep analysis.',
    plan: samplePlan(),
    policy: samplePolicy(),
  });
  assert.equal(task, 'analysis_quality', 'Deep document-adjacent requests should route to a quality-tier writer task.');

  const normalTask = resolveWriterTaskForInput({
    userMessage: 'Summarize this quickly.',
    plan: {
      ...samplePlan(),
      toolCalls: [{ tool: 'search.web', args: { query: 'brand' } }],
    },
    policy: {
      ...samplePolicy(),
      responseMode: 'balanced',
    },
  });
  assert.equal(normalTask, 'workspace_chat_writer', 'Non-document balanced requests should keep the normal writer task.');
}

function main(): void {
  runQualityGatePreservesSubstantiveResponse();
  runWriterTaskRoutingAssertions();
  console.log('[Chat Premium Quality] Passed.');
}

main();
