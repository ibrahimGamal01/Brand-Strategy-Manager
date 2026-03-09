import crypto from 'node:crypto';

export type ViralStudioAssetRefKind =
  | 'ingestion'
  | 'reference'
  | 'generation'
  | 'document'
  | 'document-version';

type ViralStudioAssetRefPayload = {
  w: string;
  k: ViralStudioAssetRefKind;
  id: string;
  v: 1;
};

const ASSET_REF_SECRET =
  String(process.env.VIRAL_STUDIO_REF_SECRET || process.env.RUNTIME_WS_SIGNING_SECRET || 'bat-viral-studio-ref-secret')
    .trim() || 'bat-viral-studio-ref-secret';

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', ASSET_REF_SECRET).update(payload).digest('base64url').slice(0, 20);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildViralStudioAssetRef(input: {
  workspaceId: string;
  kind: ViralStudioAssetRefKind;
  id: string;
}): string {
  const payload: ViralStudioAssetRefPayload = {
    w: String(input.workspaceId || '').trim(),
    k: input.kind,
    id: String(input.id || '').trim(),
    v: 1,
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encoded);
  return `vsr1.${encoded}.${signature}`;
}

export function parseViralStudioAssetRef(value: string): {
  workspaceId: string;
  kind: ViralStudioAssetRefKind;
  id: string;
} | null {
  const raw = String(value || '').trim();
  if (!raw.startsWith('vsr1.')) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [, payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;
  const expectedSignature = signPayload(payloadEncoded);
  if (!safeEqual(signature, expectedSignature)) return null;
  const decoded = fromBase64Url(payloadEncoded);
  if (!decoded) return null;
  let parsed: ViralStudioAssetRefPayload | null = null;
  try {
    parsed = JSON.parse(decoded) as ViralStudioAssetRefPayload;
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  const workspaceId = String(parsed.w || '').trim();
  const id = String(parsed.id || '').trim();
  const kind = String(parsed.k || '').trim().toLowerCase();
  if (!workspaceId || !id) return null;
  if (
    kind !== 'ingestion' &&
    kind !== 'reference' &&
    kind !== 'generation' &&
    kind !== 'document' &&
    kind !== 'document-version'
  ) {
    return null;
  }
  return {
    workspaceId,
    kind,
    id,
  };
}
