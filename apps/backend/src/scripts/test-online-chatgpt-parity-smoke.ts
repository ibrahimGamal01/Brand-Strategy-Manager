import assert from 'node:assert/strict';

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
  path: string,
  init: RequestInit,
  jar?: CookieJar,
  timeoutMs = 60_000
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (init.headers && typeof init.headers === 'object') {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  jar?.apply(headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  const response = await fetch(`${baseUrl}${path}`, {
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
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
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
        body: JSON.stringify({ title: `ChatGPT parity smoke ${Date.now()}` }),
      },
      jar
    );
    assert.equal(createRes.status, 201, `Failed to create runtime thread: ${createRes.status}`);
    threadId = String(createRes.data.thread?.id || '').trim();
    pinnedBranchId = String(createRes.data.branch?.id || '').trim();
  }

  assert.ok(threadId, 'No runtime thread available.');

  if (pinnedBranchId) {
    return pinnedBranchId;
  }

  const threadRes = await apiRequest<{ branches?: Array<{ id?: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads/${threadId}`,
    { method: 'GET' },
    jar
  );
  assert.equal(threadRes.status, 200, `Failed to load thread detail: ${threadRes.status}`);
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
}): Promise<{ assistantContent: string; artifact: Record<string, unknown> }> {
  const timeoutMs = Math.max(60_000, Number(input.timeoutMs || 240_000));
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
      assert.ok(!/\/document\.generate/i.test(assistantContent), 'Assistant content leaked slash command text.');

      return {
        assistantContent,
        artifact,
      };
    }
  }

  throw new Error('Timed out waiting for assistant message with document_artifact block.');
}

async function waitForLoopStageEvents(input: {
  baseUrl: string;
  workspaceId: string;
  branchId: string;
  createdAfterMs: number;
  jar: CookieJar;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = Math.max(30_000, Number(input.timeoutMs || 180_000));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const eventsRes = await apiRequest<{ events?: Array<Record<string, unknown>> }>(
      input.baseUrl,
      `/api/research-jobs/${input.workspaceId}/runtime/branches/${input.branchId}/events?limit=220`,
      { method: 'GET' },
      input.jar
    );
    if (eventsRes.status !== 200 || !Array.isArray(eventsRes.data.events)) continue;
    const recent = eventsRes.data.events.filter((row) => {
      const createdAt = Date.parse(String(row.createdAt || ''));
      return Number.isFinite(createdAt) && createdAt >= input.createdAfterMs;
    });
    const markers = new Set<string>();
    let hasMethodFamilyMeta = false;
    for (const row of recent) {
      const payload = isRecord(row.payloadJson) ? row.payloadJson : {};
      const eventV2 = isRecord(payload.eventV2) ? payload.eventV2 : isRecord(row.eventV2) ? row.eventV2 : {};
      const event = String(eventV2.event || '').trim().toLowerCase();
      if (!event) continue;
      markers.add(event);
      if (event === 'run.stage_searching') {
        const methodFamily = String(payload.methodFamily || '').trim();
        if (methodFamily) hasMethodFamilyMeta = true;
      }
    }
    const expected = ['run.stage_searching', 'run.stage_thinking', 'run.stage_building', 'run.stage_validating'];
    if (expected.every((event) => markers.has(event)) && hasMethodFamilyMeta) {
      return;
    }
  }
  throw new Error('Timed out waiting for progressive loop stage events with methodFamily metadata.');
}

async function main() {
  const baseUrl = String(
    process.env.CHATGPT_PARITY_BASE_URL ||
      process.env.PORTAL_E2E_BASE_URL ||
      process.env.R1_BASE_URL ||
      'http://localhost:3001'
  ).replace(/\/+$/, '');
  const email = requiredEnv('R1_ADMIN_EMAIL');
  const password = requiredEnv('R1_ADMIN_PASSWORD');
  const workspaceId = requiredEnv('R1_WORKSPACE_ID');

  const jar = new CookieJar();

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

  const prompt = `SWOT please for this workspace. Run in deep/pro mode, show your sectioned analysis, and output a PDF artifact. (chatgpt-parity-smoke-${Date.now()})`;
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
  assert.ok(sendRes.data.runId || sendRes.data.queued, 'Expected run start or queue acknowledgement.');

  const { assistantContent, artifact } = await waitForArtifactMessage({
    baseUrl,
    workspaceId,
    branchId,
    createdAfterMs,
    jar,
  });

  assert.ok(assistantContent.length >= 180, 'Assistant markdown content is unexpectedly short.');
  assert.ok(
    /##\s+What I searched/i.test(assistantContent) &&
      /##\s+What I found/i.test(assistantContent) &&
      /##\s+Synthesis/i.test(assistantContent) &&
      /##\s+Scenarios and tradeoffs/i.test(assistantContent) &&
      /##\s+Recommendations/i.test(assistantContent) &&
      /##\s+Next loop \/ next actions/i.test(assistantContent),
    'Deep/pro response is missing required section headers.'
  );

  const artifactTitle = String(artifact.title || '').trim();
  const artifactStorage = String(artifact.storagePath || '').trim();
  const artifactPreview = String(artifact.previewHref || artifact.downloadHref || '').trim();
  const artifactDocumentId = String(artifact.documentId || '').trim();

  assert.ok(artifactTitle.length > 2, 'Artifact title missing in document_artifact block.');
  assert.ok(artifactStorage || artifactPreview, 'Artifact path/href missing in document_artifact block.');

  const docsRes = await apiRequest<{ documents?: Array<Record<string, unknown>> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/documents?limit=40`,
    { method: 'GET' },
    jar
  );
  assert.equal(docsRes.status, 200, `Failed to list runtime documents: ${docsRes.status}`);
  assert.ok(Array.isArray(docsRes.data.documents), 'Runtime documents response invalid.');

  if (artifactDocumentId) {
    const found = (docsRes.data.documents || []).some((doc) => String(doc.id || '').trim() === artifactDocumentId);
    assert.ok(found, `Artifact documentId ${artifactDocumentId} not found in runtime docs list.`);
  }

  await waitForLoopStageEvents({
    baseUrl,
    workspaceId,
    branchId,
    createdAfterMs,
    jar,
  });

  console.log('[Online ChatGPT Parity Smoke] Passed.');
  console.log(
    JSON.stringify(
      {
        workspaceId,
        branchId,
        artifactTitle,
        artifactDocumentId: artifactDocumentId || null,
        artifactPath: artifactPreview || artifactStorage,
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error('[Online ChatGPT Parity Smoke] Failed:', error);
  process.exit(1);
});
