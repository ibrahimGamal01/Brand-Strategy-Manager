import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from '../services/storage/storage-root';

type JsonRecord = Record<string, unknown>;

class CookieJar {
  private readonly cookies = new Map<string, string>();

  apply(headers: Record<string, string>) {
    if (!this.cookies.size) return;
    headers.cookie = Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  readFrom(response: Response) {
    const headerSource = response.headers as unknown as {
      getSetCookie?: () => string[];
      raw?: () => Record<string, string[]>;
    };

    const fromGetter = typeof headerSource.getSetCookie === 'function' ? headerSource.getSetCookie() : [];
    const fromRaw = typeof headerSource.raw === 'function' ? headerSource.raw()?.['set-cookie'] || [] : [];

    for (const raw of [...fromGetter, ...fromRaw]) {
      const pair = String(raw || '').split(';')[0] || '';
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!name || !value) continue;
      this.cookies.set(name, value);
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function apiRequest<T = JsonRecord>(
  baseUrl: string,
  pathName: string,
  init: RequestInit,
  jar?: CookieJar,
  timeoutMs = 90_000
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (init.headers && typeof init.headers === 'object') {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  jar?.apply(headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  jar?.readFrom(response);
  const text = await response.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : {}) as T;
  } catch {
    data = { raw: text } as T;
  }

  return { status: response.status, data };
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function normalizeBlocks(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (isRecord(entry) ? entry : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  if (isRecord(value)) return [value];
  return [];
}

function toAbsoluteStoragePath(storagePath: string): string {
  const normalized = String(storagePath || '').trim();
  if (!normalized) throw new Error('storagePath is required');
  if (path.isAbsolute(normalized)) return normalized;
  if (normalized.startsWith('/storage/')) {
    return path.join(STORAGE_ROOT, normalized.replace(/^\/storage\//, ''));
  }
  if (normalized.startsWith('storage/')) {
    return path.join(STORAGE_ROOT, normalized.replace(/^storage\//, ''));
  }
  return path.join(STORAGE_ROOT, normalized);
}

async function ensureBranchId(baseUrl: string, workspaceId: string, jar: CookieJar): Promise<string> {
  const threadsRes = await apiRequest<{ threads?: Array<{ id?: string; pinnedBranchId?: string | null }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads`,
    { method: 'GET' },
    jar
  );
  assert.equal(threadsRes.status, 200, `Failed to list runtime threads: ${threadsRes.status}`);

  let threadId = String(threadsRes.data.threads?.[0]?.id || '').trim();
  let pinnedBranchId = String(threadsRes.data.threads?.[0]?.pinnedBranchId || '').trim();

  if (!threadId) {
    const createRes = await apiRequest<{ thread?: { id?: string }; branch?: { id?: string } }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/threads`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `Premium document smoke ${Date.now()}` }),
      },
      jar
    );
    assert.equal(createRes.status, 201, `Failed to create runtime thread: ${createRes.status}`);
    threadId = String(createRes.data.thread?.id || '').trim();
    pinnedBranchId = String(createRes.data.branch?.id || '').trim();
  }

  assert.ok(threadId, 'No runtime thread available.');
  if (pinnedBranchId) return pinnedBranchId;

  const threadRes = await apiRequest<{ branches?: Array<{ id?: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads/${threadId}`,
    { method: 'GET' },
    jar
  );
  assert.equal(threadRes.status, 200, `Failed to load runtime thread detail: ${threadRes.status}`);
  const branchId = String(threadRes.data.branches?.[0]?.id || '').trim();
  assert.ok(branchId, 'No branch found in runtime thread.');
  return branchId;
}

async function waitForArtifactMessage(input: {
  baseUrl: string;
  workspaceId: string;
  branchId: string;
  createdAfterMs: number;
  jar: CookieJar;
  timeoutMs?: number;
}): Promise<{
  assistantContent: string;
  artifact: Record<string, unknown>;
}> {
  const timeoutMs = Math.max(60_000, Number(input.timeoutMs || 300_000));
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const messagesRes = await apiRequest<{ messages?: Array<Record<string, unknown>> }>(
      input.baseUrl,
      `/api/research-jobs/${input.workspaceId}/runtime/branches/${input.branchId}/messages?limit=220`,
      { method: 'GET' },
      input.jar
    );
    if (messagesRes.status !== 200 || !Array.isArray(messagesRes.data.messages)) continue;

    const assistantMessages = messagesRes.data.messages
      .filter((row) => String(row.role || '').toUpperCase() === 'ASSISTANT')
      .filter((row) => {
        const createdAt = Date.parse(String(row.createdAt || ''));
        return Number.isFinite(createdAt) && createdAt >= input.createdAfterMs;
      })
      .reverse();

    for (const message of assistantMessages) {
      const blocks = normalizeBlocks(message.blocksJson).flatMap((block) => normalizeBlocks(block));
      const artifact = blocks.find((block) => String(block.type || '').trim().toLowerCase() === 'document_artifact');
      if (!artifact) continue;

      const assistantContent = String(message.content || '').trim();
      if (!assistantContent) continue;

      return {
        assistantContent,
        artifact,
      };
    }
  }

  throw new Error('Timed out waiting for premium document artifact.');
}

async function waitForEvents(input: {
  baseUrl: string;
  workspaceId: string;
  branchId: string;
  createdAfterMs: number;
  jar: CookieJar;
  expectedEvents: string[];
  timeoutMs?: number;
}): Promise<Array<Record<string, unknown>>> {
  const timeoutMs = Math.max(30_000, Number(input.timeoutMs || 240_000));
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const eventsRes = await apiRequest<{ events?: Array<Record<string, unknown>> }>(
      input.baseUrl,
      `/api/research-jobs/${input.workspaceId}/runtime/branches/${input.branchId}/events?limit=260`,
      { method: 'GET' },
      input.jar
    );
    if (eventsRes.status !== 200 || !Array.isArray(eventsRes.data.events)) continue;

    const recent = eventsRes.data.events.filter((row) => {
      const createdAt = Date.parse(String(row.createdAt || ''));
      return Number.isFinite(createdAt) && createdAt >= input.createdAfterMs;
    });

    const seen = new Set<string>();
    for (const row of recent) {
      const payload = isRecord(row.payloadJson) ? row.payloadJson : {};
      const eventV2 = isRecord(payload.eventV2) ? payload.eventV2 : isRecord(row.eventV2) ? row.eventV2 : {};
      const eventName = String(eventV2.event || row.eventName || '').trim().toLowerCase();
      if (eventName) seen.add(eventName);
    }

    if (input.expectedEvents.every((eventName) => seen.has(eventName.toLowerCase()))) {
      return recent;
    }
  }

  throw new Error(`Timed out waiting for runtime events: ${input.expectedEvents.join(', ')}`);
}

async function main() {
  const baseUrl = String(
    process.env.PREMIUM_SMOKE_BASE_URL ||
      process.env.CHATGPT_PARITY_BASE_URL ||
      process.env.PORTAL_E2E_BASE_URL ||
      process.env.R1_BASE_URL ||
      'http://localhost:3001'
  ).replace(/\/+$/, '');
  const email = requiredEnv('R1_ADMIN_EMAIL');
  const password = requiredEnv('R1_ADMIN_PASSWORD');
  const workspaceId = requiredEnv('R1_WORKSPACE_ID');

  const jar = new CookieJar();
  const smokeId = `premium-live-doc-${Date.now()}`;

  const loginRes = await apiRequest<{ user?: { id?: string } }>(
    baseUrl,
    '/api/portal/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    jar
  );
  assert.equal(loginRes.status, 200, `Portal login failed: ${loginRes.status}`);

  const branchId = await ensureBranchId(baseUrl, workspaceId, jar);
  const createdAfterMs = Date.now() - 2000;

  const prompt =
    `Create a business strategy document for this workspace and return it as a premium PDF artifact. ` +
    `Use deep/pro reasoning, strong executive recommendations, and evidence-backed sections. (${smokeId})`;

  const sendRes = await apiRequest<{ runId?: string; queued?: boolean; userMessageId?: string }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: prompt,
        mode: 'interrupt',
        inputOptions: {
          modeLabel: 'pro',
          targetLength: 'long',
          strictValidation: true,
        },
      }),
    },
    jar
  );
  assert.ok(sendRes.status === 200 || sendRes.status === 202, `Failed to send runtime message: ${sendRes.status}`);
  assert.ok(sendRes.data.runId || sendRes.data.queued, 'Expected a run or queue acknowledgement.');

  const { assistantContent, artifact } = await waitForArtifactMessage({
    baseUrl,
    workspaceId,
    branchId,
    createdAfterMs,
    jar,
  });

  assert.ok(assistantContent.length >= 180, 'Assistant response is unexpectedly short.');
  assert.ok(/recommend/i.test(assistantContent), 'Assistant response did not include recommendations language.');

  const artifactTitle = String(artifact.title || '').trim();
  const artifactDocumentId = String(artifact.documentId || '').trim();
  const artifactStoragePath = String(artifact.storagePath || '').trim();
  const artifactDownloadHref = String(artifact.downloadHref || artifact.previewHref || '').trim();
  const artifactRenderTheme = String(artifact.renderTheme || '').trim();
  const artifactQualityScore = Number(artifact.qualityScore);
  const artifactCoverageScore = Number(artifact.coverageScore);

  assert.ok(artifactTitle.length > 2, 'Artifact title missing.');
  assert.ok(artifactDocumentId, 'Artifact documentId missing.');
  assert.ok(artifactStoragePath || artifactDownloadHref, 'Artifact file location missing.');
  assert.ok(Number.isFinite(artifactQualityScore) && artifactQualityScore >= 60, 'Artifact qualityScore missing or too low.');
  assert.ok(Number.isFinite(artifactCoverageScore) && artifactCoverageScore >= 40, 'Artifact coverageScore missing or too low.');
  assert.ok(isRecord(artifact.dimensionScores), 'Artifact dimensionScores missing.');
  assert.ok(artifactRenderTheme.length > 0, 'Artifact renderTheme missing.');

  const stageEvents = await waitForEvents({
    baseUrl,
    workspaceId,
    branchId,
    createdAfterMs,
    jar,
    expectedEvents: [
      'document.section_draft_started',
      'document.section_draft_completed',
      'document.editorial_completed',
      'document.fact_check_completed',
      'document.quality_scored',
      'document.render_theme_applied',
    ],
  });

  const docsRes = await apiRequest<{ documents?: Array<Record<string, unknown>> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/documents?limit=40`,
    { method: 'GET' },
    jar
  );
  assert.equal(docsRes.status, 200, `Failed to list runtime documents: ${docsRes.status}`);
  assert.ok(Array.isArray(docsRes.data.documents), 'Runtime documents response invalid.');

  const listedDocument = (docsRes.data.documents || []).find((doc) => String(doc.id || '').trim() === artifactDocumentId);
  assert.ok(listedDocument, `Generated document ${artifactDocumentId} was not found in runtime documents list.`);

  const listedMeta = isRecord(listedDocument?.generatedMeta) ? listedDocument.generatedMeta : {};
  assert.ok(Number.isFinite(Number(listedMeta.qualityScore)), 'List response missing generatedMeta.qualityScore.');
  assert.ok(Array.isArray(listedMeta.qualityNotes) && listedMeta.qualityNotes.length > 0, 'List response missing quality notes.');
  assert.ok(isRecord(listedMeta.dimensionScores), 'List response missing dimensionScores.');
  assert.ok(Number(listedMeta.editorialPassCount) >= 2, 'List response missing editorialPassCount.');
  assert.ok(String(listedMeta.renderTheme || '').trim().length > 0, 'List response missing renderTheme.');
  assert.ok(isRecord(listedDocument?.qualityReference), 'List response missing qualityReference.');

  const detailRes = await apiRequest<{ document?: Record<string, unknown> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/documents/${artifactDocumentId}`,
    { method: 'GET' },
    jar
  );
  assert.equal(detailRes.status, 200, `Failed to load runtime document detail: ${detailRes.status}`);
  assert.ok(isRecord(detailRes.data.document), 'Runtime document detail response invalid.');

  const documentDetail = detailRes.data.document as Record<string, unknown>;
  const detailMeta = isRecord(documentDetail.generatedMeta) ? documentDetail.generatedMeta : {};
  const versions = Array.isArray(documentDetail.versions) ? documentDetail.versions : [];

  assert.ok(Number.isFinite(Number(detailMeta.qualityScore)), 'Detail response missing generatedMeta.qualityScore.');
  assert.ok(Array.isArray(detailMeta.qualityNotes) && detailMeta.qualityNotes.length > 0, 'Detail response missing quality notes.');
  assert.ok(isRecord(detailMeta.dimensionScores), 'Detail response missing dimensionScores.');
  assert.ok(Number(detailMeta.editorialPassCount) >= 2, 'Detail response missing editorialPassCount.');
  assert.ok(String(detailMeta.renderTheme || '').trim().length > 0, 'Detail response missing renderTheme.');
  assert.ok(isRecord(documentDetail.qualityReference), 'Detail response missing qualityReference.');
  assert.ok(versions.length > 0, 'Runtime document has no versions.');

  const latestVersion = (versions[0] && isRecord(versions[0]) ? versions[0] : {}) as Record<string, unknown>;
  assert.ok(String(latestVersion.contentMd || '').trim().length >= 400, 'Latest version markdown is unexpectedly thin.');

  const exportRes = await apiRequest<{ exported?: Record<string, unknown> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/documents/${artifactDocumentId}/export`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'PDF' }),
    },
    jar
  );
  assert.equal(exportRes.status, 200, `Failed to export runtime document: ${exportRes.status}`);
  assert.ok(isRecord(exportRes.data.exported), 'Runtime document export response invalid.');

  const exported = exportRes.data.exported as Record<string, unknown>;
  const exportId = String(exported.exportId || '').trim();
  const exportStoragePath = String(exported.storagePath || '').trim();
  const exportDownloadHref = String(exported.downloadHref || '').trim();
  const exportSize = Number(exported.fileSizeBytes);

  assert.ok(exportId, 'Export id missing.');
  assert.ok(exportStoragePath, 'Export storagePath missing.');
  assert.ok(exportDownloadHref, 'Export downloadHref missing.');
  assert.ok(Number.isFinite(exportSize) && exportSize > 1_000, 'Export file size is unexpectedly small.');

  const exportEvents = await waitForEvents({
    baseUrl,
    workspaceId,
    branchId,
    createdAfterMs,
    jar,
    expectedEvents: ['document.export_completed'],
  });
  assert.ok(exportEvents.length > 0, 'Expected recent runtime events after export.');

  const exportAbsPath = toAbsoluteStoragePath(exportStoragePath);
  const exportStats = await fs.stat(exportAbsPath);
  assert.ok(exportStats.isFile(), 'Exported PDF path does not point to a file.');
  assert.ok(exportStats.size >= exportSize, 'Exported PDF file size on disk is smaller than reported.');

  const detailAfterExportRes = await apiRequest<{ document?: Record<string, unknown> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/documents/${artifactDocumentId}`,
    { method: 'GET' },
    jar
  );
  assert.equal(detailAfterExportRes.status, 200, `Failed to reload runtime document detail after export: ${detailAfterExportRes.status}`);
  const exportsAfter = Array.isArray((detailAfterExportRes.data.document as Record<string, unknown>)?.exports)
    ? (((detailAfterExportRes.data.document as Record<string, unknown>).exports as unknown[]).filter(isRecord) as Record<
        string,
        unknown
      >[])
    : [];
  const matchingExport = exportsAfter.find((entry) => String(entry.id || '').trim() === exportId);
  assert.ok(matchingExport, 'Export record missing from runtime document detail.');

  console.log('[Premium Live Document Smoke] Passed.');
  console.log(
    JSON.stringify(
      {
        workspaceId,
        branchId,
        documentId: artifactDocumentId,
        artifactTitle,
        qualityScore: Math.round(artifactQualityScore),
        coverageScore: Math.round(artifactCoverageScore),
        renderTheme: artifactRenderTheme,
        exportId,
        exportStoragePath,
      },
      null,
      2
    )
  );

  const stageEventNames = new Set<string>();
  for (const row of stageEvents) {
    const payload = isRecord(row.payloadJson) ? row.payloadJson : {};
    const eventV2 = isRecord(payload.eventV2) ? payload.eventV2 : isRecord(row.eventV2) ? row.eventV2 : {};
    const eventName = String(eventV2.event || row.eventName || '').trim();
    if (eventName) stageEventNames.add(eventName);
  }
  console.log(`[Premium Live Document Smoke] Observed stages: ${Array.from(stageEventNames).sort().join(', ')}`);
}

void main().catch((error) => {
  console.error('[Premium Live Document Smoke] Failed:', error);
  process.exit(1);
});
