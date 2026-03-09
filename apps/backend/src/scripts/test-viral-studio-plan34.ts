import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  applyReferenceShortlistAction,
  createIngestionRun,
  getIngestionRun,
  getViralStudioContractSnapshot,
  IngestionRun,
  IngestionStatus,
  listIngestionRuns,
  listReferenceAssets,
  retryIngestionRun,
  ViralStudioPlatform,
} from '../services/portal/viral-studio';

function toShortHash(input: string): number {
  const digest = crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalStatus(status: IngestionStatus): boolean {
  return status === 'completed' || status === 'partial' || status === 'failed';
}

function pickSourceUrlForStatus(input: {
  target: 'failed' | 'partial' | 'completed';
  platform: ViralStudioPlatform;
  maxVideos: number;
  lookbackDays: number;
  attempt: number;
}): string {
  for (let index = 1; index <= 5000; index += 1) {
    const candidate = `https://example.com/${input.target}/creator-${index}`;
    const seed = toShortHash(
      `${input.platform}|${candidate}|${input.maxVideos}|${input.lookbackDays}|${input.attempt}`
    );
    const rollout = Math.min(99, (seed % 100) + Math.max(0, input.attempt - 1) * 14);
    const matchesFailed = input.target === 'failed' && rollout < 12;
    const matchesPartial = input.target === 'partial' && rollout >= 12 && rollout < 32;
    const matchesCompleted = input.target === 'completed' && rollout >= 32;
    if (matchesFailed || matchesPartial || matchesCompleted) {
      return candidate;
    }
  }
  throw new Error(`Failed to derive deterministic sourceUrl for status=${input.target}`);
}

async function waitForTerminalRun(
  workspaceId: string,
  runId: string,
  timeoutMs = 7000
): Promise<IngestionRun> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = getIngestionRun(workspaceId, runId);
    assert.ok(run, `Ingestion run ${runId} should exist`);
    if (isTerminalStatus(run.status)) {
      return run;
    }
    await sleep(140);
  }
  throw new Error(`Timed out waiting for terminal ingestion status (runId=${runId})`);
}

function assertReferencesLookHealthy(workspaceId: string, runId: string, expectedRanked: number): void {
  const references = listReferenceAssets(workspaceId, { ingestionRunId: runId, includeExcluded: true });
  assert.equal(
    references.length,
    expectedRanked,
    `Reference count should match ranked progress (expected=${expectedRanked}, got=${references.length})`
  );

  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const previous = references[index - 1];
    if (previous) {
      assert.ok(
        previous.scores.composite >= reference.scores.composite,
        'References should be sorted by descending composite score'
      );
    }
    assert.equal(reference.ranking.rank, index + 1, 'Reference rank should be dense and sequential');
    assert.equal(reference.explainability.formulaVersion, 'viral-score-v1');
    assert.ok(reference.explainability.topDrivers.length > 0, 'Explainability should include top drivers');
    assert.ok(reference.explainability.whyRankedHigh.length >= 2, 'Explainability should include rationale bullets');

    const contributionSum =
      reference.explainability.weightedContributions.engagementRate +
      reference.explainability.weightedContributions.recency +
      reference.explainability.weightedContributions.hookStrength +
      reference.explainability.weightedContributions.retentionProxy +
      reference.explainability.weightedContributions.captionClarity;
    assert.ok(
      Math.abs(contributionSum - reference.scores.composite) < 0.02,
      'Weighted contributions should reconcile with composite score'
    );

    const pctValues = [
      reference.normalizedMetrics.engagementRatePct,
      reference.normalizedMetrics.recencyPct,
      reference.normalizedMetrics.hookStrengthPct,
      reference.normalizedMetrics.retentionProxyPct,
      reference.normalizedMetrics.captionClarityPct,
    ];
    for (const value of pctValues) {
      assert.ok(value >= 0 && value <= 100, 'Normalized metric percentages should remain in [0, 100]');
    }
  }
}

async function run(): Promise<void> {
  const workspaceId = `viral-studio-plan34-${Date.now()}`;

  const contract = getViralStudioContractSnapshot();
  assert.equal(contract.version, 'plan1');
  assert.ok(contract.stateMachines.ingestion.states.includes('queued'));
  assert.ok(contract.stateMachines.ingestion.states.includes('running'));
  assert.ok(contract.stateMachines.ingestion.states.includes('partial'));
  assert.ok(contract.stateMachines.ingestion.states.includes('completed'));
  assert.ok(contract.stateMachines.ingestion.states.includes('failed'));

  const quickRun = createIngestionRun(workspaceId, {
    sourcePlatform: 'instagram',
    sourceUrl: 'https://instagram.com/brand-example',
    preset: 'quick-scan',
  });
  assert.equal(quickRun.preset, 'quick-scan');
  assert.equal(quickRun.maxVideos, 24);
  assert.equal(quickRun.lookbackDays, 90);
  assert.equal(quickRun.sortBy, 'engagement');
  assert.equal(quickRun.status, 'queued');

  const quickFinal = await waitForTerminalRun(workspaceId, quickRun.id);
  assert.ok(isTerminalStatus(quickFinal.status));
  assertReferencesLookHealthy(workspaceId, quickFinal.id, quickFinal.progress.ranked);

  const quickReferences = listReferenceAssets(workspaceId, { ingestionRunId: quickFinal.id, includeExcluded: true });
  if (quickReferences.length > 0) {
    const target = quickReferences[0];
    const shortlisted = applyReferenceShortlistAction(workspaceId, target.id, 'must-use');
    assert.ok(shortlisted, 'Shortlist action should update an existing reference');
    assert.equal(shortlisted?.shortlistState, 'must-use');
    const shortlistOnly = listReferenceAssets(workspaceId, {
      ingestionRunId: quickFinal.id,
      shortlistOnly: true,
      includeExcluded: true,
    });
    assert.ok(shortlistOnly.some((item) => item.id === target.id), 'Shortlist filter should include the updated reference');
  }

  const failedSourceUrl = pickSourceUrlForStatus({
    target: 'failed',
    platform: 'youtube',
    maxVideos: 50,
    lookbackDays: 180,
    attempt: 1,
  });
  const failedRun = createIngestionRun(workspaceId, {
    sourcePlatform: 'youtube',
    sourceUrl: failedSourceUrl,
    maxVideos: 50,
    lookbackDays: 180,
    sortBy: 'engagement',
    preset: 'balanced',
  });
  const failedFinal = await waitForTerminalRun(workspaceId, failedRun.id);
  assert.equal(failedFinal.status, 'failed');
  assertReferencesLookHealthy(workspaceId, failedFinal.id, failedFinal.progress.ranked);

  const retryRun = retryIngestionRun(workspaceId, failedFinal.id);
  assert.ok(retryRun, 'Retry should be allowed for failed ingestion runs');
  assert.equal(retryRun?.attempt, failedFinal.attempt + 1);
  assert.equal(retryRun?.retryOfRunId, failedFinal.id);
  const retryFinal = await waitForTerminalRun(workspaceId, retryRun!.id);
  assert.ok(isTerminalStatus(retryFinal.status));
  assertReferencesLookHealthy(workspaceId, retryFinal.id, retryFinal.progress.ranked);

  const completedSourceUrl = pickSourceUrlForStatus({
    target: 'completed',
    platform: 'tiktok',
    maxVideos: 50,
    lookbackDays: 180,
    attempt: 1,
  });
  const completedRun = createIngestionRun(workspaceId, {
    sourcePlatform: 'tiktok',
    sourceUrl: completedSourceUrl,
    maxVideos: 50,
    lookbackDays: 180,
    sortBy: 'engagement',
    preset: 'balanced',
  });
  const completedFinal = await waitForTerminalRun(workspaceId, completedRun.id);
  assert.equal(completedFinal.status, 'completed');
  assertReferencesLookHealthy(workspaceId, completedFinal.id, completedFinal.progress.ranked);
  assert.equal(
    retryIngestionRun(workspaceId, completedFinal.id),
    null,
    'Retry should not be allowed for completed runs'
  );

  const runs = listIngestionRuns(workspaceId);
  assert.equal(runs[0]?.id, completedRun.id, 'Ingestion run history should be sorted by newest first');

  console.log('viral-studio Plan 3/4 tests passed');
}

run().catch((error) => {
  console.error('viral-studio Plan 3/4 tests failed');
  console.error(error);
  process.exit(1);
});
