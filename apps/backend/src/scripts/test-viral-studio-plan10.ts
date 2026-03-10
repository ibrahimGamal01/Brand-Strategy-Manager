import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { prisma } from '../lib/prisma';
import portalViralStudioRouter from '../routes/portal-viral-studio';
import { createAgentLinkHelpers, type AgentContext } from '../services/ai/chat/agent-context';
import { getTool } from '../services/ai/chat/tools/tool-registry';

type JsonResponse = {
  status: number;
  body: any;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toShortHash(input: string): number {
  const digest = crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16);
}

function pickSourceUrlForStatus(input: {
  target: 'completed';
  platform: 'instagram' | 'tiktok' | 'youtube';
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
    if (rollout >= 32) return candidate;
  }
  throw new Error('Failed to derive deterministic completed ingestion source URL.');
}

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
  return { status: response.status, body: parsed };
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

async function isDatabaseAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.warn(
      '[test-viral-studio-plan10] Skipping integration checks because database is unavailable:',
      (error as Error)?.message || String(error)
    );
    return false;
  }
}

async function run(): Promise<void> {
  if (!(await isDatabaseAvailable())) {
    console.log('viral-studio Plan 10 tests skipped (database unavailable)');
    return;
  }

  const suffix = Date.now().toString(36);
  const client = await prisma.client.create({
    data: {
      name: `Viral Studio Plan10 ${suffix}`,
    },
  });

  const workspace = await prisma.researchJob.create({
    data: {
      clientId: client.id,
      status: 'PENDING',
      inputData: {
        source: 'portal_intro_form',
        brandName: `Plan10 Brand ${suffix}`,
        website: 'https://plan10-brand.example.com',
        websites: ['https://plan10-brand.example.com', 'https://plan10-brand.example.com/about'],
        socialReferences: ['https://www.tiktok.com/@plan10brand'],
        oneSentenceDescription: 'We build high-converting creator content systems for growth teams.',
        description: 'We build high-converting creator content systems for growth teams.',
        businessType: 'Agency',
        mainOffer: 'Creator-led content strategy and production',
        operateWhere: 'United States',
        wantClientsWhere: 'United States',
        idealAudience: 'DTC founders and growth leads',
        targetAudience: 'DTC founders and growth leads',
        primaryGoal: 'Predictable inbound pipeline from short-form content',
        topProblems: ['Low retention', 'Weak hooks', 'Inconsistent posting quality'],
        resultsIn90Days: ['Increase qualified leads', 'Lift view-to-click conversion'],
        questionsBeforeBuying: ['Will this match our tone?', 'How fast can we launch?', 'What is the expected ROI range?'],
        brandVoiceWords: ['bold', 'direct', 'clear'],
        brandTone: 'Bold and practical',
        topicsToAvoid: ['guaranteed overnight growth'],
        constraints: ['Results depend on execution quality and market context.'],
        competitorInspirationLinks: [
          'https://www.instagram.com/plan10inspo',
          'https://www.youtube.com/@plan10inspo',
        ],
        handles: {
          instagram: 'plan10brand',
          tiktok: 'plan10brand',
          youtube: 'plan10brand',
        },
        handlesV2: {
          instagram: { primary: 'plan10brand', handles: ['plan10brand'] },
          tiktok: { primary: 'plan10brand', handles: ['plan10brand'] },
          youtube: { primary: 'plan10brand', handles: ['plan10brand'] },
          twitter: { primary: '', handles: [] },
          linkedin: { primary: '', handles: [] },
        },
      },
    },
  });

  const workspaceId = workspace.id;
  const previousMode = process.env.VIRAL_STUDIO_PERSISTENCE_MODE;
  const previousGate = process.env.VIRAL_STUDIO_DB_READ_WORKSPACES;
  process.env.VIRAL_STUDIO_PERSISTENCE_MODE = 'dual';
  process.env.VIRAL_STUDIO_DB_READ_WORKSPACES = workspaceId;

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
    const workflowInitial = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/workflow-status`
    );
    assert.equal(workflowInitial.status, 200, 'Workflow status endpoint should respond');
    assert.equal(workflowInitial.body?.workflow?.intakeCompleted, true, 'Workspace intake should be complete');
    assert.ok(
      workflowInitial.body?.workflow?.workflowStage === 'studio_autofill_review' ||
        workflowInitial.body?.workflow?.workflowStage === 'intake_complete',
      'Initial stage should be intake_complete or studio_autofill_review before Brand DNA finalization'
    );

    const suggestedSources = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/extraction/suggested-sources`
    );
    assert.equal(suggestedSources.status, 200, 'Suggested sources endpoint should respond');
    assert.equal(suggestedSources.body?.defaultPreset, 'data-max', 'Integrated flow should default to data-max preset');
    assert.ok(Array.isArray(suggestedSources.body?.items), 'Suggested sources should return an array');
    assert.ok(suggestedSources.body.items.length > 0, 'Suggested sources should include intake-derived candidates');

    const preview = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/brand-dna/autofill-preview`,
      {}
    );
    assert.equal(preview.status, 200, 'Autofill preview should respond');
    assert.ok(Array.isArray(preview.body?.preview?.suggestedFields), 'Autofill preview should include suggested fields');
    assert.ok(preview.body.preview.suggestedFields.length >= 8, 'Autofill preview should suggest multiple Brand DNA fields');
    assert.ok(
      preview.body.preview.suggestedFields.includes('mission'),
      'Autofill preview should include mission field suggestion'
    );
    assert.ok(
      Array.isArray(preview.body.preview.sourceEvidence) && preview.body.preview.sourceEvidence.length > 0,
      'Autofill preview should include evidence references'
    );

    const manualMission = 'Manual mission lock for selective apply assertion.';
    const brandDraft = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/brand-dna`,
      {
        mission: manualMission,
        status: 'draft',
      }
    );
    assert.equal(brandDraft.status, 201, 'Brand DNA draft creation should succeed');

    const selectedFields = preview.body.preview.suggestedFields
      .filter((field: string) => field !== 'mission')
      .slice(0, 4);
    assert.ok(selectedFields.length > 0, 'Selective autofill test requires at least one non-mission field');

    const selectiveApply = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/brand-dna/autofill-apply`,
      {
        selectedFields,
        finalizeIfReady: false,
      }
    );
    assert.equal(selectiveApply.status, 200, 'Selective autofill apply should succeed');
    assert.ok(
      selectedFields.every((field: string) => selectiveApply.body?.appliedFields?.includes(field)),
      'Selective apply should keep the requested field set'
    );

    const brandAfterSelective = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/brand-dna`
    );
    assert.equal(brandAfterSelective.status, 200, 'Brand DNA fetch should succeed');
    assert.equal(
      brandAfterSelective.body?.profile?.mission,
      manualMission,
      'Manual mission should remain untouched when mission is excluded from apply selection'
    );

    const finalizeApply = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/brand-dna/autofill-apply`,
      {
        finalizeIfReady: true,
      }
    );
    assert.equal(finalizeApply.status, 200, 'Final autofill apply should succeed');
    assert.equal(finalizeApply.body?.profile?.status, 'final', 'Brand DNA should finalize when completeness is satisfied');
    assert.equal(finalizeApply.body?.profile?.completeness?.ready, true, 'Brand DNA completeness should be ready');

    const workflowExtraction = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/workflow-status`
    );
    assert.equal(workflowExtraction.status, 200);
    assert.equal(workflowExtraction.body?.workflow?.workflowStage, 'extraction', 'Post-finalization stage should move to extraction');

    const preferredPlatform =
      suggestedSources.body.items.find((item: any) => item.platform === 'instagram')?.platform ||
      suggestedSources.body.items[0]?.platform ||
      'instagram';
    const deterministicSourceUrl = pickSourceUrlForStatus({
      target: 'completed',
      platform: preferredPlatform,
      maxVideos: 120,
      lookbackDays: 365,
      attempt: 1,
    });

    const ingestionCreate = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/ingestions`,
      {
        sourcePlatform: preferredPlatform,
        sourceUrl: deterministicSourceUrl,
        preset: 'data-max',
        sortBy: 'engagement',
      }
    );
    assert.equal(ingestionCreate.status, 202, 'Data-max ingestion run should be created');
    assert.equal(ingestionCreate.body?.run?.preset, 'data-max');
    assert.equal(ingestionCreate.body?.run?.maxVideos, 120);
    assert.equal(ingestionCreate.body?.run?.lookbackDays, 365);
    const ingestionId = String(ingestionCreate.body?.run?.id || '');
    assert.ok(ingestionId, 'Ingestion run id should be present');

    const ingestionTerminal = await waitForIngestionTerminal({
      baseUrl,
      workspaceId,
      runId: ingestionId,
      timeoutMs: 10_000,
    });
    assert.equal(ingestionTerminal.status, 'completed', 'Deterministic ingestion should complete');

    const ingestionEvents = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/ingestions/${ingestionId}/events`
    );
    assert.equal(ingestionEvents.status, 200, 'Ingestion events endpoint should respond');
    assert.ok(ingestionEvents.body?.count >= 3, 'Ingestion timeline should include lifecycle events');

    const references = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/references?ingestionRunId=${encodeURIComponent(ingestionId)}`
    );
    assert.equal(references.status, 200, 'References endpoint should respond');
    assert.ok(Array.isArray(references.body?.items), 'References payload should be an array');
    assert.ok(references.body.items.length > 0, 'Completed ingestion should produce ranked references');
    const firstReference = references.body.items[0];

    const workflowCuration = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/workflow-status`
    );
    assert.equal(workflowCuration.status, 200);
    assert.equal(workflowCuration.body?.workflow?.workflowStage, 'curation', 'Stage should move to curation after extraction');

    const shortlist = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/references/shortlist`,
      {
        referenceId: firstReference.id,
        action: 'must-use',
      }
    );
    assert.equal(shortlist.status, 200, 'Shortlist action should succeed');
    assert.equal(shortlist.body?.item?.shortlistState, 'must-use');
    assert.ok(
      String(shortlist.body?.item?.assetRef || '').startsWith('vsr1.'),
      'Shortlisted references should expose durable asset refs'
    );

    const workflowGeneration = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/workflow-status`
    );
    assert.equal(workflowGeneration.status, 200);
    assert.equal(workflowGeneration.body?.workflow?.workflowStage, 'generation', 'Shortlisting should unlock generation stage');

    const generation = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/generations`,
      {
        templateId: 'full-script',
        prompt: 'Create a launch-ready multi-pack for short-form campaign execution.',
        selectedReferenceIds: [firstReference.id],
        formatTarget: 'shorts',
      }
    );
    assert.equal(generation.status, 201, 'Generation should succeed');
    assert.ok(
      String(generation.body?.generation?.assetRef || '').startsWith('vsr1.'),
      'Generation payload should include durable asset refs'
    );

    const document = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/documents`,
      {
        generationId: generation.body?.generation?.id,
        title: 'Plan10 chat-first durable document',
      }
    );
    assert.equal(document.status, 201, 'Document creation should succeed');

    const version = await requestJson(
      baseUrl,
      'POST',
      `/api/portal/workspaces/${workspaceId}/viral-studio/documents/${document.body?.document?.id}/versions`,
      {
        author: 'plan10-test',
        summary: 'Initial immutable version',
      }
    );
    assert.equal(version.status, 201, 'Document version creation should succeed');
    assert.ok(
      String(version.body?.version?.assetRef || '').startsWith('vsr1.'),
      'Document version should include durable asset refs'
    );

    const workflowChatExecution = await requestJson(
      baseUrl,
      'GET',
      `/api/portal/workspaces/${workspaceId}/viral-studio/workflow-status`
    );
    assert.equal(workflowChatExecution.status, 200);
    assert.equal(
      workflowChatExecution.body?.workflow?.workflowStage,
      'chat_execution',
      'Generation completion should move stage to chat_execution'
    );

    const viralContextTool = getTool('workspace.viral_studio.get_context');
    assert.ok(viralContextTool, 'workspace.viral_studio.get_context should be registered');
    const toolContext: AgentContext = {
      researchJobId: workspaceId,
      sessionId: `session-plan10-${suffix}`,
      userMessage: 'Use Viral Studio context now',
      chatRag: {} as AgentContext['chatRag'],
      userContexts: [],
      links: createAgentLinkHelpers('https://client-portal-khaki-one.vercel.app', workspaceId),
      runtime: {
        nowIso: new Date().toISOString(),
        requestId: `req-plan10-${suffix}`,
      },
    };

    const toolResult = await viralContextTool!.execute(toolContext, {});
    const toolRecord = asRecord(toolResult);
    const prioritizedReferenceCount = Number(toolRecord.prioritizedReferenceCount || 0);
    const libraryRefs = Array.isArray(toolRecord.libraryRefs) ? toolRecord.libraryRefs : [];
    const contextRecord = asRecord(toolRecord.context);
    const citations = Array.isArray(contextRecord.citations) ? contextRecord.citations : [];

    assert.equal(toolRecord.section, 'workspace_viral_studio');
    assert.equal(toolRecord.brandReady, true, 'Chat context tool should report finalized Brand DNA');
    assert.ok(prioritizedReferenceCount >= 1, 'Chat context tool should include prioritized references');
    assert.ok(Array.isArray(libraryRefs), 'Chat context tool should return durable library refs');
    assert.ok(libraryRefs.length > 0, 'Chat context tool should surface non-empty durable refs');
    assert.ok(
      libraryRefs.every((entry: unknown) => String(entry || '').startsWith('vsr1.')),
      'Chat context library refs should be durable asset refs'
    );
    assert.ok(Array.isArray(citations), 'Context payload should include citations');
    assert.ok(
      citations.some((entry: any) => String(entry?.libraryRef || '').startsWith('vsr1.')),
      'Context citations should include durable asset refs'
    );

    console.log('viral-studio Plan 10 tests passed');
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
    await prisma.client.delete({ where: { id: client.id } }).catch(() => undefined);
  }
}

run()
  .catch((error) => {
    console.error('viral-studio Plan 10 tests failed');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
