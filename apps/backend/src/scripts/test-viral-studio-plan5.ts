import assert from 'node:assert/strict';
import {
  applyReferenceShortlistAction,
  createGenerationPack,
  createIngestionRun,
  getIngestionRun,
  IngestionStatus,
  listReferenceAssets,
  refineGenerationPack,
} from '../services/portal/viral-studio';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminal(status: IngestionStatus): boolean {
  return status === 'completed' || status === 'partial' || status === 'failed';
}

async function waitForIngestionTerminal(workspaceId: string, runId: string, timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = getIngestionRun(workspaceId, runId);
    assert.ok(run, 'Ingestion run should exist');
    if (isTerminal(run.status)) return run;
    await sleep(140);
  }
  throw new Error(`Timed out waiting for ingestion terminal state (run=${runId})`);
}

async function run(): Promise<void> {
  const workspaceId = `viral-studio-plan5-${Date.now()}`;

  const run = createIngestionRun(workspaceId, {
    sourcePlatform: 'instagram',
    sourceUrl: 'https://instagram.com/plan5.reference',
    preset: 'quick-scan',
  });
  const finalized = await waitForIngestionTerminal(workspaceId, run.id);
  assert.ok(finalized.progress.ranked >= 0, 'Ingestion should report ranked count.');

  const references = listReferenceAssets(workspaceId, { ingestionRunId: run.id, includeExcluded: true });
  assert.ok(references.length > 0, 'Plan 5 test requires generated references.');
  const pinned = applyReferenceShortlistAction(workspaceId, references[0].id, 'must-use');
  assert.ok(pinned, 'Must-use shortlist action should succeed.');

  const generation = createGenerationPack(workspaceId, {
    templateId: 'full-script',
    prompt: 'Create a campaign-ready pack optimized for conversion.',
    selectedReferenceIds: references.slice(0, 3).map((item) => item.id),
    formatTarget: 'shorts',
  });
  assert.equal(generation.formatTarget, 'shorts');
  assert.equal(generation.promptContext.template.id, 'full-script');
  assert.ok(generation.promptContext.composedPrompt.includes('Format target'), 'Composed prompt should include format context.');
  assert.ok(generation.promptContext.referenceNotes.length > 0, 'Prompt context should include reference notes.');
  assert.ok(generation.outputs.hooks.length >= 5, 'Generation should output a full hook pack.');
  assert.ok(generation.outputs.captions.length >= 3, 'Generation should output caption variants.');
  assert.ok(generation.outputs.ctas.length >= 3, 'Generation should output CTA variants.');

  const refined = refineGenerationPack(workspaceId, generation.id, {
    section: 'captions',
    instruction: 'Make opening lines more urgent but still credible.',
    mode: 'refine',
  });
  assert.ok(refined, 'Refine should return an updated generation.');
  assert.equal(refined?.revision, 2, 'Refine should increment revision.');
  assert.notEqual(refined?.outputs.captions[0], generation.outputs.captions[0], 'Caption refinement should update section output.');

  const regenerated = refineGenerationPack(workspaceId, generation.id, {
    section: 'scripts.medium',
    instruction: 'Regenerate around one proof-centric narrative arc.',
    mode: 'regenerate',
  });
  assert.ok(regenerated, 'Regenerate should return an updated generation.');
  assert.equal(regenerated?.revision, 3, 'Regenerate should increment revision again.');
  assert.notEqual(
    regenerated?.outputs.scripts.medium,
    refined?.outputs.scripts.medium,
    'Regeneration should replace medium script output.'
  );

  assert.ok(typeof regenerated?.qualityCheck.passed === 'boolean', 'Quality report should be generated.');
  console.log('viral-studio Plan 5 tests passed');
}

run().catch((error) => {
  console.error('viral-studio Plan 5 tests failed');
  console.error(error);
  process.exit(1);
});
