import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function normalizeKeyMaterial(raw: string): Buffer {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error('SLACK_TOKEN_ENCRYPTION_KEY is required to encrypt Slack credentials.');
  }

  if (/^[A-Fa-f0-9]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const base64Candidate = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const decoded = Buffer.from(base64Candidate, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to derived key.
  }

  return crypto.createHash('sha256').update(value).digest();
}

function getKey(): Buffer {
  return normalizeKeyMaterial(String(process.env.SLACK_TOKEN_ENCRYPTION_KEY || ''));
}

export function encryptSlackSecret(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSlackSecret(payload: string): string {
  const value = String(payload || '').trim();
  if (!value) throw new Error('Missing encrypted Slack payload.');
  const [version, ivRaw, tagRaw, bodyRaw] = value.split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !bodyRaw) {
    throw new Error('Invalid encrypted Slack payload format.');
  }

  const key = getKey();
  const iv = Buffer.from(ivRaw, 'base64url');
  const tag = Buffer.from(tagRaw, 'base64url');
  const body = Buffer.from(bodyRaw, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Invalid encrypted Slack payload size.');
  }

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  return plain.toString('utf8');
}

export function redactSlackToken(token: string): string {
  const value = String(token || '').trim();
  if (!value) return '';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}
