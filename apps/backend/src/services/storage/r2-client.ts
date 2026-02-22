import { S3Client } from '@aws-sdk/client-s3';

/**
 * Cloudflare R2 client (S3-compatible API).
 *
 * Required env vars:
 *   R2_ENDPOINT        = https://<account_id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID   = R2 API token access key
 *   R2_SECRET_ACCESS_KEY = R2 API token secret key
 *   R2_BUCKET_NAME     = bucket name (e.g. brand-strategy-media)
 *   R2_PUBLIC_URL      = https://media.yourdomain.com  OR  https://pub-xxx.r2.dev
 *
 * Optional:
 *   USE_R2_STORAGE=true  — gates whether the R2 path is used (defaults to false)
 */

export function isR2Configured(): boolean {
  return (
    String(process.env.USE_R2_STORAGE || '').toLowerCase() === 'true' &&
    Boolean(process.env.R2_ENDPOINT) &&
    Boolean(process.env.R2_ACCESS_KEY_ID) &&
    Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
    Boolean(process.env.R2_BUCKET_NAME) &&
    Boolean(process.env.R2_PUBLIC_URL)
  );
}

export const R2_BUCKET = process.env.R2_BUCKET_NAME || '';
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

function buildR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  });
}

// Lazily initialized so the client is only created when actually used.
let _r2Client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (!_r2Client) {
    _r2Client = buildR2Client();
  }
  return _r2Client;
}
