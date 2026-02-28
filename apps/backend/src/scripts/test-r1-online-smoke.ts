import assert from 'node:assert/strict';

type JsonObject = Record<string, unknown>;

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

async function apiRequest<T = JsonObject>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  jar?: CookieJar
): Promise<{ status: number; data: T; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (init.headers && typeof init.headers === 'object') {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  jar?.apply(headers);

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  jar?.readFrom(response);
  const text = await response.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : {}) as T;
  } catch {
    data = { raw: text } as T;
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function boolEnv(name: string): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

async function readSseEvents(
  baseUrl: string,
  path: string,
  jar: CookieJar,
  options?: { timeoutMs?: number; maxEvents?: number }
): Promise<Array<Record<string, unknown>>> {
  const timeoutMs = Math.max(1_000, Number(options?.timeoutMs || 8_000));
  const maxEvents = Math.max(1, Number(options?.maxEvents || 2));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {};
    jar.apply(headers);
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    jar.readFrom(response);
    if (!response.ok || !response.body) return [];

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events: Array<Record<string, unknown>> = [];

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        const typeLine = lines.find((line) => line.startsWith('event:'));
        const dataLine = lines.find((line) => line.startsWith('data:'));
        if (!typeLine || !dataLine) continue;
        const eventType = typeLine.slice('event:'.length).trim();
        if (eventType !== 'intake_event') continue;
        const dataRaw = dataLine.slice('data:'.length).trim();
        try {
          const parsed = JSON.parse(dataRaw) as Record<string, unknown>;
          events.push(parsed);
          if (events.length >= maxEvents) break;
        } catch {
          // ignore malformed payload lines
        }
      }
    }

    return events;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function waitForTerminalScanRun(
  baseUrl: string,
  workspaceId: string,
  scanRunId: string,
  jar: CookieJar,
  timeoutMs = 120_000
): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await apiRequest<{ scanRun?: Record<string, unknown> }>(
      baseUrl,
      `/api/portal/workspaces/${workspaceId}/intake/websites/scan-runs/${scanRunId}`,
      { method: 'GET' },
      jar
    );
    if (run.status !== 200 || !run.data.scanRun) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    const status = String(run.data.scanRun.status || '').toUpperCase();
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      return run.data.scanRun;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for terminal scan status (run=${scanRunId}).`);
}

async function waitForAssistantMessage(
  baseUrl: string,
  workspaceId: string,
  branchId: string,
  jar: CookieJar,
  createdAfterIso: string,
  timeoutMs = 120_000
): Promise<string> {
  const started = Date.now();
  const blockedPhrases = [
    /tool execution trace/i,
    /validation note/i,
    /no tools executed in this run/i,
    /fork from here/i,
    /how bat got here/i,
  ];

  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const messages = await apiRequest<{
      messages?: Array<{ role?: string; content?: string; createdAt?: string }>;
    }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages?limit=220`,
      { method: 'GET' },
      jar
    );

    if (messages.status !== 200 || !Array.isArray(messages.data.messages)) continue;
    const createdAfterMs = Date.parse(createdAfterIso);
    const latestAssistant = [...messages.data.messages]
      .reverse()
      .find((entry) => {
        if (String(entry.role || '').toUpperCase() !== 'ASSISTANT') return false;
        const createdAtMs = Date.parse(String(entry.createdAt || ''));
        return Number.isFinite(createdAtMs) && createdAtMs >= createdAfterMs;
      });

    if (!latestAssistant?.content) continue;
    for (const pattern of blockedPhrases) {
      assert.ok(!pattern.test(latestAssistant.content), `Blocked meta phrase found in assistant output: ${pattern}`);
    }
    return latestAssistant.content;
  }

  throw new Error('Timed out waiting for assistant reply in runtime branch.');
}

async function main() {
  const baseUrl = String(process.env.R1_BASE_URL || process.env.PORTAL_E2E_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const adminEmail = requiredEnv('R1_ADMIN_EMAIL');
  const adminPassword = requiredEnv('R1_ADMIN_PASSWORD');
  const workspaceId = requiredEnv('R1_WORKSPACE_ID');
  const scanWebsite = String(process.env.R1_TEST_SCAN_URL || 'https://example.com').trim();
  const skipAdminDiagnostics = boolEnv('R1_SKIP_ADMIN_DIAGNOSTICS');

  const jar = new CookieJar();

  const login = await apiRequest<{ user?: { id?: string; isAdmin?: boolean } }>(
    baseUrl,
    '/api/portal/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
      }),
    },
    jar
  );
  assert.equal(login.status, 200, `Admin login failed: ${login.status}`);
  const isAdmin = Boolean(login.data.user?.isAdmin);
  if (!skipAdminDiagnostics) {
    assert.equal(isAdmin, true, 'R1 online smoke requires admin account unless R1_SKIP_ADMIN_DIAGNOSTICS=true.');
  }

  const workspaceStatus = await apiRequest(baseUrl, `/api/portal/workspaces/${workspaceId}/intake`, { method: 'GET' }, jar);
  assert.equal(workspaceStatus.status, 200, 'Workspace access/intake status failed.');

  const scanStart = await apiRequest<{ scanRunId?: string; status?: string }>(
    baseUrl,
    `/api/portal/workspaces/${workspaceId}/intake/websites/scan`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        websites: [scanWebsite],
        mode: 'quick',
      }),
    },
    jar
  );
  assert.equal(scanStart.status, 202, `Scan start failed: ${scanStart.status}`);
  assert.equal(String(scanStart.data.status || '').toLowerCase(), 'accepted', 'Scan response must be accepted.');
  const scanRunId = String(scanStart.data.scanRunId || '').trim();
  assert.ok(scanRunId, 'scanRunId is missing from scan start response.');

  const sseEvents = await readSseEvents(
    baseUrl,
    `/api/portal/workspaces/${workspaceId}/intake/events?scanRunId=${encodeURIComponent(scanRunId)}&afterId=0`,
    jar,
    { timeoutMs: 8_000, maxEvents: 2 }
  );
  assert.ok(sseEvents.length > 0, 'Expected at least one intake SSE event for scanRunId.');
  assert.ok(
    sseEvents.some((event) => String(event.scanRunId || '') === scanRunId),
    'SSE stream did not include the target scanRunId.'
  );

  const terminalRun = await waitForTerminalScanRun(baseUrl, workspaceId, scanRunId, jar);
  const terminalStatus = String(terminalRun.status || '').toUpperCase();
  assert.ok(
    terminalStatus === 'COMPLETED' || terminalStatus === 'FAILED' || terminalStatus === 'CANCELLED',
    `Unexpected terminal scan status: ${terminalStatus}`
  );
  assert.ok(typeof terminalRun.targetsCompleted === 'number', 'Scan run summary missing targetsCompleted.');

  const threads = await apiRequest<{
    threads?: Array<{ id?: string; pinnedBranchId?: string; branches?: Array<{ id?: string }> }>;
  }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads`,
    { method: 'GET' },
    jar
  );
  assert.equal(threads.status, 200, 'Runtime thread listing failed.');
  let firstThread = Array.isArray(threads.data.threads) ? threads.data.threads[0] : null;
  let branchId = String(firstThread?.pinnedBranchId || firstThread?.branches?.[0]?.id || '').trim();

  if (!branchId) {
    const createdThread = await apiRequest<{
      thread?: { id?: string; pinnedBranchId?: string; branches?: Array<{ id?: string }> };
    }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/threads`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Main workspace thread',
          createdBy: 'r1-online-smoke',
        }),
      },
      jar
    );
    assert.equal(createdThread.status, 201, 'Failed to create runtime thread for smoke test.');
    firstThread = createdThread.data.thread || null;
    branchId = String(firstThread?.pinnedBranchId || firstThread?.branches?.[0]?.id || '').trim();
  }
  assert.ok(branchId, 'No runtime branch id available for cursor/output checks.');

  const eventsInitial = await apiRequest<{ events?: Array<{ eventSeq?: string; id?: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/events?limit=40`,
    { method: 'GET' },
    jar
  );
  assert.equal(eventsInitial.status, 200, 'Runtime events listing failed.');
  const latestCursor = Array.isArray(eventsInitial.data.events) ? eventsInitial.data.events[eventsInitial.data.events.length - 1] : null;
  const afterSeq = String(latestCursor?.eventSeq || '').trim();

  if (afterSeq) {
    const eventsAfterSeq = await apiRequest<{ events?: Array<{ eventSeq?: string }> }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/events?afterSeq=${encodeURIComponent(afterSeq)}&limit=40`,
      { method: 'GET' },
      jar
    );
    assert.equal(eventsAfterSeq.status, 200, 'Runtime events afterSeq query failed.');
    const returned = Array.isArray(eventsAfterSeq.data.events) ? eventsAfterSeq.data.events : [];
    for (const event of returned) {
      const seq = Number(String(event.eventSeq || '').trim());
      const baseline = Number(afterSeq);
      if (Number.isFinite(seq) && Number.isFinite(baseline)) {
        assert.ok(seq > baseline, 'afterSeq cursor returned non-forward event ordering.');
      }
    }
  }

  const sendAt = new Date().toISOString();
  const send = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: `R1 online smoke (${Date.now()}): provide a grounded response from workspace context.`,
        userId: 'r1-online-smoke',
        mode: 'send',
      }),
    },
    jar
  );
  assert.ok(send.status === 200 || send.status === 202, `Runtime send failed: ${send.status}`);
  await waitForAssistantMessage(baseUrl, workspaceId, branchId, jar, sendAt, 140_000);

  if (skipAdminDiagnostics && !isAdmin) {
    console.log('[R1 Online Smoke] Skipping admin diagnostics check (non-admin session).');
  } else {
    const diagnostics = await apiRequest<{
      diagnostics?: { counters?: Record<string, unknown> };
      scanRuns?: Array<Record<string, unknown>>;
    }>(
      baseUrl,
      `/api/portal/admin/intake/scan-runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=10`,
      { method: 'GET' },
      jar
    );
    assert.equal(diagnostics.status, 200, 'Admin scan diagnostics endpoint failed.');
    assert.ok(diagnostics.data.diagnostics && typeof diagnostics.data.diagnostics === 'object', 'Missing diagnostics object.');
    assert.ok(
      diagnostics.data.diagnostics?.counters && typeof diagnostics.data.diagnostics.counters === 'object',
      'Missing diagnostics counters.'
    );
    assert.ok(Array.isArray(diagnostics.data.scanRuns), 'Diagnostics response missing scanRuns array.');
  }

  console.log('[R1 Online Smoke] Passed.');
}

void main().catch((error) => {
  console.error('[R1 Online Smoke] Failed:', error);
  process.exit(1);
});
