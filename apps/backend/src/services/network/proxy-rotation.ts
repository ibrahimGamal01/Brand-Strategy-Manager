import fs from 'node:fs';
import type { AxiosProxyConfig } from 'axios';

const DEFAULT_PROXY_MAX_FAILURES = 2;
const DEFAULT_PROXY_COOLDOWN_MS = 120_000;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_BACKOFF_MAX_MS = 6_000;
const DEFAULT_PROXY_SUMMARY_INTERVAL_MS = Math.max(15_000, Number(process.env.PROXY_LOG_SUMMARY_MS || 60_000));

export type ProxyAcquireTarget = {
  id: string;
  proxyUrl: string | null;
  label: string;
  isDirect: boolean;
  cooldownHit?: boolean;
};

export type ProxyPolicyScope = 'ddg' | 'scrapling' | 'instagram' | 'tiktok' | string;

type ProxyState = {
  id: string;
  proxyUrl: string | null;
  label: string;
  failures: number;
  successes: number;
  cooldownUntil: number;
};

type ProxyPoolOptions = {
  name: string;
  proxyUrls: string[];
  includeDirect: boolean;
  maxFailuresBeforeCooldown: number;
  cooldownMs: number;
};

type ProxyPoolFromEnvOptions = {
  name: string;
  envKeys: string[];
  includeDirect?: boolean;
  includeDirectEnvKey?: string;
  maxFailuresBeforeCooldown?: number;
  maxFailuresEnvKey?: string;
  cooldownMs?: number;
  cooldownEnvKey?: string;
  fileEnvKey?: string;
};

type AttemptLogOutcome = 'attempt' | 'success' | 'failure' | 'direct_fallback';

type ProxyPolicyOperationContext = {
  scope: string;
  attempt: number;
  maxAttempts: number;
  target: ProxyAcquireTarget;
  allowDirect: boolean;
};

type ExecuteWithProxyPolicyOptions<T> = {
  scope: ProxyPolicyScope;
  label?: string;
  proxyPool?: RotatingProxyPool | null;
  maxAttempts?: number;
  allowDirect?: boolean;
  retryPredicate?: (error: unknown) => boolean;
  operation: (context: ProxyPolicyOperationContext) => Promise<T>;
};

export type ProxyPolicyExecutionResult<T> = {
  value: T;
  scope: string;
  allowDirect: boolean;
  attempt: number;
  target: ProxyAcquireTarget;
};

type ProxyAttemptLog = {
  scope: string;
  attempt: number;
  proxyTargetId: string;
  proxyTarget: string;
  isDirect: boolean;
  errorClass: string | null;
  retryable: boolean | null;
  outcome: AttemptLogOutcome;
  cooldownHit?: boolean;
};

type ProxyMetricCounter = {
  attempts: number;
  successes: number;
  failures: number;
  cooldownHits: number;
  directFallbacks: number;
};

type ProxyScopeMetrics = {
  lastSummaryAt: number;
  byTarget: Map<string, ProxyMetricCounter>;
};

const proxyMetricsByScope = new Map<string, ProxyScopeMetrics>();

function normalizePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function normalizePositiveIntOrZero(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseProxyList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,; ]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseProxyListFile(filePath: string | undefined): string[] {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) return [];
  if (!fs.existsSync(rawPath)) return [];
  try {
    return fs
      .readFileSync(rawPath, 'utf8')
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function normalizeProxyUrl(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const candidate = raw.includes('://') ? raw : `http://${raw}`;
  try {
    const url = new URL(candidate);
    if (!url.protocol || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function dedupeProxyUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeProxyUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function normalizeScope(scope: ProxyPolicyScope): string {
  const raw = String(scope || '').trim().toLowerCase();
  if (!raw) return 'default';
  if (raw.includes('instagram')) return 'instagram';
  if (raw.includes('tiktok')) return 'tiktok';
  if (raw.includes('scrapling')) return 'scrapling';
  if (raw.includes('ddg') || raw.includes('duckduckgo')) return 'ddg';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

function defaultAllowDirectForScope(scope: ProxyPolicyScope): boolean {
  const normalized = normalizeScope(scope);
  if (normalized === 'instagram') return false;
  if (normalized === 'tiktok') return false;
  if (normalized === 'ddg') return true;
  if (normalized === 'scrapling') return true;
  return true;
}

export function resolveAllowDirectForScope(scope: ProxyPolicyScope, fallback?: boolean): boolean {
  const normalized = normalizeScope(scope);
  const scopedEnvKey = `PROXY_POLICY_${normalized.toUpperCase()}_ALLOW_DIRECT`;
  if (Object.prototype.hasOwnProperty.call(process.env, scopedEnvKey)) {
    return parseBoolean(process.env[scopedEnvKey], fallback ?? defaultAllowDirectForScope(normalized));
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'SCRAPER_PROXY_ALLOW_DIRECT')) {
    return parseBoolean(process.env.SCRAPER_PROXY_ALLOW_DIRECT, fallback ?? defaultAllowDirectForScope(normalized));
  }
  return fallback ?? defaultAllowDirectForScope(normalized);
}

function classifyError(error: unknown): string | null {
  const err = error as any;
  if (!err) return null;
  const byName = String(err?.name || '').trim();
  if (byName) return byName;
  const byCode = String(err?.code || '').trim();
  if (byCode) return byCode;
  const byStatus = Number(err?.response?.status || err?.status || 0);
  if (Number.isFinite(byStatus) && byStatus > 0) return `HTTP_${byStatus}`;
  return 'UnknownError';
}

function incrementMetric(counter: ProxyMetricCounter, log: ProxyAttemptLog): void {
  if (log.outcome === 'attempt') counter.attempts += 1;
  if (log.outcome === 'success') counter.successes += 1;
  if (log.outcome === 'failure') counter.failures += 1;
  if (log.outcome === 'direct_fallback') counter.directFallbacks += 1;
  if (log.cooldownHit) counter.cooldownHits += 1;
}

function getOrCreateCounter(scope: string, targetId: string): ProxyMetricCounter {
  const now = Date.now();
  const existingScope = proxyMetricsByScope.get(scope);
  if (!existingScope) {
    const entry: ProxyScopeMetrics = {
      lastSummaryAt: now,
      byTarget: new Map(),
    };
    proxyMetricsByScope.set(scope, entry);
  }

  const scopeMetrics = proxyMetricsByScope.get(scope)!;
  if (!scopeMetrics.byTarget.has(targetId)) {
    scopeMetrics.byTarget.set(targetId, {
      attempts: 0,
      successes: 0,
      failures: 0,
      cooldownHits: 0,
      directFallbacks: 0,
    });
  }
  return scopeMetrics.byTarget.get(targetId)!;
}

function maybeLogMetricsSummary(scope: string): void {
  const scopeMetrics = proxyMetricsByScope.get(scope);
  if (!scopeMetrics) return;
  const now = Date.now();
  if (now - scopeMetrics.lastSummaryAt < DEFAULT_PROXY_SUMMARY_INTERVAL_MS) return;
  scopeMetrics.lastSummaryAt = now;

  const targets = Array.from(scopeMetrics.byTarget.entries()).map(([targetId, metrics]) => ({
    targetId,
    ...metrics,
  }));

  const totals = targets.reduce(
    (acc, target) => {
      acc.attempts += target.attempts;
      acc.successes += target.successes;
      acc.failures += target.failures;
      acc.cooldownHits += target.cooldownHits;
      acc.directFallbacks += target.directFallbacks;
      return acc;
    },
    { attempts: 0, successes: 0, failures: 0, cooldownHits: 0, directFallbacks: 0 }
  );

  console.log(
    `[ProxyPolicy] ${JSON.stringify({
      scope,
      event: 'proxy.summary',
      totals,
      targets,
    })}`
  );
}

export function logProxyAttempt(params: {
  scope: ProxyPolicyScope;
  attempt: number;
  target: ProxyAcquireTarget;
  outcome: AttemptLogOutcome;
  error?: unknown;
  retryable?: boolean | null;
}): void {
  const normalizedScope = normalizeScope(params.scope);
  const log: ProxyAttemptLog = {
    scope: normalizedScope,
    attempt: Math.max(1, Number(params.attempt || 1)),
    proxyTargetId: String(params.target?.id || `${normalizedScope}:unknown`),
    proxyTarget: params.target?.label || (params.target?.proxyUrl ? redactProxyUrl(params.target.proxyUrl) : 'direct'),
    isDirect: Boolean(params.target?.isDirect),
    errorClass: params.outcome === 'failure' ? classifyError(params.error) : null,
    retryable: typeof params.retryable === 'boolean' ? params.retryable : null,
    outcome: params.outcome,
    cooldownHit: Boolean(params.target?.cooldownHit),
  };

  console.log(`[ProxyPolicy] ${JSON.stringify({ event: 'proxy.attempt', ...log })}`);

  const counter = getOrCreateCounter(log.scope, log.proxyTargetId);
  incrementMetric(counter, log);
  maybeLogMetricsSummary(log.scope);
}

export function isProxyPolicyError(error: unknown): boolean {
  const err = error as any;
  if (!err) return false;
  if (String(err?.name || '').trim() === 'ProxyPolicyError') return true;
  const message = String(err?.message || '').toLowerCase();
  return message.includes('fail-closed proxy policy blocked execution');
}

function createDirectTarget(id: string): ProxyAcquireTarget {
  return {
    id,
    proxyUrl: null,
    label: 'direct',
    isDirect: true,
    cooldownHit: false,
  };
}

function createPolicyBlockedError(scope: string, label: string): Error {
  const policyError = new Error(
    `[${label}] fail-closed proxy policy blocked execution: no proxy targets configured for scope '${scope}'`
  );
  policyError.name = 'ProxyPolicyError';
  return policyError;
}

export async function executeWithProxyPolicy<T>(
  options: ExecuteWithProxyPolicyOptions<T>
): Promise<ProxyPolicyExecutionResult<T>> {
  const normalizedScope = normalizeScope(options.scope);
  const label = String(options.label || normalizedScope);
  const allowDirect = resolveAllowDirectForScope(options.scope, options.allowDirect);
  const maxAttempts = normalizePositiveInt(options.maxAttempts ?? 1, 1);
  const retryPredicate = options.retryPredicate || isRetryableNetworkError;
  const proxyPool = options.proxyPool || null;
  const hasConfiguredTargets = proxyPool?.hasConfiguredProxies() || false;

  if (!allowDirect && (!proxyPool || !hasConfiguredTargets)) {
    const target = createDirectTarget(`${normalizedScope}:policy:blocked`);
    const policyError = createPolicyBlockedError(normalizedScope, label);
    logProxyAttempt({
      scope: normalizedScope,
      attempt: 1,
      target,
      outcome: 'failure',
      error: policyError,
      retryable: false,
    });
    throw policyError;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const target =
      proxyPool?.acquire() || createDirectTarget(`${normalizedScope}:direct`);

    logProxyAttempt({
      scope: normalizedScope,
      attempt,
      target,
      outcome: 'attempt',
    });
    if (target.isDirect && hasConfiguredTargets) {
      logProxyAttempt({
        scope: normalizedScope,
        attempt,
        target,
        outcome: 'direct_fallback',
        retryable: null,
      });
    }

    try {
      const value = await options.operation({
        scope: normalizedScope,
        attempt,
        maxAttempts,
        target,
        allowDirect,
      });
      if (proxyPool && target.id) {
        proxyPool.recordSuccess(target.id);
      }
      logProxyAttempt({
        scope: normalizedScope,
        attempt,
        target,
        outcome: 'success',
        retryable: false,
      });
      return {
        value,
        scope: normalizedScope,
        allowDirect,
        attempt,
        target,
      };
    } catch (error: any) {
      lastError = error;
      if (proxyPool && target.id) {
        proxyPool.recordFailure(target.id);
      }
      const retryable = retryPredicate(error);
      logProxyAttempt({
        scope: normalizedScope,
        attempt,
        target,
        outcome: 'failure',
        error,
        retryable,
      });
      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }
      await sleep(computeRetryBackoffMs(attempt));
    }
  }

  throw (lastError as Error) || new Error(`[${normalizedScope}] proxy policy execution failed`);
}

export function isRetryableNetworkError(error: unknown): boolean {
  const err = error as any;
  const code = String(err?.code || '').toUpperCase();
  const status = Number(err?.response?.status || err?.status || 0);
  const message = String(err?.message || '').toLowerCase();
  const stderr = String(err?.stderr || '').toLowerCase();
  const merged = `${message}\n${stderr}`;

  if (err?.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') return true;
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(code)) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (merged.includes('timeout') || merged.includes('timed out')) return true;
  if (merged.includes('too many requests') || merged.includes('rate limit')) return true;
  if (merged.includes('proxy') || merged.includes('captcha') || merged.includes('temporarily unavailable')) return true;
  if (merged.includes('invalid content type') || merged.includes('detected html')) return true;

  return false;
}

export function computeRetryBackoffMs(
  attempt: number,
  baseMs = DEFAULT_BACKOFF_BASE_MS,
  maxMs = DEFAULT_BACKOFF_MAX_MS
): number {
  const safeAttempt = Math.max(1, attempt);
  const exp = baseMs * 2 ** (safeAttempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxMs, exp) + jitter;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function redactProxyUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    const auth = parsed.username || parsed.password ? '***:***@' : '';
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${auth}${parsed.hostname}${port}`;
  } catch {
    return 'proxy://invalid';
  }
}

export class RotatingProxyPool {
  private readonly name: string;
  private readonly maxFailuresBeforeCooldown: number;
  private readonly cooldownMs: number;
  private readonly states: ProxyState[];
  private pointer = 0;

  constructor(options: ProxyPoolOptions) {
    this.name = options.name;
    this.maxFailuresBeforeCooldown = normalizePositiveInt(
      options.maxFailuresBeforeCooldown,
      DEFAULT_PROXY_MAX_FAILURES
    );
    this.cooldownMs = normalizePositiveIntOrZero(options.cooldownMs, DEFAULT_PROXY_COOLDOWN_MS);

    const normalized = dedupeProxyUrls(options.proxyUrls);

    this.states = normalized.map((proxyUrl, idx) => ({
      id: `${this.name}:proxy:${idx + 1}`,
      proxyUrl,
      label: redactProxyUrl(proxyUrl),
      failures: 0,
      successes: 0,
      cooldownUntil: 0,
    }));

    if (options.includeDirect || this.states.length === 0) {
      this.states.push({
        id: `${this.name}:direct`,
        proxyUrl: null,
        label: 'direct',
        failures: 0,
        successes: 0,
        cooldownUntil: 0,
      });
    }
  }

  hasConfiguredProxies(): boolean {
    return this.states.some((state) => Boolean(state.proxyUrl));
  }

  acquire(): ProxyAcquireTarget {
    if (this.states.length === 0) {
      return {
        id: `${this.name}:direct`,
        proxyUrl: null,
        label: 'direct',
        isDirect: true,
        cooldownHit: false,
      };
    }

    const now = Date.now();
    for (let i = 0; i < this.states.length; i++) {
      const idx = (this.pointer + i) % this.states.length;
      const state = this.states[idx];
      if (state.cooldownUntil <= now) {
        this.pointer = (idx + 1) % this.states.length;
        return {
          id: state.id,
          proxyUrl: state.proxyUrl,
          label: state.label,
          isDirect: !state.proxyUrl,
          cooldownHit: false,
        };
      }
    }

    let earliestIdx = 0;
    for (let i = 1; i < this.states.length; i++) {
      if (this.states[i].cooldownUntil < this.states[earliestIdx].cooldownUntil) {
        earliestIdx = i;
      }
    }

    this.pointer = (earliestIdx + 1) % this.states.length;
    const state = this.states[earliestIdx];
    return {
      id: state.id,
      proxyUrl: state.proxyUrl,
      label: state.label,
      isDirect: !state.proxyUrl,
      cooldownHit: true,
    };
  }

  recordSuccess(targetId: string): void {
    const state = this.states.find((entry) => entry.id === targetId);
    if (!state) return;
    state.successes += 1;
    state.failures = 0;
    state.cooldownUntil = 0;
  }

  recordFailure(targetId: string): void {
    const state = this.states.find((entry) => entry.id === targetId);
    if (!state) return;
    state.failures += 1;

    if (state.proxyUrl && state.failures >= this.maxFailuresBeforeCooldown) {
      state.cooldownUntil = Date.now() + this.cooldownMs;
    }
  }
}

export function createProxyPoolFromEnv(options: ProxyPoolFromEnvOptions): RotatingProxyPool {
  const proxyUrls: string[] = [];
  for (const key of options.envKeys) {
    proxyUrls.push(...parseProxyList(process.env[key]));
  }

  if (options.fileEnvKey) {
    proxyUrls.push(...parseProxyListFile(process.env[options.fileEnvKey]));
  }

  const includeDirect = parseBoolean(
    options.includeDirectEnvKey ? process.env[options.includeDirectEnvKey] : undefined,
    options.includeDirect ?? true
  );

  const maxFailuresBeforeCooldown = normalizePositiveInt(
    options.maxFailuresEnvKey ? process.env[options.maxFailuresEnvKey] : undefined,
    options.maxFailuresBeforeCooldown ?? DEFAULT_PROXY_MAX_FAILURES
  );

  const cooldownMs = normalizePositiveIntOrZero(
    options.cooldownEnvKey ? process.env[options.cooldownEnvKey] : undefined,
    options.cooldownMs ?? DEFAULT_PROXY_COOLDOWN_MS
  );

  return new RotatingProxyPool({
    name: options.name,
    proxyUrls,
    includeDirect,
    maxFailuresBeforeCooldown,
    cooldownMs,
  });
}

function clearChildProxySelection(env: NodeJS.ProcessEnv): void {
  const keys = [
    'SCRAPER_PROXY_URL',
    'SCRAPER_PROXY_URLS',
    'PROXY_URL',
    'PROXY_URLS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'http_proxy',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
  ];
  for (const key of keys) {
    delete env[key];
  }
  for (const key of Object.keys(env)) {
    if (/_PROXY_URLS$/i.test(key)) {
      delete env[key];
      continue;
    }
    if (/_PROXY_URL$/i.test(key) && key !== 'SCRAPER_PROXY_URL') {
      delete env[key];
      continue;
    }
  }
  delete env.PROXY_LIST_PATH;
}

export function applyProxyEnv(
  baseEnv: NodeJS.ProcessEnv,
  target: ProxyAcquireTarget,
  options: { setScraperProxyVar?: boolean } = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (!options.setScraperProxyVar) {
    return env;
  }

  clearChildProxySelection(env);
  env.SCRAPER_PROXY_DISABLE_SELF_ROTATION = '1';

  if (target.proxyUrl) {
    env.SCRAPER_PROXY_URL = target.proxyUrl;
    delete env.SCRAPER_PROXY_FORCE_DIRECT;
  } else {
    delete env.SCRAPER_PROXY_URL;
    env.SCRAPER_PROXY_FORCE_DIRECT = '1';
  }

  return env;
}

export function proxyUrlToAxiosConfig(proxyUrl: string | null): AxiosProxyConfig | null {
  if (!proxyUrl) return null;

  try {
    const parsed = new URL(proxyUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    if (!Number.isFinite(port) || port <= 0) return null;

    const config: AxiosProxyConfig = {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port,
    };

    if (parsed.username || parsed.password) {
      config.auth = {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
      };
    }

    return config;
  } catch {
    return null;
  }
}
