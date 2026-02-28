import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { issueRuntimeWsToken, verifyRuntimeWsToken } from '../services/chat/runtime/runtime-ws-auth';

type WsPayload = {
  researchJobId: string;
  branchId: string;
  userId: string;
  nonce: string;
  iat: number;
  exp: number;
};

function sign(encodedPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function buildExpiredToken(secret: string): string {
  const now = Date.now();
  const payload: WsPayload = {
    researchJobId: 'job-expired',
    branchId: 'branch-expired',
    userId: 'user-expired',
    nonce: crypto.randomUUID(),
    iat: now - 5000,
    exp: now - 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

async function run() {
  process.env.RUNTIME_WS_SIGNING_SECRET = process.env.RUNTIME_WS_SIGNING_SECRET || 'runtime-ws-test-secret';
  const secret = String(process.env.RUNTIME_WS_SIGNING_SECRET);

  const issued = issueRuntimeWsToken({
    researchJobId: 'job-1',
    branchId: 'branch-1',
    userId: 'user-1',
  });
  assert.ok(issued.token.includes('.'), 'issued token should include payload and signature');

  const verified = verifyRuntimeWsToken({
    token: issued.token,
    researchJobId: 'job-1',
    branchId: 'branch-1',
  });
  assert.equal(verified.ok, true, 'valid token should verify');

  const replay = verifyRuntimeWsToken({
    token: issued.token,
    researchJobId: 'job-1',
    branchId: 'branch-1',
  });
  assert.equal(replay.ok, false, 'replayed nonce should fail');
  if (!replay.ok) {
    assert.equal(replay.reason, 'REPLAYED_NONCE');
  }

  const issuedWrongContext = issueRuntimeWsToken({
    researchJobId: 'job-2',
    branchId: 'branch-2',
    userId: 'user-2',
  });
  const wrongContext = verifyRuntimeWsToken({
    token: issuedWrongContext.token,
    researchJobId: 'job-2',
    branchId: 'branch-x',
  });
  assert.equal(wrongContext.ok, false, 'token with wrong branch context should fail');
  if (!wrongContext.ok) {
    assert.equal(wrongContext.reason, 'INVALID_CONTEXT');
  }

  const tampered = `${issuedWrongContext.token.slice(0, -1)}x`;
  const tamperedResult = verifyRuntimeWsToken({
    token: tampered,
    researchJobId: 'job-2',
    branchId: 'branch-2',
  });
  assert.equal(tamperedResult.ok, false, 'tampered token should fail');
  if (!tamperedResult.ok) {
    assert.equal(tamperedResult.reason, 'SIGNATURE_MISMATCH');
  }

  const expired = verifyRuntimeWsToken({
    token: buildExpiredToken(secret),
    researchJobId: 'job-expired',
    branchId: 'branch-expired',
  });
  assert.equal(expired.ok, false, 'expired token should fail');
  if (!expired.ok) {
    assert.equal(expired.reason, 'EXPIRED');
  }

  console.log('[Runtime WS Token] Auth checks passed.');
}

void run().catch((error) => {
  console.error('[Runtime WS Token] Auth checks failed:', error);
  process.exit(1);
});
