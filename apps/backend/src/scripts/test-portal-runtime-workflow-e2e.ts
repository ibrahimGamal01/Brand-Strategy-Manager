import assert from 'node:assert/strict';

type JsonValue = Record<string, unknown>;

class CookieJar {
  private readonly cookies = new Map<string, string>();

  set(name: string, value: string) {
    if (!name || !value) return;
    this.cookies.set(name, value);
  }

  apply(headers: Record<string, string>) {
    if (!this.cookies.size) return;
    headers.cookie = Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  readFrom(response: Response) {
    const source = response.headers as unknown as {
      getSetCookie?: () => string[];
      raw?: () => Record<string, string[]>;
    };
    const fromGetter = typeof source.getSetCookie === 'function' ? source.getSetCookie() : [];
    const fromRaw = typeof source.raw === 'function' ? source.raw()?.['set-cookie'] || [] : [];

    for (const row of [...fromGetter, ...fromRaw]) {
      const pair = String(row || '').split(';')[0] || '';
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (name && value) this.cookies.set(name, value);
    }
  }
}

async function apiRequest<T = JsonValue>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  jar: CookieJar
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (init.headers && typeof init.headers === 'object') {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  jar.apply(headers);

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  jar.readFrom(response);

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
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 60_000,
  intervalMs = 1_500
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function main() {
  const baseUrl = String(process.env.PORTAL_E2E_BASE_URL || process.env.BACKEND_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const jar = new CookieJar();
  const email = `portal.workflow.e2e.${Date.now()}@example.com`;
  const password = 'TestPass123!';

  const signup = await apiRequest<{
    workspaces?: Array<{ id?: string }>;
  }>(
    baseUrl,
    '/api/portal/auth/signup',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        fullName: 'Portal Workflow E2E',
        companyName: 'Workflow QA',
      }),
    },
    jar
  );
  assert.equal(signup.status, 201, 'Signup failed');
  const workspaceId = String(signup.data.workspaces?.[0]?.id || '');
  assert.ok(workspaceId, 'Workspace missing after signup');

  const intakeSubmit = await apiRequest<{ success?: boolean }>(
    baseUrl,
    `/api/portal/workspaces/${workspaceId}/intake`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Workflow QA',
        website: 'https://workflow-qa.example.com',
        oneSentenceDescription: 'Growth consulting for SaaS founders.',
        businessType: 'Agency',
        niche: 'SaaS Marketing',
        primaryGoal: 'Increase SQL pipeline',
        engineGoal: 'Build repeatable lead generation loop',
        handles: {
          instagram: 'workflowqa',
          twitter: 'workflowqa',
        },
      }),
    },
    jar
  );
  assert.equal(intakeSubmit.status, 200, 'Workspace intake submit failed');
  assert.equal(Boolean(intakeSubmit.data.success), true, 'Workspace intake submit should return success=true');

  const thread = await apiRequest<{
    thread?: { id?: string };
    mainBranch?: { id?: string };
  }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Portal Runtime Workflow E2E',
        createdBy: 'portal-workflow-e2e',
      }),
    },
    jar
  );
  assert.equal(thread.status, 201, 'Failed to create runtime thread');

  const threadId = String(thread.data.thread?.id || '');
  const branchId = String(thread.data.mainBranch?.id || '');
  assert.ok(threadId, 'Thread id missing');
  assert.ok(branchId, 'Branch id missing');

  const queueOne = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'queued message one',
        userId: 'workflow-e2e',
        mode: 'queue',
      }),
    },
    jar
  );
  assert.equal(queueOne.status, 202, 'Queue message one failed');

  const queueTwo = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'queued message two',
        userId: 'workflow-e2e',
        mode: 'queue',
      }),
    },
    jar
  );
  assert.equal(queueTwo.status, 202, 'Queue message two failed');

  const queuedSnapshot = await apiRequest<{ queue?: Array<{ id: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/queue`,
    { method: 'GET' },
    jar
  );
  assert.equal(queuedSnapshot.status, 200, 'Queue read failed');
  assert.equal((queuedSnapshot.data.queue || []).length, 2, 'Queue should contain two items');

  const queueIds = (queuedSnapshot.data.queue || []).map((item) => item.id);
  const reordered = await apiRequest<{ queue?: Array<{ id: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/queue/reorder`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [queueIds[1], queueIds[0]] }),
    },
    jar
  );
  assert.equal(reordered.status, 200, 'Queue reorder failed');
  assert.equal(reordered.data.queue?.[0]?.id, queueIds[1], 'Queue reorder did not apply');

  const cancelled = await apiRequest<{ queue?: Array<{ id: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/queue/${queueIds[0]}`,
    { method: 'DELETE' },
    jar
  );
  assert.equal(cancelled.status, 200, 'Queue item delete failed');
  assert.equal((cancelled.data.queue || []).length, 1, 'Queue should have one item after delete');

  const sendPrimary = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'find competitors across web social and community, then summarize',
        userId: 'workflow-e2e',
        mode: 'send',
      }),
    },
    jar
  );
  assert.equal(sendPrimary.status, 202, 'Primary send failed');

  const sendRace = await apiRequest<{ queued?: boolean }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'second message sent immediately after first',
        userId: 'workflow-e2e',
        mode: 'send',
      }),
    },
    jar
  );
  assert.equal(sendRace.status, 202, 'Race send request failed');
  assert.equal(Boolean(sendRace.data.queued), true, 'Race send should auto-queue while run is active');

  const gotAssistant = await waitFor(async () => {
    const messages = await apiRequest<{ messages?: Array<{ role?: string }> }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages?limit=200`,
      { method: 'GET' },
      jar
    );

    if (messages.status !== 200) return false;
    return (messages.data.messages || []).some((message) => String(message.role || '').toUpperCase() === 'ASSISTANT');
  }, 90_000);
  assert.equal(gotAssistant, true, 'Expected assistant response in branch');

  const queueDrained = await waitFor(async () => {
    const queue = await apiRequest<{ queue?: Array<{ id: string }> }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/queue`,
      { method: 'GET' },
      jar
    );
    if (queue.status !== 200) return false;
    return (queue.data.queue || []).length === 0;
  }, 90_000);
  assert.equal(queueDrained, true, 'Expected queued messages to auto-drain after completion');

  const messagesForFork = await apiRequest<{ messages?: Array<{ id?: string; role?: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages?limit=250`,
    { method: 'GET' },
    jar
  );
  const forkMessageId =
    (messagesForFork.data.messages || []).find((message) => String(message.role || '').toUpperCase() === 'ASSISTANT')?.id || '';
  assert.ok(forkMessageId, 'Could not locate assistant message to fork from');

  const fork = await apiRequest<{ branch?: { id?: string } }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads/${threadId}/branches`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Workflow Fork Branch',
        createdBy: 'workflow-e2e',
        forkedFromBranchId: branchId,
        forkedFromMessageId: forkMessageId,
      }),
    },
    jar
  );
  assert.equal(fork.status, 201, 'Fork branch create failed');

  const forkBranchId = String(fork.data.branch?.id || '');
  assert.ok(forkBranchId, 'Forked branch id missing');

  const pinned = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads/${threadId}/pin-branch`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branchId: forkBranchId }),
    },
    jar
  );
  assert.equal(pinned.status, 200, 'Pin branch failed');

  const startInterruptRun = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'run deep competitor and report workflow now',
        userId: 'workflow-e2e',
        mode: 'send',
      }),
    },
    jar
  );
  assert.equal(startInterruptRun.status, 202, 'Could not start run before interrupt');

  await new Promise((resolve) => setTimeout(resolve, 900));

  const interrupted = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/interrupt`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'workflow-e2e interrupt check' }),
    },
    jar
  );
  assert.equal(interrupted.status, 200, 'Interrupt endpoint failed');

  const cancelEventSeen = await waitFor(async () => {
    const events = await apiRequest<{ events?: Array<{ type?: string }> }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/events?limit=140`,
      { method: 'GET' },
      jar
    );
    if (events.status !== 200) return false;
    return (events.data.events || []).some((event) => String(event.type || '').toUpperCase() === 'PROCESS_CANCELLED');
  }, 30_000);
  assert.equal(cancelEventSeen, true, 'Expected PROCESS_CANCELLED event after interrupt');

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        workspaceId,
        branchId,
        forkBranchId,
        checks: [
          'queue_add_reorder_delete',
          'race_send_auto_queue',
          'assistant_response',
          'queue_auto_drain',
          'fork_and_pin_branch',
          'interrupt_and_cancel_event',
        ],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[PortalRuntimeWorkflowE2E] FAILED', error);
  process.exit(1);
});
