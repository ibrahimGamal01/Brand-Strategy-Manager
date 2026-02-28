import assert from 'node:assert/strict';

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
      if (name && value) this.cookies.set(name, value);
    }
  }
}

async function apiRequest<T = Record<string, unknown>>(
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
  return { status: response.status, data };
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function threshold(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.floor(raw));
}

async function main() {
  const baseUrl = String(process.env.R1_BASE_URL || process.env.PORTAL_E2E_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const adminEmail = requiredEnv('R1_ADMIN_EMAIL');
  const adminPassword = requiredEnv('R1_ADMIN_PASSWORD');
  const workspaceId = requiredEnv('R1_WORKSPACE_ID');
  const limit = Math.max(1, Math.min(200, Number(process.env.R1_CUTOVER_REPORT_LIMIT || 50)));

  const maxDbWriteFailure = threshold('R1_MAX_DB_WRITE_FAILURE', 0);
  const maxDbReadFailure = threshold('R1_MAX_DB_READ_FAILURE', 0);
  const maxDbFallback = threshold('R1_MAX_DB_FALLBACK_TO_MEMORY', 0);
  const maxFallbackWarnings = threshold('R1_MAX_FALLBACK_WARNINGS', 0);

  const jar = new CookieJar();

  const login = await apiRequest<{ user?: { isAdmin?: boolean } }>(
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
  assert.equal(Boolean(login.data.user?.isAdmin), true, 'Cutover report requires admin access.');

  const diagnostics = await apiRequest<{
    diagnostics?: {
      mode?: string;
      counters?: Record<string, unknown>;
      fallbackWarningIntervalMs?: number;
    };
    scanRuns?: Array<Record<string, unknown>>;
  }>(
    baseUrl,
    `/api/portal/admin/intake/scan-runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=${limit}`,
    { method: 'GET' },
    jar
  );
  assert.equal(diagnostics.status, 200, `Diagnostics endpoint failed: ${diagnostics.status}`);

  const diag = diagnostics.data.diagnostics || {};
  const counters = (diag.counters || {}) as Record<string, unknown>;
  const dbWriteFailure = Number(counters.dbWriteFailure || 0);
  const dbReadFailure = Number(counters.dbReadFailure || 0);
  const dbFallback = Number(counters.dbReadFallbackToMemory || 0);
  const fallbackWarnings = Number(counters.fallbackWarningsEmitted || 0);
  const mode = String(diag.mode || '').trim() || 'unknown';

  console.log('[R1 Cutover Report]');
  console.log(`mode=${mode}`);
  console.log(`dbWriteFailure=${dbWriteFailure}`);
  console.log(`dbReadFailure=${dbReadFailure}`);
  console.log(`dbReadFallbackToMemory=${dbFallback}`);
  console.log(`fallbackWarningsEmitted=${fallbackWarnings}`);
  console.log(`scanRuns=${Array.isArray(diagnostics.data.scanRuns) ? diagnostics.data.scanRuns.length : 0}`);

  assert.ok(dbWriteFailure <= maxDbWriteFailure, `dbWriteFailure exceeds threshold (${dbWriteFailure} > ${maxDbWriteFailure})`);
  assert.ok(dbReadFailure <= maxDbReadFailure, `dbReadFailure exceeds threshold (${dbReadFailure} > ${maxDbReadFailure})`);
  assert.ok(dbFallback <= maxDbFallback, `dbReadFallbackToMemory exceeds threshold (${dbFallback} > ${maxDbFallback})`);
  assert.ok(
    fallbackWarnings <= maxFallbackWarnings,
    `fallbackWarningsEmitted exceeds threshold (${fallbackWarnings} > ${maxFallbackWarnings})`
  );

  console.log('[R1 Cutover Report] Thresholds satisfied.');
}

void main().catch((error) => {
  console.error('[R1 Cutover Report] Failed:', error);
  process.exit(1);
});
