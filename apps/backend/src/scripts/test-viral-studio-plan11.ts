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
  const timeoutMs = input.timeoutMs || 9_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await requestJson(
      input.baseUrl,
      'GET',
      `/api/portal/workspaces/${input.workspaceId}/viral-studio/ingestions/${input.runId}`
    );
    assert.equal(payload.status, 200, 'Ingestion fetch should succeed while polling');
    const status = payload.body?.run?.status;
    if (status === 'completed' || status === 'partial' || status === 'failed') {
      return payload.body.run;
    }
    await sleep(140);
  }
  throw new Error(`Timed out waiting for ingestion ${input.runId}`);
}

async function run(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/portal/workspaces/:workspaceId', portalViralStudioRouter);
  const server = http.createServer(app);

  const workspaceId = `viral-studio-plan11-${Date.now()}`;
  const previousMode = process.env.VIRAL_STUDIO_PERSISTENCE_MODE;
  const previousGate = process.env.VIRAL_STUDIO_DB_READ_WORKSPACES;
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
        mission: 'Turn viral references into staged execution systems.',
        valueProposition: 'Structured strategy and creative planning with durable outputs.',
        productOrService: 'Viral studio sprint',
        region: 'Global',
        audiencePersonas: ['Founders', 'Marketing leads'],
        pains: ['Too many creative options with no clear winner'],
        desires: ['One clear direction that converts'],
        objections: ['Worried the output will be generic'],
        bannedPhrases: ['guaranteed viral'],
        requiredClaims: ['Results depend on execution quality.'],
        exemplars: ['https://example.com/viral-reference'],
        summary: 'Confident, clear, and proof-led creative planning.',
      }
    );
    assert.equal(brandDna.status, 201, 'Brand DNA should finalize for planner tests');

    const runCreate = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/ingestions`,
      {
        sourcePlatform: 'instagram',
        sourceUrl: 'https://www.instagram.com/plan11_reference',
        preset: 'quick-scan',
        maxVideos: 18,
        lookbackDays: 90,
      }
    );
    assert.equal(runCreate.status, 202, 'Ingestion should start');
    const runId = String(runCreate.body?.run?.id || '');
    assert.ok(runId, 'Ingestion id should be present');

    const terminal = await waitForIngestionTerminal({ baseUrl, workspaceId, runId });
    assert.ok(['completed', 'partial', 'failed'].includes(terminal.status), 'Ingestion should reach a terminal state');

    const references = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/references?ingestionRunId=${encodeURIComponent(runId)}`
    );
    assert.equal(references.status, 200, 'References should load');
    assert.ok(Array.isArray(references.body?.items) && references.body.items.length >= 3, 'Planner requires reference fixtures');

    for (const reference of references.body.items.slice(0, 3)) {
      const shortlist = await requestJson(
        baseUrl,
        'POST',
        `/api/portal/workspaces/${workspaceId}/viral-studio/references/shortlist`,
        {
          referenceId: reference.id,
          action: reference === references.body.items[0] ? 'must-use' : 'pin',
        }
      );
      assert.equal(shortlist.status, 200, 'Shortlist updates should succeed');
    }

    const designAnalyze = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/design-directions/analyze`,
      {}
    );
    assert.equal(designAnalyze.status, 201, 'Design analysis should succeed');
    assert.ok(Array.isArray(designAnalyze.body?.candidates) && designAnalyze.body.candidates.length >= 3, 'Design analysis should create visible candidates');

    const selectedDesignId = String(designAnalyze.body.candidates[0]?.id || '');
    const designSelect = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/design-directions/select`,
      { directionId: selectedDesignId }
    );
    assert.equal(designSelect.status, 200, 'Design selection should succeed');
    assert.equal(designSelect.body?.approved?.candidateId, selectedDesignId, 'Approved design should match selected candidate');

    const contentAnalyze = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/content-directions/analyze`,
      {}
    );
    assert.equal(contentAnalyze.status, 201, 'Content direction analysis should succeed');
    assert.ok(Array.isArray(contentAnalyze.body?.candidates) && contentAnalyze.body.candidates.length >= 3, 'Content analysis should create candidates');

    const selectedContentId = String(contentAnalyze.body.candidates[0]?.id || '');
    const contentSelect = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/content-directions/select`,
      { directionId: selectedContentId }
    );
    assert.equal(contentSelect.status, 200, 'Content selection should succeed');
    assert.equal(contentSelect.body?.approved?.candidateId, selectedContentId, 'Approved content should match selected candidate');

    const formatGeneration = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/format-generations`,
      { contentType: 'carousel' }
    );
    assert.equal(formatGeneration.status, 201, 'Format generation should succeed');
    assert.equal(formatGeneration.body?.generation?.contentType, 'carousel', 'Only the requested content type should be generated');
    assert.ok(
      Array.isArray(formatGeneration.body?.generation?.result?.designDetails?.layoutStructure) &&
        formatGeneration.body.generation.result.designDetails.layoutStructure.length > 0,
      'Design details should be present'
    );
    assert.ok(
      Array.isArray(formatGeneration.body?.generation?.result?.contentDetails?.narrativeBeats) &&
        formatGeneration.body.generation.result.contentDetails.narrativeBeats.length > 0,
      'Content details should be present'
    );
    assert.ok(
      typeof formatGeneration.body?.generation?.generationPackId === 'string' &&
        formatGeneration.body.generation.generationPackId.length > 0,
      'Companion generation pack id should be present for durable document linking'
    );

    const fetchedFormat = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/format-generations/${formatGeneration.body?.generation?.id}`
    );
    assert.equal(fetchedFormat.status, 200, 'Format generation fetch should succeed');
    assert.equal(fetchedFormat.body?.generation?.result?.contentType, 'carousel');

    const documentCreate = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/documents`,
      {
        title: 'Planner document',
        formatGenerationId: formatGeneration.body?.generation?.id,
      }
    );
    assert.equal(documentCreate.status, 201, 'Document should be creatable from staged format generation');

    const documentFetch = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentCreate.body?.document?.id}`
    );
    assert.equal(documentFetch.status, 200, 'Created document should load');
    const sectionTitles = Array.isArray(documentFetch.body?.document?.sections)
      ? documentFetch.body.document.sections.map((section: any) => String(section.title || ''))
      : [];
    assert.ok(sectionTitles.includes('Design Details'), 'Planner document should include design details');
    assert.ok(sectionTitles.includes('Content Details'), 'Planner document should include content details');

    console.log('viral-studio Plan 11 tests passed');
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
  console.error('viral-studio Plan 11 tests failed');
  console.error(error);
  process.exit(1);
});
