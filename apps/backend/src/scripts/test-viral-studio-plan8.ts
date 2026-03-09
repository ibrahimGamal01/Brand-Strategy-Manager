import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import portalViralStudioRouter from '../routes/portal-viral-studio';

type JsonResponse = {
  status: number;
  body: any;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toShortHash(input: string): number {
  const digest = crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16);
}

function buildSourceUrl(platform: 'instagram' | 'tiktok' | 'youtube', index: number): string {
  if (platform === 'instagram') return `https://www.instagram.com/creator_${index}`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@creator_${index}`;
  return `https://www.youtube.com/@creator_${index}`;
}

function resolveRollout(input: {
  platform: 'instagram' | 'tiktok' | 'youtube';
  sourceUrl: string;
  maxVideos: number;
  lookbackDays: number;
  attempt: number;
}): number {
  const seed = toShortHash(
    `${input.platform}|${input.sourceUrl}|${input.maxVideos}|${input.lookbackDays}|${input.attempt}`
  );
  return Math.min(99, (seed % 100) + Math.max(0, input.attempt - 1) * 14);
}

function pickSourceUrlForBackoffValidation(input: {
  platform: 'instagram' | 'tiktok' | 'youtube';
  maxVideos: number;
  lookbackDays: number;
}): string {
  for (let index = 1; index <= 4000; index += 1) {
    const sourceUrl = buildSourceUrl(input.platform, index);
    const firstAttemptRollout = resolveRollout({
      platform: input.platform,
      sourceUrl,
      maxVideos: input.maxVideos,
      lookbackDays: input.lookbackDays,
      attempt: 1,
    });
    if (firstAttemptRollout >= 12) continue;
    const secondAttemptRollout = resolveRollout({
      platform: input.platform,
      sourceUrl,
      maxVideos: input.maxVideos,
      lookbackDays: input.lookbackDays,
      attempt: 2,
    });
    if (secondAttemptRollout >= 12 && secondAttemptRollout < 32) {
      return sourceUrl;
    }
  }
  throw new Error('Unable to derive a deterministic source URL for backoff validation');
}

async function requestJson(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown>
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let parsed: any = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  return {
    status: response.status,
    body: parsed,
  };
}

async function waitForIngestionTerminal(input: {
  baseUrl: string;
  workspaceId: string;
  runId: string;
  timeoutMs?: number;
}): Promise<any> {
  const timeoutMs = input.timeoutMs || 9000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await requestJson(
      input.baseUrl,
      'GET',
      `/api/portal/workspaces/${input.workspaceId}/viral-studio/ingestions/${input.runId}`
    );
    assert.equal(payload.status, 200, 'Ingestion run lookup should succeed while polling');
    const status = payload.body?.run?.status;
    if (status === 'completed' || status === 'partial' || status === 'failed') {
      return payload.body.run;
    }
    await sleep(160);
  }
  throw new Error(`Timed out waiting for ingestion terminal status (run=${input.runId})`);
}

async function run(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/portal/workspaces/:workspaceId', portalViralStudioRouter);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to acquire test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const workspaceUrlValidation = `viral-studio-plan8-url-${Date.now()}`;
    const invalidUrlResult = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceUrlValidation}/viral-studio/ingestions`,
      {
        sourcePlatform: 'instagram',
        sourceUrl: 'https://www.youtube.com/@cross_platform_invalid',
        maxVideos: 20,
        lookbackDays: 90,
      }
    );
    assert.equal(invalidUrlResult.status, 400, 'Cross-platform source URL must be rejected');
    assert.equal(invalidUrlResult.body?.error, 'INVALID_SOURCE_URL');

    const workspaceIngestionLimit = `viral-studio-plan8-ing-limit-${Date.now()}`;
    for (let index = 1; index <= 12; index += 1) {
      const ok = await requestJson(
        baseUrl,
        'POST',
        `/api/portal/workspaces/${workspaceIngestionLimit}/viral-studio/ingestions`,
        {
          sourcePlatform: 'instagram',
          sourceUrl: buildSourceUrl('instagram', index),
          maxVideos: 24,
          lookbackDays: 90,
          preset: 'quick-scan',
        }
      );
      assert.equal(ok.status, 202, `Ingestion request ${index} should stay within workspace limit`);
    }
    const ingestionLimit = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceIngestionLimit}/viral-studio/ingestions`,
      {
        sourcePlatform: 'instagram',
        sourceUrl: buildSourceUrl('instagram', 9999),
      }
    );
    assert.equal(ingestionLimit.status, 429, '13th ingestion request should be rate limited');
    assert.equal(ingestionLimit.body?.error, 'RATE_LIMITED_INGESTION_CREATE');

    const workspaceGenerationLimit = `viral-studio-plan8-gen-limit-${Date.now()}`;
    for (let index = 1; index <= 20; index += 1) {
      const response = await requestJson(
        baseUrl,
        'POST',
        `/api/portal/workspaces/${workspaceGenerationLimit}/viral-studio/generations`,
        {
          templateId: 'full-script',
          prompt: `Generate campaign pack batch ${index}`,
          formatTarget: 'reel-30',
        }
      );
      assert.equal(
        response.status,
        409,
        `Generation request ${index} should fail Brand DNA gate before reaching hard rate limit`
      );
      assert.equal(response.body?.error, 'BRAND_DNA_REQUIRED');
    }
    const generationLimit = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceGenerationLimit}/viral-studio/generations`,
      {
        templateId: 'full-script',
        prompt: 'This request should be rate limited',
      }
    );
    assert.equal(generationLimit.status, 429, '21st generation request should be rate limited');
    assert.equal(generationLimit.body?.error, 'RATE_LIMITED_GENERATION_CREATE');

    const missingGenerationId = 'missing-generation-id';
    for (let index = 1; index <= 40; index += 1) {
      const response = await requestJson(
        baseUrl,
        'POST',
        `/api/portal/workspaces/${workspaceGenerationLimit}/viral-studio/generations/${missingGenerationId}/refine`,
        {
          section: 'hooks',
          mode: 'refine',
          instruction: `Refine hooks variant ${index}`,
        }
      );
      assert.equal(
        response.status,
        404,
        `Refine request ${index} should fail on missing generation before hitting hard rate limit`
      );
      assert.equal(response.body?.error, 'Generation not found');
    }
    const refineLimit = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceGenerationLimit}/viral-studio/generations/${missingGenerationId}/refine`,
      {
        section: 'hooks',
        mode: 'refine',
        instruction: 'This refine request should be rate limited',
      }
    );
    assert.equal(refineLimit.status, 429, '41st refine request should be rate limited');
    assert.equal(refineLimit.body?.error, 'RATE_LIMITED_GENERATION_REFINE');

    const workspaceRetryBackoff = `viral-studio-plan8-retry-${Date.now()}`;
    const failedSourceUrl = pickSourceUrlForBackoffValidation({
      platform: 'youtube',
      maxVideos: 50,
      lookbackDays: 180,
    });
    const firstRunResponse = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceRetryBackoff}/viral-studio/ingestions`,
      {
        sourcePlatform: 'youtube',
        sourceUrl: failedSourceUrl,
        maxVideos: 50,
        lookbackDays: 180,
        sortBy: 'engagement',
        preset: 'balanced',
      }
    );
    assert.equal(firstRunResponse.status, 202, 'Initial ingestion run should be accepted');
    const firstRun = await waitForIngestionTerminal({
      baseUrl,
      workspaceId: workspaceRetryBackoff,
      runId: firstRunResponse.body?.run?.id,
    });
    assert.equal(firstRun.status, 'failed', 'Deterministic first run should fail');

    const retryOne = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceRetryBackoff}/viral-studio/ingestions/${firstRun.id}/retry`,
      {}
    );
    assert.equal(retryOne.status, 202, 'First retry should be accepted');
    const secondRun = await waitForIngestionTerminal({
      baseUrl,
      workspaceId: workspaceRetryBackoff,
      runId: retryOne.body?.run?.id,
    });
    assert.equal(secondRun.status, 'partial', 'Second run should enter partial state for backoff validation');

    const retryBlocked = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceRetryBackoff}/viral-studio/ingestions/${secondRun.id}/retry`,
      {}
    );
    assert.equal(retryBlocked.status, 429, 'Immediate retry after attempt 2 should enforce backoff');
    assert.equal(retryBlocked.body?.error, 'INGESTION_RETRY_BACKOFF_ACTIVE');

    const ingestionTelemetry = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceRetryBackoff}/viral-studio/telemetry`
    );
    assert.equal(ingestionTelemetry.status, 200, 'Telemetry endpoint should return snapshot');
    assert.ok(
      Number(ingestionTelemetry.body?.telemetry?.funnel?.ingestionsStarted || 0) >= 2,
      'Telemetry should capture ingestion starts'
    );
    assert.ok(
      Number(ingestionTelemetry.body?.telemetry?.funnel?.ingestionsFailed || 0) >= 1,
      'Telemetry should capture failed/partial ingestion outcomes'
    );
    assert.ok(
      Number(ingestionTelemetry.body?.telemetry?.latencyMs?.ingestionAvg || 0) >= 0,
      'Ingestion latency average should be reported'
    );

    assert.ok(
      Array.isArray(ingestionTelemetry.body?.telemetry?.recent) &&
        ingestionTelemetry.body.telemetry.recent.length > 0,
      'Telemetry recent feed should include runtime events'
    );

    console.log('viral-studio Plan 8 tests passed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

run().catch((error) => {
  console.error('viral-studio Plan 8 tests failed');
  console.error(error);
  process.exit(1);
});
