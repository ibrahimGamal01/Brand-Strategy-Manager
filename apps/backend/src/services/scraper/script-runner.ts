import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  applyProxyEnv,
  createProxyPoolFromEnv,
  executeWithProxyPolicy,
  isRetryableNetworkError,
  isProxyPolicyError,
  ProxyPolicyScope,
  resolveAllowDirectForScope,
  RotatingProxyPool,
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

export type ScriptRunnerProxyPolicy = {
  scope: ProxyPolicyScope;
  allowDirect: boolean;
  selectedTargetId?: string;
  selectedProxyUrl?: string | null;
  attempt?: number;
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
  proxyPolicy?: Partial<ScriptRunnerProxyPolicy>;
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

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Continue to recovery parsing paths.
  }

  const firstObjectStart = trimmed.indexOf('{');
  const lastObjectEnd = trimmed.lastIndexOf('}');
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    const candidate = trimmed.slice(firstObjectStart, lastObjectEnd + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Continue.
    }
  }

  const firstArrayStart = trimmed.indexOf('[');
  const lastArrayEnd = trimmed.lastIndexOf(']');
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    const candidate = trimmed.slice(firstArrayStart, lastArrayEnd + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Continue.
    }
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines[i];
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
      continue;
    }
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
    path.join(cwd, 'apps/backend/scripts', scriptFileName),
    path.join(cwd, 'scripts', scriptFileName),
    path.isAbsolute(scriptFileName) ? scriptFileName : path.join(cwd, scriptFileName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function createScraperProxyPool(
  scope: string,
  envKeys: string[],
  options: { policyScope?: ProxyPolicyScope; allowDirect?: boolean } = {}
): RotatingProxyPool {
  const policyScope = options.policyScope || scope;
  const allowDirect = resolveAllowDirectForScope(policyScope, options.allowDirect);
  return createProxyPoolFromEnv({
    name: `scraper-${scope}`,
    envKeys,
    includeDirect: allowDirect,
    maxFailuresBeforeCooldown: Number(process.env.SCRAPER_PROXY_MAX_FAILURES || 2),
    maxFailuresEnvKey: 'SCRAPER_PROXY_MAX_FAILURES',
    cooldownMs: Number(process.env.SCRAPER_PROXY_COOLDOWN_MS || 120_000),
    cooldownEnvKey: 'SCRAPER_PROXY_COOLDOWN_MS',
    fileEnvKey: 'PROXY_LIST_PATH',
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
  const policyScope = options.proxyPolicy?.scope || options.label;
  const policyAllowDirect = resolveAllowDirectForScope(
    policyScope,
    options.proxyPolicy?.allowDirect
  );

  try {
    const execution = await executeWithProxyPolicy<{
      stdout: string;
      stderr: string;
      parsed: T;
    }>({
      scope: policyScope,
      label: options.label,
      proxyPool: options.proxyPool,
      maxAttempts,
      allowDirect: policyAllowDirect,
      retryPredicate: isRetryableNetworkError,
      operation: async ({ attempt, scope, target }) => {
        const policyState: ScriptRunnerProxyPolicy = {
          scope,
          allowDirect: policyAllowDirect,
          selectedTargetId: target.id,
          selectedProxyUrl: target.proxyUrl,
          attempt,
        };
        const envWithProxy = applyProxyEnv(process.env, target, { setScraperProxyVar: true });
        envWithProxy.SCRAPER_PROXY_SCOPE = String(policyState.scope);
        envWithProxy.SCRAPER_PROXY_ATTEMPT = String(policyState.attempt);

        if (options.extraEnv) {
          for (const [key, value] of Object.entries(options.extraEnv)) {
            if (typeof value === 'string') envWithProxy[key] = value;
            else delete envWithProxy[key];
          }
        }

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

        return {
          stdout,
          stderr,
          parsed: parseJsonFromOutput<T>(stdout),
        };
      },
    });

    return {
      ...execution.value,
      attempts: execution.attempt,
      scriptPath,
    };
  } catch (error: any) {
    if (isProxyPolicyError(error)) {
      throw error;
    }
    const stderr = sanitizeForLog(String(error?.stderr || error?.message || 'unknown script error'));
    throw new Error(`[${options.label}] script execution failed: ${stderr}`);
  }
}
