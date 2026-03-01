import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer';

const execFileAsync = promisify(execFile);

const REQUIRED_ENV_KEYS = [
  'PORTAL_EMAIL_VERIFY_CODE',
  'PORTAL_SIGNUP_SCAN_MODE',
  'PORTAL_SIGNUP_DDG_ENABLED',
] as const;

type CheckResult = {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
  error?: string;
};

type CookieHeaderResponse = Response & {
  headers: Response['headers'] & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };
};

function getBaseUrls() {
  const backendBaseUrl = String(
    process.env.BACKEND_BASE_URL || process.env.PORTAL_E2E_BASE_URL || 'http://localhost:3001'
  ).replace(/\/+$/, '');
  const portalBaseUrl = String(process.env.PORTAL_UI_E2E_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return { backendBaseUrl, portalBaseUrl };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getSetCookieHeaders(response: CookieHeaderResponse): string[] {
  const fromGetter = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const fromRaw = typeof response.headers.raw === 'function' ? response.headers.raw()?.['set-cookie'] || [] : [];
  return [...fromGetter, ...fromRaw];
}

function buildCookieHeaderFromSetCookies(setCookies: string[]): string {
  return setCookies
    .map((row) => String(row || '').split(';')[0] || '')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .join('; ');
}

async function runGitCheck(repoRoot: string): Promise<CheckResult> {
  try {
    const [{ stdout: branchRaw }, { stdout: shaRaw }, { stdout: dirtyRaw }] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: repoRoot }),
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: repoRoot }),
    ]);

    const branch = branchRaw.trim();
    const headSha = shaRaw.trim();
    const dirty = dirtyRaw
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const inCi = String(process.env.CI || '').toLowerCase() === 'true';

    const errors: string[] = [];
    if (!branch) errors.push('Unable to resolve current branch.');
    if (!headSha) errors.push('Unable to resolve HEAD SHA.');
    if (inCi && branch !== 'main') errors.push(`Expected branch main in CI, received ${branch || 'unknown'}.`);
    if (inCi && dirty.length > 0) errors.push(`Expected clean git tree in CI, found ${dirty.length} dirty file(s).`);

    return {
      name: 'git_state_sanity',
      ok: errors.length === 0,
      ...(errors.length ? { error: errors.join(' ') } : {}),
      details: {
        branch,
        headSha,
        dirtyFiles: dirty.length,
        inCi,
      },
    };
  } catch (error) {
    return {
      name: 'git_state_sanity',
      ok: false,
      error: toErrorMessage(error),
    };
  }
}

function runEnvCheck(): CheckResult {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !String(process.env[key] || '').trim());
  return {
    name: 'required_env_keys',
    ok: missing.length === 0,
    ...(missing.length ? { error: `Missing required env keys: ${missing.join(', ')}` } : {}),
    details: {
      required: [...REQUIRED_ENV_KEYS],
      missing,
    },
  };
}

function runAliasCheck(portalBaseUrl: string): CheckResult {
  const checkName = 'portal_alias_match';
  const expectedHost = String(
    process.env.PORTAL_UI_CANONICAL_ALIAS_HOST || 'client-portal-khaki-one.vercel.app'
  ).trim();
  const inCi = String(process.env.CI || '').toLowerCase() === 'true';
  const requireAlias = inCi || String(process.env.PORTAL_REQUIRE_ALIAS_MATCH || '').toLowerCase() === 'true';

  try {
    const actualHost = new URL(portalBaseUrl).host;
    const ok = !requireAlias || actualHost === expectedHost;
    return {
      name: checkName,
      ok,
      ...(ok
        ? {}
        : {
            error: `Portal alias mismatch: expected ${expectedHost}, got ${actualHost}`,
          }),
      details: {
        expectedHost,
        actualHost,
        requireAlias,
      },
    };
  } catch (error) {
    return {
      name: checkName,
      ok: false,
      error: `Invalid portal base URL (${portalBaseUrl}): ${toErrorMessage(error)}`,
    };
  }
}

async function runHealthCheck(backendBaseUrl: string): Promise<CheckResult> {
  const checkName = 'backend_health_readiness';
  try {
    const response = await fetch(`${backendBaseUrl}/api/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      return {
        name: checkName,
        ok: false,
        error: `Health endpoint returned HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const schemaReady = Boolean(payload.schemaReady);
    const portalAuth = payload.portalAuth as Record<string, unknown> | undefined;
    const portalEnrichment = payload.portalEnrichment as Record<string, unknown> | undefined;
    const hasPortalAuth = Boolean(portalAuth && typeof portalAuth.verifyCodeConfigured === 'boolean');
    const hasPortalEnrichment = Boolean(
      portalEnrichment && typeof portalEnrichment.ddgEnabled === 'boolean' && typeof portalEnrichment.signupScanMode === 'string'
    );

    const errors: string[] = [];
    if (!schemaReady) errors.push('schemaReady=false');
    if (!hasPortalAuth) errors.push('portalAuth readiness flags missing');
    if (!hasPortalEnrichment) errors.push('portalEnrichment readiness flags missing');

    return {
      name: checkName,
      ok: errors.length === 0,
      ...(errors.length ? { error: errors.join('; ') } : {}),
      details: {
        status: payload.status,
        schemaReady,
        portalAuth,
        portalEnrichment,
      },
    };
  } catch (error) {
    return {
      name: checkName,
      ok: false,
      error: toErrorMessage(error),
    };
  }
}

async function runSignupHydrationCheck(portalBaseUrl: string): Promise<CheckResult> {
  const checkName = 'portal_signup_hydration';
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const consoleErrors: string[] = [];
  const failedResponses: Array<{ status: number; url: string }> = [];

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push({ status: response.status(), url: response.url() });
      }
    });

    await page.goto(`${portalBaseUrl}/signup`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body');
    await page.waitForFunction(
      () => {
        const text = document.body.innerText || '';
        return /Create your BAT workspace/i.test(text) || /Checking session/i.test(text);
      },
      { timeout: 45_000 }
    );

    await page.waitForSelector('input[autocomplete="name"]', { timeout: 45_000 });
    await page.waitForSelector('input[autocomplete="email"]', { timeout: 45_000 });
    await page.waitForSelector('input[autocomplete="url"]', { timeout: 45_000 });
    await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 45_000 });

    return {
      name: checkName,
      ok: true,
      details: {
        checkedUrl: page.url(),
        consoleErrorCount: consoleErrors.length,
        httpErrorCount: failedResponses.length,
      },
    };
  } catch (error) {
    const page = (await browser.pages())[0];
    let signupSnippet = '';
    if (page) {
      signupSnippet = await page.evaluate(() => {
        const root =
          document.querySelector('form') || document.querySelector('[data-testid="signup-root"]') || document.body;
        const text = root?.textContent || '';
        return text.replace(/\s+/g, ' ').trim().slice(0, 500);
      });
    }

    return {
      name: checkName,
      ok: false,
      error: toErrorMessage(error),
      details: {
        checkedUrl: page?.url() || `${portalBaseUrl}/signup`,
        consoleErrors: consoleErrors.slice(0, 8),
        failedResponses: failedResponses.slice(0, 10),
        signupSnippet,
      },
    };
  } finally {
    await browser.close();
  }
}

async function runAuthContractCheck(backendBaseUrl: string): Promise<CheckResult> {
  const checkName = 'auth_contract_verify_code_and_unverified_login';
  const email = `portal.preflight.${Date.now()}@example.com`;
  const password = 'GuardrailPass123!';

  try {
    const signupResponse = (await fetch(`${backendBaseUrl}/api/portal/auth/signup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        fullName: 'Portal Guardrail',
        companyName: 'Guardrail QA',
        website: 'https://guardrail.example.com',
      }),
    })) as CookieHeaderResponse;

    const signupPayload = (await signupResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (signupResponse.status !== 201) {
      return {
        name: checkName,
        ok: false,
        error: `Signup failed with status ${signupResponse.status}`,
        details: { signupPayload },
      };
    }

    const cookies = getSetCookieHeaders(signupResponse);
    const sessionCookieSet = cookies.some((cookie) => /\bportal_session=/i.test(cookie));

    const verifyWrongCodeResponse = await fetch(`${backendBaseUrl}/api/portal/auth/verify-email-code`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        code: '11111',
      }),
    });
    const verifyWrongPayload = (await verifyWrongCodeResponse.json().catch(() => ({}))) as Record<string, unknown>;

    const loginResponse = await fetch(`${backendBaseUrl}/api/portal/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const loginPayload = (await loginResponse.json().catch(() => ({}))) as Record<string, unknown>;

    const verifyEndpointAvailable = verifyWrongCodeResponse.status !== 404;
    const verifyRejectsInvalidCode =
      verifyWrongCodeResponse.status === 401 && String(verifyWrongPayload.error || '') === 'INVALID_VERIFICATION_CODE';
    const loginBlocked =
      loginResponse.status === 403 && String(loginPayload.error || '') === 'EMAIL_NOT_VERIFIED';

    // Dirty-session regression: ensure signup clears/revokes an already-authenticated portal session.
    const dirtyPrimaryEmail = `portal.preflight.primary.${Date.now()}@example.com`;
    const dirtySecondaryEmail = `portal.preflight.secondary.${Date.now()}@example.com`;
    const dirtyPassword = 'GuardrailPass123!';

    const dirtyPrimarySignup = (await fetch(`${backendBaseUrl}/api/portal/auth/signup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        email: dirtyPrimaryEmail,
        password: dirtyPassword,
        fullName: 'Portal Guardrail Primary',
        companyName: 'Guardrail QA',
        website: 'https://guardrail-primary.example.com',
      }),
    })) as CookieHeaderResponse;
    const dirtyPrimarySignupPayload = (await dirtyPrimarySignup.json().catch(() => ({}))) as Record<string, unknown>;

    const dirtyPrimaryVerify = await fetch(`${backendBaseUrl}/api/portal/auth/verify-email-code`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        email: dirtyPrimaryEmail,
        code: '00000',
      }),
    });
    const dirtyPrimaryVerifyPayload = (await dirtyPrimaryVerify.json().catch(() => ({}))) as Record<string, unknown>;

    const dirtyPrimaryLogin = (await fetch(`${backendBaseUrl}/api/portal/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ email: dirtyPrimaryEmail, password: dirtyPassword }),
    })) as CookieHeaderResponse;
    const dirtyPrimaryLoginPayload = (await dirtyPrimaryLogin.json().catch(() => ({}))) as Record<string, unknown>;
    const dirtyLoginCookieHeader = buildCookieHeaderFromSetCookies(getSetCookieHeaders(dirtyPrimaryLogin));

    const dirtyMeBefore = await fetch(`${backendBaseUrl}/api/portal/auth/me`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(dirtyLoginCookieHeader ? { cookie: dirtyLoginCookieHeader } : {}),
      },
    });

    const dirtySecondarySignup = (await fetch(`${backendBaseUrl}/api/portal/auth/signup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(dirtyLoginCookieHeader ? { cookie: dirtyLoginCookieHeader } : {}),
      },
      body: JSON.stringify({
        email: dirtySecondaryEmail,
        password: dirtyPassword,
        fullName: 'Portal Guardrail Secondary',
        companyName: 'Guardrail QA',
        website: 'https://guardrail-secondary.example.com',
      }),
    })) as CookieHeaderResponse;
    const dirtySecondarySignupPayload = (await dirtySecondarySignup.json().catch(() => ({}))) as Record<string, unknown>;

    const dirtyMeAfterSecondarySignup = await fetch(`${backendBaseUrl}/api/portal/auth/me`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(dirtyLoginCookieHeader ? { cookie: dirtyLoginCookieHeader } : {}),
      },
    });

    const dirtySecondaryLoginBeforeVerify = await fetch(`${backendBaseUrl}/api/portal/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ email: dirtySecondaryEmail, password: dirtyPassword }),
    });
    const dirtySecondaryLoginBeforeVerifyPayload = (await dirtySecondaryLoginBeforeVerify.json().catch(
      () => ({})
    )) as Record<string, unknown>;

    const errors: string[] = [];
    if (sessionCookieSet) errors.push('Signup unexpectedly set portal_session cookie.');
    if (!verifyEndpointAvailable) errors.push('verify-email-code endpoint returned 404.');
    if (!verifyRejectsInvalidCode) {
      errors.push(
        `verify-email-code invalid-code contract failed (status=${verifyWrongCodeResponse.status}, error=${String(
          verifyWrongPayload.error || ''
        ) || 'n/a'})`
      );
    }
    if (!loginBlocked) {
      errors.push(
        `login contract failed for unverified user (status=${loginResponse.status}, error=${String(loginPayload.error || '') || 'n/a'})`
      );
    }
    if (dirtyPrimarySignup.status !== 201 || !Boolean(dirtyPrimarySignupPayload.ok)) {
      errors.push(`Dirty-session primary signup failed (status=${dirtyPrimarySignup.status}).`);
    }
    if (dirtyPrimaryVerify.status !== 200 || !Boolean(dirtyPrimaryVerifyPayload.ok)) {
      errors.push(`Dirty-session primary verify failed (status=${dirtyPrimaryVerify.status}).`);
    }
    if (dirtyPrimaryLogin.status !== 200 || String((dirtyPrimaryLoginPayload.user as Record<string, unknown> | undefined)?.email || '') !== dirtyPrimaryEmail) {
      errors.push(`Dirty-session primary login failed (status=${dirtyPrimaryLogin.status}).`);
    }
    if (!dirtyLoginCookieHeader) {
      errors.push('Dirty-session primary login did not return a session cookie header.');
    }
    if (dirtyMeBefore.status !== 200) {
      errors.push(`Dirty-session /auth/me before secondary signup expected 200, got ${dirtyMeBefore.status}.`);
    }
    if (dirtySecondarySignup.status !== 201 || !Boolean(dirtySecondarySignupPayload.ok)) {
      errors.push(`Dirty-session secondary signup failed (status=${dirtySecondarySignup.status}).`);
    }
    if (dirtyMeAfterSecondarySignup.status !== 401) {
      errors.push(
        `Dirty-session secondary signup did not clear prior auth session (/auth/me status=${dirtyMeAfterSecondarySignup.status}).`
      );
    }
    if (
      dirtySecondaryLoginBeforeVerify.status !== 403 ||
      String(dirtySecondaryLoginBeforeVerifyPayload.error || '') !== 'EMAIL_NOT_VERIFIED'
    ) {
      errors.push(
        `Dirty-session secondary user should remain unverified (status=${dirtySecondaryLoginBeforeVerify.status}, error=${String(
          dirtySecondaryLoginBeforeVerifyPayload.error || ''
        ) || 'n/a'}).`
      );
    }

    return {
      name: checkName,
      ok: errors.length === 0,
      ...(errors.length ? { error: errors.join(' ') } : {}),
      details: {
        signupStatus: signupResponse.status,
        requiresEmailVerification: Boolean(signupPayload.requiresEmailVerification),
        sessionCookieSet,
        verifyWrongCodeStatus: verifyWrongCodeResponse.status,
        verifyWrongCodeError: verifyWrongPayload.error,
        loginStatus: loginResponse.status,
        loginError: loginPayload.error,
        dirtySession: {
          primarySignupStatus: dirtyPrimarySignup.status,
          primaryVerifyStatus: dirtyPrimaryVerify.status,
          primaryLoginStatus: dirtyPrimaryLogin.status,
          meBeforeSecondarySignupStatus: dirtyMeBefore.status,
          secondarySignupStatus: dirtySecondarySignup.status,
          meAfterSecondarySignupStatus: dirtyMeAfterSecondarySignup.status,
          secondaryLoginBeforeVerifyStatus: dirtySecondaryLoginBeforeVerify.status,
          secondaryLoginBeforeVerifyError: dirtySecondaryLoginBeforeVerifyPayload.error,
        },
      },
    };
  } catch (error) {
    return {
      name: checkName,
      ok: false,
      error: toErrorMessage(error),
    };
  }
}

async function main() {
  const repoRoot = process.cwd();
  const { backendBaseUrl, portalBaseUrl } = getBaseUrls();

  const checks: CheckResult[] = [];
  checks.push(await runGitCheck(repoRoot));
  checks.push(runEnvCheck());
  checks.push(runAliasCheck(portalBaseUrl));
  checks.push(await runHealthCheck(backendBaseUrl));
  checks.push(await runSignupHydrationCheck(portalBaseUrl));
  checks.push(await runAuthContractCheck(backendBaseUrl));

  const ok = checks.every((check) => check.ok);
  const summary = {
    ok,
    timestamp: new Date().toISOString(),
    backendBaseUrl,
    portalBaseUrl,
    checks,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  const summary = {
    ok: false,
    timestamp: new Date().toISOString(),
    checks: [
      {
        name: 'readiness_script',
        ok: false,
        error: toErrorMessage(error),
      },
    ],
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
});
