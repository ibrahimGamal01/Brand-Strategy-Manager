import assert from 'node:assert/strict';
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
    await sleep(140);
  }
  throw new Error(`Timed out waiting for ingestion terminal status (run=${input.runId})`);
}

async function run(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/portal/workspaces/:workspaceId', portalViralStudioRouter);
  const server = http.createServer(app);

  const previousMode = process.env.VIRAL_STUDIO_PERSISTENCE_MODE;
  const previousGate = process.env.VIRAL_STUDIO_DB_READ_WORKSPACES;
  const workspaceId = `viral-studio-plan9-${Date.now()}`;
  process.env.VIRAL_STUDIO_PERSISTENCE_MODE = 'dual';
  process.env.VIRAL_STUDIO_DB_READ_WORKSPACES = workspaceId;

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to acquire test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const brandDna = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/brand-dna`,
      {
        status: 'final',
        mission: 'Ship measurable growth systems.',
        valueProposition: 'Execution-first strategy and creative.',
        productOrService: 'Growth sprint',
        region: 'US',
        audiencePersonas: ['SaaS founders'],
        pains: ['Inconsistent inbound demand'],
        desires: ['Predictable qualified pipeline'],
        bannedPhrases: ['guaranteed results'],
        requiredClaims: ['Results vary by implementation quality.'],
        exemplars: ['https://example.com/high-performing-reel'],
        summary: 'Bold but practical messaging for operator audiences.',
      }
    );
    assert.equal(brandDna.status, 201, 'Brand DNA should be accepted');
    assert.equal(brandDna.body?.profile?.status, 'final', 'Brand DNA should finalize when completeness gates pass');

    const storageMode = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/storage-mode`
    );
    assert.equal(storageMode.status, 200, 'Storage mode diagnostics should be available');
    assert.equal(storageMode.body?.storage?.mode, 'dual');
    assert.equal(storageMode.body?.storage?.readStrategy, 'db-first');

    const runCreate = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/ingestions`,
      {
        sourcePlatform: 'instagram',
        sourceUrl: 'https://www.instagram.com/plan9_durable_reference',
        maxVideos: 24,
        lookbackDays: 90,
        preset: 'quick-scan',
      }
    );
    assert.equal(runCreate.status, 202, 'Ingestion run should be created');
    const runId = String(runCreate.body?.run?.id || '');
    assert.ok(runId, 'Run id should be present');

    const terminal = await waitForIngestionTerminal({ baseUrl, workspaceId, runId });
    assert.ok(
      terminal.status === 'completed' || terminal.status === 'partial' || terminal.status === 'failed',
      'Ingestion should converge to terminal status'
    );
    assert.equal(terminal.storageMode, 'dual', 'Run payload should include storage mode metadata');

    const events = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/ingestions/${runId}/events`
    );
    assert.equal(events.status, 200, 'Ingestion events endpoint should respond');
    assert.ok(Array.isArray(events.body?.events), 'Events payload should be an array');
    assert.ok(events.body.events.length > 0, 'Ingestion timeline should include lifecycle events');

    const references = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/references?ingestionRunId=${encodeURIComponent(runId)}`
    );
    assert.equal(references.status, 200, 'References endpoint should respond');
    assert.ok(Array.isArray(references.body?.items), 'References payload should be an array');

    const firstReference = references.body.items[0];
    if (firstReference) {
      const shortlist = await requestJson(
        baseUrl,
        'POST',
        `/api/portal/workspaces/${workspaceId}/viral-studio/references/shortlist`,
        {
          referenceId: firstReference.id,
          action: 'must-use',
        }
      );
      assert.equal(shortlist.status, 200, 'Shortlist update should succeed');
      assert.ok(
        String(shortlist.body?.item?.assetRef || '').startsWith('vsr1.'),
        'Durable assetRef should be present on shortlisted references'
      );
    }

    const selectedReferenceIds = Array.isArray(references.body?.items)
      ? references.body.items.slice(0, 3).map((item: any) => String(item.id || '')).filter(Boolean)
      : [];
    const generation = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/generations`,
      {
        templateId: 'full-script',
        prompt: 'Produce a channel-ready launch pack.',
        selectedReferenceIds,
        formatTarget: 'shorts',
      }
    );
    assert.equal(generation.status, 201, 'Generation request should succeed');
    assert.ok(
      String(generation.body?.generation?.assetRef || '').startsWith('vsr1.'),
      'Generation payload should include durable assetRef'
    );

    const documentCreate = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/documents`,
      {
        generationId: generation.body?.generation?.id,
        title: 'Plan 9 durable artifact',
      }
    );
    assert.equal(documentCreate.status, 201, 'Document creation should succeed');

    const versionCreate = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentCreate.body?.document?.id}/versions`,
      {
        author: 'plan9-test',
        summary: 'Persisted snapshot',
      }
    );
    assert.equal(versionCreate.status, 201, 'Document version creation should succeed');
    assert.ok(
      String(versionCreate.body?.version?.assetRef || '').startsWith('vsr1.'),
      'Document version should include durable assetRef'
    );
    assert.ok(
      Number(versionCreate.body?.version?.versionNumber || 0) >= 1,
      'Document version should include immutable versionNumber metadata'
    );

    console.log('viral-studio Plan 9 tests passed');
  } finally {
    process.env.VIRAL_STUDIO_PERSISTENCE_MODE = previousMode;
    process.env.VIRAL_STUDIO_DB_READ_WORKSPACES = previousGate;
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
  console.error('viral-studio Plan 9 tests failed');
  console.error(error);
  process.exit(1);
});
