import type { AxiosProxyConfig } from 'axios';

const DEFAULT_PROXY_MAX_FAILURES = 2;
const DEFAULT_PROXY_COOLDOWN_MS = 120_000;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_BACKOFF_MAX_MS = 6_000;

export type ProxyAcquireTarget = {
  id: string;
  proxyUrl: string | null;
  label: string;
  isDirect: boolean;
};

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
};

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

function normalizeProxyUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (!url.protocol || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
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

    const normalized = Array.from(
      new Set(options.proxyUrls.map((v) => normalizeProxyUrl(v)).filter((v): v is string => Boolean(v)))
    );

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

export function applyProxyEnv(
  baseEnv: NodeJS.ProcessEnv,
  target: ProxyAcquireTarget,
  options: { setScraperProxyVar?: boolean } = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];

  if (target.proxyUrl) {
    for (const key of keys) env[key] = target.proxyUrl;
    if (options.setScraperProxyVar) {
      env.SCRAPER_PROXY_URL = target.proxyUrl;
      env.PROXY_URL = target.proxyUrl;
    }
  } else {
    for (const key of keys) delete env[key];
    if (options.setScraperProxyVar) {
      delete env.SCRAPER_PROXY_URL;
      delete env.PROXY_URL;
    }
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
