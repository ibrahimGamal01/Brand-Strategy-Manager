import crypto from 'node:crypto';

type RuntimeWsTokenPayload = {
  researchJobId: string;
  branchId: string;
  userId: string;
  nonce: string;
  iat: number;
  exp: number;
};

type RuntimeWsTokenIssueInput = {
  researchJobId: string;
  branchId: string;
  userId: string;
};

type RuntimeWsTokenVerifyInput = {
  token: string;
  researchJobId: string;
  branchId: string;
};

type RuntimeWsTokenVerifyResult =
  | {
      ok: true;
      payload: RuntimeWsTokenPayload;
    }
  | {
      ok: false;
      reason:
        | 'MISSING'
        | 'MALFORMED'
        | 'SIGNATURE_MISMATCH'
        | 'EXPIRED'
        | 'INVALID_CONTEXT'
        | 'REPLAYED_NONCE';
    };

const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 300_000;
const NONCE_CACHE_SOFT_MAX = 25_000;
const usedNonceToExp = new Map<string, number>();
let warnedAboutSecretFallback = false;

function getRuntimeWsTokenTtlMs(): number {
  const parsed = Number(process.env.RUNTIME_WS_TOKEN_TTL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MS;
  return Math.max(10_000, Math.min(MAX_TTL_MS, Math.floor(parsed)));
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function deriveFallbackSecret(): string {
  const source = String(process.env.DATABASE_URL || process.env.PORT || 'runtime-ws').trim();
  return crypto.createHash('sha256').update(source).digest('hex');
}

function getRuntimeWsSigningSecret(): string {
  const configured = String(process.env.RUNTIME_WS_SIGNING_SECRET || '').trim();
  if (configured) return configured;
  if (!warnedAboutSecretFallback) {
    warnedAboutSecretFallback = true;
    console.warn(
      '[Runtime WS] RUNTIME_WS_SIGNING_SECRET is not set. Falling back to a derived secret. Configure RUNTIME_WS_SIGNING_SECRET in production.'
    );
  }
  return deriveFallbackSecret();
}

function signTokenPayload(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', getRuntimeWsSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function compactNonceCache(nowMs: number) {
  for (const [nonce, expMs] of usedNonceToExp.entries()) {
    if (expMs <= nowMs) {
      usedNonceToExp.delete(nonce);
    }
  }
  if (usedNonceToExp.size <= NONCE_CACHE_SOFT_MAX) return;
  const sorted = Array.from(usedNonceToExp.entries()).sort((a, b) => a[1] - b[1]);
  const removeCount = usedNonceToExp.size - NONCE_CACHE_SOFT_MAX;
  for (let index = 0; index < removeCount; index += 1) {
    const entry = sorted[index];
    if (!entry) break;
    usedNonceToExp.delete(entry[0]);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function issueRuntimeWsToken(input: RuntimeWsTokenIssueInput): { token: string; expiresAt: string } {
  const nowMs = Date.now();
  const ttlMs = getRuntimeWsTokenTtlMs();
  const expMs = nowMs + ttlMs;
  const payload: RuntimeWsTokenPayload = {
    researchJobId: input.researchJobId,
    branchId: input.branchId,
    userId: input.userId,
    nonce: crypto.randomUUID(),
    iat: nowMs,
    exp: expMs,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signTokenPayload(encodedPayload);
  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expMs).toISOString(),
  };
}

export function verifyRuntimeWsToken(input: RuntimeWsTokenVerifyInput): RuntimeWsTokenVerifyResult {
  const raw = String(input.token || '').trim();
  if (!raw) return { ok: false, reason: 'MISSING' };
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'MALFORMED' };

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return { ok: false, reason: 'MALFORMED' };

  const expectedSignature = signTokenPayload(encodedPayload);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  }

  const payloadRaw = decodeBase64Url(encodedPayload);
  if (!payloadRaw) return { ok: false, reason: 'MALFORMED' };

  let parsed: RuntimeWsTokenPayload | null = null;
  try {
    parsed = JSON.parse(payloadRaw) as RuntimeWsTokenPayload;
  } catch {
    parsed = null;
  }
  if (!parsed) return { ok: false, reason: 'MALFORMED' };

  const researchJobId = String(parsed.researchJobId || '').trim();
  const branchId = String(parsed.branchId || '').trim();
  const userId = String(parsed.userId || '').trim();
  const nonce = String(parsed.nonce || '').trim();
  const expMs = Number(parsed.exp);
  const iatMs = Number(parsed.iat);
  if (!researchJobId || !branchId || !userId || !nonce || !Number.isFinite(expMs) || !Number.isFinite(iatMs)) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const nowMs = Date.now();
  compactNonceCache(nowMs);
  if (expMs <= nowMs) return { ok: false, reason: 'EXPIRED' };
  if (researchJobId !== input.researchJobId || branchId !== input.branchId) {
    return { ok: false, reason: 'INVALID_CONTEXT' };
  }

  if (usedNonceToExp.has(nonce)) {
    return { ok: false, reason: 'REPLAYED_NONCE' };
  }
  usedNonceToExp.set(nonce, expMs);

  return {
    ok: true,
    payload: {
      researchJobId,
      branchId,
      userId,
      nonce,
      iat: iatMs,
      exp: expMs,
    },
  };
}
