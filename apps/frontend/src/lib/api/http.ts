function normalizeApiBase(raw: string | undefined): string {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '/api';
  if (value.endsWith('/api')) return value;
  return `${value}/api`;
}

/**
 * Browser requests should go through Next.js rewrites (`/api`).
 * Server-side calls can use an absolute base when configured.
 */
export const API_BASE =
  typeof window !== 'undefined'
    ? '/api'
    : normalizeApiBase(
        process.env.NEXT_PUBLIC_API_URL ||
          process.env.NEXT_PUBLIC_API_ORIGIN ||
          process.env.API_BASE_URL
      );

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

function absoluteBrowserApiBase(): string | null {
  if (typeof window === 'undefined') return null;
  const candidate = normalizeApiBase(
    process.env.NEXT_PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_API_ORIGIN ||
      process.env.API_BASE_URL
  );
  if (!candidate || candidate === '/api') return null;
  return candidate;
}

function buildFallbackBrowserUrl(path: string): string | null {
  const base = absoluteBrowserApiBase();
  if (!base) return null;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const maxRetries = Math.max(0, Number(process.env.NEXT_PUBLIC_API_RETRIES || 2));
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  const primaryUrl = buildUrl(path);
  const fallbackUrl = buildFallbackBrowserUrl(path);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(primaryUrl, {
        ...init,
        headers: {
          ...(!init?.body || init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(init?.headers || {}),
        },
      });
    } catch (error: any) {
      if (fallbackUrl) {
        try {
          response = await fetch(fallbackUrl, {
            ...init,
          headers: {
            ...(!init?.body || init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            ...(init?.headers || {}),
          },
        });
        } catch (fallbackError: any) {
          if (attempt < maxRetries) {
            await sleep(250 * (attempt + 1));
            continue;
          }
          const message =
            fallbackError?.message ||
            error?.message ||
            'Network error: unable to reach backend. Check server status and API routing.';
          throw new ApiError(message, 0, { error: message });
        }
      } else {
        if (attempt < maxRetries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        const message =
          error?.message ||
          'Network error: unable to reach backend. Check server status and API routing.';
        throw new ApiError(message, 0, { error: message });
      }
    }

    const payload = await parseJsonSafe(response);
    if (!response.ok && fallbackUrl && response.status >= 500 && response.status <= 504) {
      try {
        const fallbackResponse = await fetch(fallbackUrl, {
          ...init,
          headers: {
            ...(!init?.body || init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            ...(init?.headers || {}),
          },
        });
        const fallbackPayload = await parseJsonSafe(fallbackResponse);
        if (fallbackResponse.ok) return fallbackPayload as T;
      } catch {
        // Ignore fallback probe errors and use the original response handling below.
      }
    }

    if (!response.ok) {
      if (attempt < maxRetries && retryableStatuses.has(response.status)) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      let message = `Request failed with status ${response.status}`;
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const rawError = (payload as { error?: unknown }).error;
        if (typeof rawError === 'string' && rawError.trim().length > 0) {
          message = rawError;
        } else if (rawError != null) {
          message = String(rawError);
        }
      }
      throw new ApiError(message, response.status, payload);
    }

    return payload as T;
  }

  throw new ApiError('Request failed with unknown network error', 0, null);
}

export function streamUrl(path: string): string {
  return buildUrl(path);
}

const LONG_REQUEST_TIMEOUT_MS = 600_000; // 10 minutes for strategy generation
const DEFAULT_DEV_BACKEND_ORIGIN = 'http://localhost:3001';

function getLongRequestBase(): string | null {
  if (typeof window === 'undefined') return null;
  const fromEnv = absoluteBrowserApiBase();
  if (fromEnv) return fromEnv;
  // Dev fallback: when frontend is on localhost, use backend on 3001 so we bypass Next.js proxy (~30s timeout)
  try {
    const origin = window.location?.origin ?? '';
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return `${DEFAULT_DEV_BACKEND_ORIGIN}/api`;
    }
  } catch {
    // ignore
  }
  return null;
}

export interface ApiFetchLongOptions extends RequestInit {
  /** Timeout in ms (default 10 min). Only used when direct backend URL is used. */
  timeoutMs?: number;
}

/**
 * For long-running requests (e.g. strategy document generate). In the browser,
 * calls the backend directly when possible (NEXT_PUBLIC_API_ORIGIN or localhost:3001 in dev)
 * to avoid Next.js rewrite proxy ~30s timeout. Uses a long client timeout so the request can complete.
 */
export async function apiFetchLong<T>(
  path: string,
  init?: ApiFetchLongOptions
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? LONG_REQUEST_TIMEOUT_MS;
  const { timeoutMs: _drop, ...fetchInit } = init ?? {};

  const directBase = getLongRequestBase();
  const url =
    typeof window !== 'undefined' && directBase
      ? `${directBase}${path.startsWith('/') ? path : `/${path}`}`
      : buildUrl(path);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
      headers: {
        ...(fetchInit.body ? { 'Content-Type': 'application/json' } : {}),
        ...(fetchInit.headers || {}),
      },
    });
    clearTimeout(timeoutId);
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const rawError = (payload as { error?: unknown }).error;
        if (typeof rawError === 'string' && rawError.trim().length > 0) {
          message = rawError;
        } else if (rawError != null) {
          message = String(rawError);
        }
      }
      throw new ApiError(message, response.status, payload);
    }
    return payload as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new ApiError(
        `Request timed out after ${timeoutMs / 1000}s. Strategy generation may still be running on the server.`,
        0,
        null
      );
    }
    throw err instanceof ApiError
      ? err
      : new ApiError(err?.message ?? 'Network error', 0, { error: err?.message });
  }
}
