import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  applyProxyEnv,
  computeRetryBackoffMs,
  createProxyPoolFromEnv,
  isRetryableNetworkError,
  RotatingProxyPool,
  sleep,
} from '../network/proxy-rotation';

const execFileAsync = promisify(execFile);

const DEFAULT_COMMAND_MAX_ATTEMPTS = Number.parseInt(process.env.SCRAPER_COMMAND_MAX_ATTEMPTS || '3', 10);

export type ScriptRunnerOutput<T = unknown> = {
  stdout: string;
  stderr: string;
  parsed: T;
  attempts: number;
  scriptPath: string;
};

type RunScriptJsonOptions = {
  label: string;
  executable: string;
  scriptFileName: string;
  scriptArgsPrefix?: string[];
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  maxAttempts?: number;
  proxyPool?: RotatingProxyPool;
  extraEnv?: Record<string, string | undefined>;
};

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function sanitizeForLog(text: string, maxLen = 500): string {
  return text.replace(/\s+/g, ' ').slice(0, maxLen).trim();
}

function parseJsonFromOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('No script output to parse');
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines[i];
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  return JSON.parse(trimmed) as T;
}

export function resolveBackendScriptPath(scriptFileName: string): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'scripts', scriptFileName),
    path.join(cwd, 'apps/backend/scripts', scriptFileName),
    path.isAbsolute(scriptFileName) ? scriptFileName : path.join(cwd, scriptFileName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function createScraperProxyPool(scope: string, envKeys: string[]): RotatingProxyPool {
  return createProxyPoolFromEnv({
    name: `scraper-${scope}`,
    envKeys,
    includeDirect: true,
    includeDirectEnvKey: 'SCRAPER_PROXY_ALLOW_DIRECT',
    maxFailuresBeforeCooldown: Number(process.env.SCRAPER_PROXY_MAX_FAILURES || 2),
    maxFailuresEnvKey: 'SCRAPER_PROXY_MAX_FAILURES',
    cooldownMs: Number(process.env.SCRAPER_PROXY_COOLDOWN_MS || 120_000),
    cooldownEnvKey: 'SCRAPER_PROXY_COOLDOWN_MS',
  });
}

export async function runScriptJsonWithRetries<T>(
  options: RunScriptJsonOptions
): Promise<ScriptRunnerOutput<T>> {
  const scriptPath = resolveBackendScriptPath(options.scriptFileName);
  if (!scriptPath) {
    throw new Error(`${options.scriptFileName} not found`);
  }

  const maxAttempts = normalizePositiveInt(
    Number(options.maxAttempts || DEFAULT_COMMAND_MAX_ATTEMPTS),
    normalizePositiveInt(DEFAULT_COMMAND_MAX_ATTEMPTS, 3)
  );

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const target = options.proxyPool?.acquire();
    const envWithProxy = applyProxyEnv(process.env, target || {
      id: `${options.label}:direct`,
      proxyUrl: null,
      label: 'direct',
      isDirect: true,
    }, { setScraperProxyVar: true });

    if (options.extraEnv) {
      for (const [key, value] of Object.entries(options.extraEnv)) {
        if (typeof value === 'string') envWithProxy[key] = value;
        else delete envWithProxy[key];
      }
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        options.executable,
        [...(options.scriptArgsPrefix || []), scriptPath, ...(options.args || [])],
        {
          cwd: options.cwd || process.cwd(),
          timeout: options.timeoutMs || 120_000,
          maxBuffer: options.maxBufferBytes || 10 * 1024 * 1024,
          env: envWithProxy,
        }
      );

      const parsed = parseJsonFromOutput<T>(stdout);
      if (target?.id) options.proxyPool?.recordSuccess(target.id);

      return {
        stdout,
        stderr,
        parsed,
        attempts: attempt,
        scriptPath,
      };
    } catch (error: any) {
      if (target?.id) options.proxyPool?.recordFailure(target.id);

      const stderr = sanitizeForLog(String(error?.stderr || error?.message || 'unknown script error'));
      const retryable = isRetryableNetworkError(error);
      lastError = new Error(
        `[${options.label}] attempt ${attempt}/${maxAttempts} failed${target ? ` via ${target.label}` : ''}: ${stderr}`
      );

      if (!retryable || attempt >= maxAttempts) {
        break;
      }

      await sleep(computeRetryBackoffMs(attempt));
    }
  }

  throw lastError || new Error(`[${options.label}] script execution failed`);
}
