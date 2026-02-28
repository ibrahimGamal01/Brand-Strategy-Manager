import assert from 'node:assert/strict';

type JsonObject = Record<string, unknown>;

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
    const headerSource = response.headers as unknown as {
      getSetCookie?: () => string[];
      raw?: () => Record<string, string[]>;
    };

    const fromGetter = typeof headerSource.getSetCookie === 'function' ? headerSource.getSetCookie() : [];
    const fromRaw =
      typeof headerSource.raw === 'function' ? headerSource.raw()?.['set-cookie'] || [] : [];

    const all = [...fromGetter, ...fromRaw];
    for (const raw of all) {
      const pair = String(raw || '').split(';')[0] || '';
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (name && value) {
        this.cookies.set(name, value);
      }
    }
  }
}

async function apiRequest<T = JsonObject>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  jar?: CookieJar
): Promise<{ status: number; data: T }> {
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
  };
}

async function waitForAssistantMessage(baseUrl: string, workspaceId: string, branchId: string, jar: CookieJar) {
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const messages = await apiRequest<{ messages?: Array<{ role?: string }> }>(
      baseUrl,
      `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages?limit=200`,
      { method: 'GET' },
      jar
    );

    if (messages.status !== 200) {
      continue;
    }

    const hasAssistant = Array.isArray(messages.data.messages)
      ? messages.data.messages.some((message) => String(message.role || '').toUpperCase() === 'ASSISTANT')
      : false;

    if (hasAssistant) {
      return true;
    }
  }

  return false;
}

async function waitForSignupScanRun(baseUrl: string, workspaceId: string, jar: CookieJar) {
  const attempts = 12;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const diagnostics = await apiRequest<{
      scanRuns?: Array<{ workspaceId?: string; mode?: string; initiatedBy?: string; status?: string }>;
    }>(
      baseUrl,
      `/api/portal/admin/intake/scan-runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=20`,
      { method: 'GET' },
      jar
    );
    if (diagnostics.status === 403) {
      return 'forbidden' as const;
    }
    if (diagnostics.status === 200 && Array.isArray(diagnostics.data.scanRuns)) {
      const match = diagnostics.data.scanRuns.find(
        (row) =>
          String(row.workspaceId || '') === workspaceId &&
          String(row.initiatedBy || '').toUpperCase() === 'SYSTEM'
      );
      if (match) {
        return match;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

async function main() {
  const baseUrl = String(process.env.PORTAL_E2E_BASE_URL || process.env.BACKEND_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const timestamp = Date.now();
  const email = `portal.e2e.${timestamp}@example.com`;
  const password = 'TestPass123!';
  const jar = new CookieJar();

  const unauthenticatedMe = await apiRequest(baseUrl, '/api/portal/auth/me', { method: 'GET' }, jar);
  assert.equal(unauthenticatedMe.status, 401, 'Expected /auth/me to require auth before signup');

  const signup = await apiRequest<{
    ok?: boolean;
    email?: string;
    workspaceId?: string;
    requiresEmailVerification?: boolean;
    emailDelivery?: { provider?: string };
    debugVerificationCode?: string;
    debugVerificationToken?: string;
  }>(
    baseUrl,
    '/api/portal/auth/signup',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        fullName: 'Portal E2E',
        companyName: 'Portal QA',
        website: 'https://portal-qa.example.com',
        websites: ['https://www.portal-qa.example.com/about'],
      }),
    },
    jar
  );

  assert.equal(signup.status, 201, `Signup failed: ${signup.status}`);
  assert.equal(signup.data.email, email, 'Signup returned unexpected user email');
  assert.equal(Boolean(signup.data.requiresEmailVerification), true, 'Signup should require email verification');
  assert.equal(Boolean(signup.data.ok), true, 'Signup should return ok=true');
  assert.ok(signup.data.emailDelivery?.provider, 'Signup did not return email provider info');
  if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    assert.ok(
      signup.data.debugVerificationCode || signup.data.debugVerificationToken,
      'Expected debug verification details in non-production mode'
    );
  }

  const workspaceId = String(signup.data.workspaceId || '');
  assert.ok(workspaceId, 'Workspace id missing after signup');

  const meAfterSignup = await apiRequest(baseUrl, '/api/portal/auth/me', { method: 'GET' }, jar);
  assert.equal(meAfterSignup.status, 401, 'Signup should not auto-create authenticated session');

  const loginBeforeVerify = await apiRequest(
    baseUrl,
    '/api/portal/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    jar
  );
  assert.equal(loginBeforeVerify.status, 403, 'Unverified user should be blocked from login');
  assert.equal((loginBeforeVerify.data as any)?.error, 'EMAIL_NOT_VERIFIED', 'Expected EMAIL_NOT_VERIFIED before code verification');

  const resend = await apiRequest<{ debugVerificationCode?: string; debugVerificationToken?: string; alreadyVerified?: boolean }>(
    baseUrl,
    '/api/portal/auth/resend-verification',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
      }),
    },
    jar
  );
  assert.equal(resend.status, 200, 'Resend verification endpoint failed');
  assert.ok(!resend.data.alreadyVerified, 'New account should not already be verified');

  const verifyCode = await apiRequest<{ ok?: boolean }>(
    baseUrl,
    '/api/portal/auth/verify-email-code',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        code: '00000',
      }),
    },
    jar
  );
  assert.equal(verifyCode.status, 200, 'Email code verification failed');
  assert.equal(Boolean(verifyCode.data.ok), true, 'Email code verification should return ok=true');

  const login = await apiRequest<{ user?: { email?: string } }>(
    baseUrl,
    '/api/portal/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    jar
  );
  assert.equal(login.status, 200, 'Login failed after verification');
  assert.equal(login.data.user?.email, email, 'Login returned unexpected user');

  const workspaces = await apiRequest<{ workspaces?: Array<{ id?: string }> }>(
    baseUrl,
    '/api/portal/workspaces',
    { method: 'GET' },
    jar
  );
  assert.equal(workspaces.status, 200, 'Workspace listing failed');
  assert.ok(Array.isArray(workspaces.data.workspaces) && workspaces.data.workspaces.length > 0, 'Workspace listing returned empty array');

  const signupScanRun = await waitForSignupScanRun(baseUrl, workspaceId, jar);
  if (signupScanRun && signupScanRun !== 'forbidden') {
    assert.equal(String(signupScanRun?.mode || '').toLowerCase(), 'deep', 'Signup scan should run in deep mode by default');
    assert.equal(String(signupScanRun?.initiatedBy || '').toUpperCase(), 'SYSTEM', 'Signup scan should be SYSTEM initiated');
  }

  const intakeBefore = await apiRequest<{ completed?: boolean }>(
    baseUrl,
    `/api/portal/workspaces/${workspaceId}/intake`,
    { method: 'GET' },
    jar
  );
  assert.equal(intakeBefore.status, 200, 'Workspace intake status endpoint failed before setup');
  assert.equal(Boolean(intakeBefore.data.completed), false, 'New signup workspace should require intake setup');

  const intakeSuggest = await apiRequest<{ success?: boolean; suggested?: Record<string, unknown> }>(
    baseUrl,
    `/api/portal/workspaces/${workspaceId}/intake/suggest`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Portal QA',
        website: 'https://portal-qa.example.com',
        primaryGoal: 'Increase qualified leads',
      }),
    },
    jar
  );
  assert.equal(intakeSuggest.status, 200, 'Workspace intake suggest endpoint failed');
  assert.equal(Boolean(intakeSuggest.data.success), true, 'Workspace intake suggest should return success=true');
  assert.ok(
    intakeSuggest.data.suggested && Object.keys(intakeSuggest.data.suggested).length > 0,
    'Workspace intake suggest should return at least one suggested field for partial payload'
  );

  const intakeSubmit = await apiRequest<{ success?: boolean }>(
    baseUrl,
    `/api/portal/workspaces/${workspaceId}/intake`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Portal QA',
        website: 'https://portal-qa.example.com',
        oneSentenceDescription: 'Marketing strategy studio for B2B founders.',
        businessType: 'Agency',
        niche: 'B2B Marketing',
        primaryGoal: 'Increase qualified leads',
        engineGoal: 'Generate and convert qualified pipeline',
        handles: {
          instagram: 'portalqa',
          tiktok: 'portalqa',
        },
      }),
    },
    jar
  );
  assert.equal(intakeSubmit.status, 200, 'Workspace intake submit endpoint failed');
  assert.equal(Boolean(intakeSubmit.data.success), true, 'Workspace intake submit should return success=true');

  const intakeAfter = await apiRequest<{ completed?: boolean; readyForChat?: boolean }>(
    baseUrl,
    `/api/portal/workspaces/${workspaceId}/intake`,
    { method: 'GET' },
    jar
  );
  assert.equal(intakeAfter.status, 200, 'Workspace intake status endpoint failed after setup');
  assert.equal(Boolean(intakeAfter.data.completed), true, 'Workspace intake should be completed after submit');
  assert.equal(Boolean(intakeAfter.data.readyForChat), true, 'Workspace should be chat-ready after intake submit');

  const createThread = await apiRequest<{
    mainBranch?: { id?: string };
  }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/threads`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Portal E2E Thread',
        createdBy: 'portal-e2e',
      }),
    },
    jar
  );
  assert.equal(createThread.status, 201, 'Failed to create runtime thread');
  const branchId = String(createThread.data.mainBranch?.id || '');
  assert.ok(branchId, 'Runtime thread creation did not return a main branch');

  const sendMessage = await apiRequest(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'Say hello briefly and provide one safe next step.',
        userId: 'portal-e2e-user',
        mode: 'send',
      }),
    },
    jar
  );
  assert.equal(sendMessage.status, 202, 'Runtime message enqueue failed');

  const hasAssistant = await waitForAssistantMessage(baseUrl, workspaceId, branchId, jar);
  assert.equal(hasAssistant, true, 'Runtime engine did not produce an assistant reply within timeout');

  const events = await apiRequest<{ events?: Array<{ type?: string }> }>(
    baseUrl,
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/events?limit=100`,
    { method: 'GET' },
    jar
  );
  assert.equal(events.status, 200, 'Runtime event listing failed');
  const eventTypes = new Set(
    Array.isArray(events.data.events)
      ? events.data.events.map((event) => String(event.type || '').toUpperCase())
      : []
  );
  assert.ok(eventTypes.has('PROCESS_STARTED'), 'Expected PROCESS_STARTED event');

  const logout = await apiRequest(baseUrl, '/api/portal/auth/logout', { method: 'POST' }, jar);
  assert.equal(logout.status, 200, 'Logout failed');

  const meAfterLogout = await apiRequest(baseUrl, '/api/portal/auth/me', { method: 'GET' }, jar);
  assert.equal(meAfterLogout.status, 401, 'Session should be revoked after logout');

  const relogin = await apiRequest<{ user?: { email?: string } }>(
    baseUrl,
    '/api/portal/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    jar
  );
  assert.equal(relogin.status, 200, 'Login failed');
  assert.equal(relogin.data.user?.email, email, 'Login returned unexpected user');

  const meAfterLogin = await apiRequest(baseUrl, '/api/portal/auth/me', { method: 'GET' }, jar);
  assert.equal(meAfterLogin.status, 200, 'Session should be restored after login');

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        workspaceId,
        branchId,
        emailProvider: signup.data.emailDelivery?.provider || 'unknown',
        checks: [
          'auth_required_before_signup',
          'signup_creates_workspace_without_session',
          'login_blocked_until_email_verified',
          'resend_verification_prelogin',
          'verify_email_code',
          'login_after_verification',
          'signup_deep_scan_system_initiated',
          'workspace_intake_status_suggest_submit_after_login',
          'workspace_access',
          'runtime_thread_and_message',
          'runtime_event_stream',
          'logout_revokes_session',
          'login_restores_session',
        ],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[PortalAuthRuntimeE2E] FAILED', error);
  process.exit(1);
});
