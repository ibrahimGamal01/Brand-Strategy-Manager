import { createHash } from 'crypto';
import { extractCsrf } from './instagram-cookie';

export type InstagramSessionFailureReason = 'AUTH_401' | 'RATE_429' | 'LOGIN_GATE';

export type InstagramSessionState = {
  id: string;
  cookie: string;
  csrf: string | null;
  failures: number;
  cooldownUntil: number;
  lastSuccessAt: number | null;
};

const DEFAULT_SESSION_MAX_FAILURES = 2;
const DEFAULT_SESSION_COOLDOWN_MS = 180_000;
const DEFAULT_LOGIN_GATE_COOLDOWN_MS = 300_000;

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizeCookieEntry(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ');
}

function isSessionCookieStart(raw: string, index: number): boolean {
  const next = raw.slice(index + 1).trimStart().toLowerCase();
  return next.startsWith('sessionid=');
}

function splitRawSessionCookies(raw: string): string[] {
  const value = String(raw || '');
  if (!value.trim()) return [];

  const pieces: string[] = [];
  let cursor = '';

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const next = value[i + 1];

    if (char === '|' && next === '|') {
      if (cursor.trim()) pieces.push(cursor.trim());
      cursor = '';
      i += 1;
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (cursor.trim()) pieces.push(cursor.trim());
      cursor = '';
      continue;
    }

    if (char === ',' && isSessionCookieStart(value, i)) {
      if (cursor.trim()) pieces.push(cursor.trim());
      cursor = '';
      continue;
    }

    cursor += char;
  }

  if (cursor.trim()) pieces.push(cursor.trim());
  return pieces;
}

function stableSessionId(cookie: string): string {
  return createHash('sha1').update(cookie).digest('hex').slice(0, 16);
}

function nowMs(): number {
  return Date.now();
}

export function isInstagramLoginGatePayload(payload: unknown): boolean {
  const message = String((payload as any)?.message || '').toLowerCase();
  return Boolean(
    (payload as any)?.require_login === true ||
      message.includes('please wait a few minutes') ||
      message.includes('login required')
  );
}

export function loadSessionsFromEnv(): InstagramSessionState[] {
  const primary = process.env.INSTAGRAM_SESSION_COOKIES || '';
  const fallback = process.env.INSTAGRAM_SESSION_COOKIE || '';
  const rawEntries = splitRawSessionCookies(primary || fallback);

  const deduped = new Map<string, InstagramSessionState>();

  for (const rawEntry of rawEntries) {
    const cookie = normalizeCookieEntry(rawEntry);
    if (!cookie) continue;
    const id = stableSessionId(cookie);
    if (deduped.has(id)) continue;
    deduped.set(id, {
      id,
      cookie,
      csrf: extractCsrf(cookie),
      failures: 0,
      cooldownUntil: 0,
      lastSuccessAt: null,
    });
  }

  return Array.from(deduped.values());
}

export class InstagramSessionPool {
  private readonly sessions: InstagramSessionState[];
  private readonly maxFailures: number;
  private readonly sessionCooldownMs: number;
  private readonly globalLoginGateCooldownMs: number;
  private pointer = 0;
  private globalGateUntil = 0;

  constructor(inputSessions?: InstagramSessionState[]) {
    this.sessions = (inputSessions && inputSessions.length > 0 ? inputSessions : loadSessionsFromEnv()).map((session) => ({
      ...session,
      failures: Number(session.failures || 0),
      cooldownUntil: Number(session.cooldownUntil || 0),
      lastSuccessAt: session.lastSuccessAt || null,
    }));
    this.maxFailures = readPositiveInt(process.env.INSTAGRAM_SESSION_MAX_FAILURES, DEFAULT_SESSION_MAX_FAILURES);
    this.sessionCooldownMs = readPositiveInt(process.env.INSTAGRAM_SESSION_COOLDOWN_MS, DEFAULT_SESSION_COOLDOWN_MS);
    this.globalLoginGateCooldownMs = readPositiveInt(
      process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS,
      DEFAULT_LOGIN_GATE_COOLDOWN_MS
    );
  }

  hasAnySessions(): boolean {
    return this.sessions.length > 0;
  }

  isGlobalGateActive(): boolean {
    return this.getGlobalGateRemainingMs() > 0;
  }

  getGlobalGateRemainingMs(): number {
    return Math.max(0, this.globalGateUntil - nowMs());
  }

  acquireSession(options: { excludeSessionIds?: Set<string> } = {}): InstagramSessionState | null {
    if (!this.sessions.length) {
      return null;
    }

    const excluded = options.excludeSessionIds || new Set<string>();
    const now = nowMs();

    for (let i = 0; i < this.sessions.length; i++) {
      const idx = (this.pointer + i) % this.sessions.length;
      const session = this.sessions[idx];
      if (excluded.has(session.id)) continue;
      if (session.cooldownUntil > now) continue;
      this.pointer = (idx + 1) % this.sessions.length;
      return session;
    }

    return null;
  }

  recordSuccess(sessionId: string): void {
    const session = this.sessions.find((entry) => entry.id === sessionId);
    if (!session) return;
    session.failures = 0;
    session.cooldownUntil = 0;
    session.lastSuccessAt = nowMs();
  }

  recordFailure(sessionId: string, reason: InstagramSessionFailureReason): void {
    const session = this.sessions.find((entry) => entry.id === sessionId);
    if (!session) return;

    session.failures += 1;
    const now = nowMs();

    if (reason === 'LOGIN_GATE') {
      session.cooldownUntil = Math.max(session.cooldownUntil, now + this.sessionCooldownMs);
      this.globalGateUntil = Math.max(this.globalGateUntil, now + this.globalLoginGateCooldownMs);
      return;
    }

    if (session.failures >= this.maxFailures || reason === 'RATE_429') {
      const multiplier = reason === 'RATE_429' ? 1.5 : 1;
      session.cooldownUntil = Math.max(session.cooldownUntil, now + Math.floor(this.sessionCooldownMs * multiplier));
    }
  }
}

let singletonPool: InstagramSessionPool | null = null;

export function getInstagramSessionPool(): InstagramSessionPool {
  if (!singletonPool) {
    singletonPool = new InstagramSessionPool();
  }
  return singletonPool;
}

export function acquireInstagramSession(options: { excludeSessionIds?: Set<string> } = {}): InstagramSessionState | null {
  return getInstagramSessionPool().acquireSession(options);
}

export function recordInstagramSessionSuccess(sessionId: string): void {
  getInstagramSessionPool().recordSuccess(sessionId);
}

export function recordInstagramSessionFailure(sessionId: string, reason: InstagramSessionFailureReason): void {
  getInstagramSessionPool().recordFailure(sessionId, reason);
}

export function isInstagramGlobalGateActive(): boolean {
  return getInstagramSessionPool().isGlobalGateActive();
}

export function getInstagramGlobalGateRemainingMs(): number {
  return getInstagramSessionPool().getGlobalGateRemainingMs();
}

export function __resetInstagramSessionPoolForTests(): void {
  singletonPool = null;
}
