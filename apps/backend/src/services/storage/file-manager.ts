import fs from 'fs';
import path from 'path';
import axios from 'axios';
import {
  computeRetryBackoffMs,
  createProxyPoolFromEnv,
  isRetryableNetworkError,
  proxyUrlToAxiosConfig,
  sleep,
} from '../network/proxy-rotation';
import { STORAGE_ROOT } from './storage-root';

const STORAGE_BASE = STORAGE_ROOT;

const DOWNLOAD_TIMEOUT_MS = Number.parseInt(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || '60000', 10);
const DOWNLOAD_MAX_ATTEMPTS = Number.parseInt(process.env.MEDIA_DOWNLOAD_MAX_ATTEMPTS || '3', 10);

const DOWNLOAD_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

const mediaDownloadProxyPool = createProxyPoolFromEnv({
  name: 'media-downloader',
  envKeys: [
    'MEDIA_DOWNLOADER_PROXY_URLS',
    'MEDIA_PROXY_URLS',
    'SCRAPER_PROXY_URLS',
    'PROXY_URLS',
    'PROXY_URL',
  ],
  includeDirect: true,
  includeDirectEnvKey: 'MEDIA_PROXY_ALLOW_DIRECT',
  maxFailuresBeforeCooldown: Number(process.env.MEDIA_PROXY_MAX_FAILURES || 2),
  maxFailuresEnvKey: 'MEDIA_PROXY_MAX_FAILURES',
  cooldownMs: Number(process.env.MEDIA_PROXY_COOLDOWN_MS || 120_000),
  cooldownEnvKey: 'MEDIA_PROXY_COOLDOWN_MS',
});

type DownloadAndSaveOptions = {
  contextLabel?: string;
  maxAttempts?: number;
};

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function randomUserAgent(): string {
  return DOWNLOAD_USER_AGENTS[Math.floor(Math.random() * DOWNLOAD_USER_AGENTS.length)];
}

function isWithinStorageRoot(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  return resolved === STORAGE_BASE || resolved.startsWith(`${STORAGE_BASE}${path.sep}`);
}

function validateDownloadBuffer(url: string, contentTypeRaw: string, buffer: Buffer): void {
  const contentType = (contentTypeRaw || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(`Invalid content type: ${contentType}. Likely a login page or error page.`);
  }

  if (buffer.length > 0) {
    const head = buffer.slice(0, 300).toString('utf-8').toLowerCase();
    if (head.includes('<html') || head.includes('<!doctype') || head.includes('<body')) {
      throw new Error(`Detected HTML content in download buffer for ${url}. Rejecting.`);
    }
  }
}

export const STORAGE_PATHS = {
  clientMedia: (clientId: string, postId: string) => 
    path.join(STORAGE_BASE, 'media', 'client', clientId, postId),
  competitorMedia: (competitorId: string, postId: string) => 
    path.join(STORAGE_BASE, 'media', 'competitor', competitorId, postId),
  documents: (clientId: string) => 
    path.join(STORAGE_BASE, 'documents', clientId),
};

export const fileManager = {
  resolveStoragePath(filePath: string, options: { allowOutsideStorage?: boolean } = {}): string {
    const resolved = path.resolve(filePath);
    if (!options.allowOutsideStorage && !isWithinStorageRoot(resolved)) {
      throw new Error(`Refusing to write outside storage root: ${resolved}`);
    }
    return resolved;
  },

  /**
   * Download media from URL and save to storage
   */
  async downloadAndSave(
    url: string,
    savePath: string,
    headers: Record<string, string> = {},
    options: DownloadAndSaveOptions = {}
  ): Promise<void> {
    const resolvedSavePath = this.resolveStoragePath(savePath);
    const dir = path.dirname(resolvedSavePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const maxAttempts = normalizePositiveInt(
      Number(options.maxAttempts || DOWNLOAD_MAX_ATTEMPTS),
      normalizePositiveInt(DOWNLOAD_MAX_ATTEMPTS, 3)
    );
    const contextLabel = options.contextLabel || 'media-download';

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const target = mediaDownloadProxyPool.acquire();
      const requestHeaders = {
        'User-Agent': headers['User-Agent'] || randomUserAgent(),
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.instagram.com/',
        ...headers,
      };

      try {
        const proxyConfig = proxyUrlToAxiosConfig(target.proxyUrl);
        if (target.proxyUrl && !proxyConfig) {
          throw new Error(`Unsupported proxy protocol for HTTP download: ${target.label}`);
        }

        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: normalizePositiveInt(DOWNLOAD_TIMEOUT_MS, 60_000),
          headers: requestHeaders,
          proxy: proxyConfig ?? false,
          validateStatus: (status) => status >= 200 && status < 300,
        });

        const contentType = String(response.headers['content-type'] || '');
        const buffer = Buffer.from(response.data);
        validateDownloadBuffer(url, contentType, buffer);

        await fs.promises.writeFile(resolvedSavePath, buffer);
        mediaDownloadProxyPool.recordSuccess(target.id);

        console.log(
          `[FileManager] Saved (${contextLabel}): ${resolvedSavePath} (${buffer.length} bytes, Type: ${contentType || 'unknown'}, via ${target.label})`
        );
        return;
      } catch (error: any) {
        mediaDownloadProxyPool.recordFailure(target.id);
        const message = error?.message || 'Unknown download error';
        lastError = new Error(
          `Download failed for ${url} (attempt ${attempt}/${maxAttempts}, ${target.label}): ${message}`
        );

        if (attempt >= maxAttempts || !isRetryableNetworkError(error)) {
          throw lastError;
        }

        await sleep(computeRetryBackoffMs(attempt));
      }
    }

    throw lastError || new Error(`Download failed for ${url}`);
  },

  /**
   * Save buffer to disk
   */
  saveBuffer(buffer: Buffer, savePath: string): void {
    const resolvedSavePath = this.resolveStoragePath(savePath);
    const dir = path.dirname(resolvedSavePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedSavePath, buffer);
    console.log(`[FileManager] Saved: ${resolvedSavePath} (${buffer.length} bytes)`);
  },

  /**
   * Check if file exists
   */
  exists(filePath: string): boolean {
    return fs.existsSync(path.resolve(filePath));
  },

  /**
   * Delete file
   */
  delete(filePath: string): void {
    const resolvedPath = path.resolve(filePath);
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
      console.log(`[FileManager] Deleted: ${resolvedPath}`);
    }
  },

  /**
   * Get file stats
   */
  getStats(filePath: string) {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) return null;
    return fs.statSync(resolvedPath);
  },

  /**
   * Convert storage path to URL for frontend
   */
  toUrl(storagePath: string): string {
    if (!storagePath) return '';
    if (/^https?:\/\//i.test(storagePath)) return storagePath;

    const absolute = path.isAbsolute(storagePath) ? storagePath : path.resolve(storagePath);
    if (!isWithinStorageRoot(absolute)) {
      return storagePath;
    }

    const relativePath = path.relative(STORAGE_BASE, absolute).split(path.sep).join('/');
    return `/storage/${relativePath}`;
  },

  /**
   * Generate media filename
   */
  generateFilename(mediaId: string, mediaType: string, extension: string): string {
    const safeExt = extension.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
    return `${mediaId}.${safeExt}`;
  },

  /**
   * Get file extension from URL
   */
  getExtension(url: string): string {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || '';
      const last = pathname.split('/').pop() || '';
      const dot = last.lastIndexOf('.');
      if (dot > -1 && dot < last.length - 1) {
        const ext = last.slice(dot + 1).toLowerCase();
        if (/^[a-z0-9]{2,6}$/.test(ext)) return ext;
      }
    } catch {
      const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
      if (match) return match[1];
    }
    
    // Default extensions based on common URL patterns
    if (url.includes('jpg') || url.includes('jpeg')) return 'jpg';
    if (url.includes('png')) return 'png';
    if (url.includes('mp4')) return 'mp4';
    if (url.includes('webp')) return 'webp';
    
    return 'jpg'; // Default
  },
};
