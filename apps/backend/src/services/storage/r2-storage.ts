import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import axios from 'axios';
import { getR2Client, R2_BUCKET, R2_PUBLIC_URL } from './r2-client';

type UploadFromUrlOptions = {
  contextLabel?: string;
  contentType?: string;
};

/**
 * Download a URL into memory and upload to R2.
 * Returns the R2 key that was written.
 *
 * Throws if the download is empty or the buffer is too small to be a real media file.
 */
export async function uploadUrlToR2(
  url: string,
  r2Key: string,
  requestHeaders: Record<string, string> = {},
  options: UploadFromUrlOptions = {}
): Promise<{ r2Key: string; sizeBytes: number; contentType: string }> {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || 60_000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': 'https://www.instagram.com/',
      ...requestHeaders,
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const buffer = Buffer.from(response.data);
  const detectedContentType =
    options.contentType ||
    String(response.headers['content-type'] || '').split(';')[0].trim() ||
    'application/octet-stream';

  if (buffer.length === 0) {
    throw new Error(`Empty response body downloading ${url}`);
  }
  if (buffer.length < 512) {
    throw new Error(`Suspiciously small response (${buffer.length} bytes) for ${url}`);
  }

  const head = buffer.slice(0, 300).toString('utf-8').toLowerCase();
  if (head.includes('<html') || head.includes('<!doctype')) {
    throw new Error(`HTML response detected downloading ${url} - likely login wall`);
  }

  const upload = new Upload({
    client: getR2Client(),
    params: {
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: buffer,
      ContentType: detectedContentType,
    },
  });
  await upload.done();

  console.log(
    `[R2Storage] Uploaded ${options.contextLabel || r2Key}: ${buffer.length} bytes → r2://${R2_BUCKET}/${r2Key}`
  );

  return { r2Key, sizeBytes: buffer.length, contentType: detectedContentType };
}

/**
 * Upload a raw Buffer to R2.
 */
export async function uploadBufferToR2(
  buffer: Buffer,
  r2Key: string,
  contentType = 'application/octet-stream'
): Promise<void> {
  const upload = new Upload({
    client: getR2Client(),
    params: {
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: buffer,
      ContentType: contentType,
    },
  });
  await upload.done();
}

/**
 * Download an object from R2 as a Buffer.
 */
export async function downloadFromR2(r2Key: string): Promise<Buffer> {
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key })
  );
  if (!response.Body) throw new Error(`Empty R2 response for key: ${r2Key}`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as Readable) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete an object from R2.
 */
export async function deleteFromR2(r2Key: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }));
}

/**
 * Convert an R2 key to a public URL.
 * If the value is already an http(s) URL, return it as-is.
 */
export function r2KeyToUrl(keyOrUrl: string): string {
  if (!keyOrUrl) return '';
  if (/^https?:\/\//i.test(keyOrUrl)) return keyOrUrl;
  return `${R2_PUBLIC_URL}/${keyOrUrl}`;
}
