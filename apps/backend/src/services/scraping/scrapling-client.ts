import axios from 'axios';
import type {
  ScraplingCrawlPage,
  ScraplingCrawlRequest,
  ScraplingCrawlResponse,
  ScraplingExtractRequest,
  ScraplingExtractResponse,
  ScraplingFetchRequest,
  ScraplingFetchResponse,
  ScraplingMode,
} from './scrapling-types';

const DEFAULT_TIMEOUT_MS = Number(process.env.SCRAPLING_TIMEOUT_MS || 20_000);
const WORKER_URL = String(process.env.SCRAPLING_WORKER_URL || '').replace(/\/$/, '');

function compactText(value: string, maxChars = 4000): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function stripHtml(html: string): string {
  return compactText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
    16_000,
  );
}

function guessFetcher(mode: ScraplingMode | undefined, blocked: boolean): ScraplingMode {
  if (mode && mode !== 'AUTO') return mode;
  if (blocked) return 'DYNAMIC';
  return 'HTTP';
}

function isBlockedLike(statusCode: number | null): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 429 || statusCode === 503;
}

function normalizeMode(raw: unknown): ScraplingMode {
  const value = String(raw || 'AUTO').trim().toUpperCase();
  if (value === 'HTTP' || value === 'DYNAMIC' || value === 'STEALTH') return value;
  return 'AUTO';
}

function hasUsableWorkerContent(payload: { html?: string | null; text?: string | null }): boolean {
  const html = String(payload.html || '').trim();
  const text = String(payload.text || '').trim();
  return html.length > 0 || text.length > 0;
}

async function fetchViaWorker(payload: ScraplingFetchRequest): Promise<ScraplingFetchResponse> {
  const response = await axios.post(`${WORKER_URL}/v1/fetch`, payload, {
    timeout: payload.timeoutMs || DEFAULT_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
  const data = (response.data || {}) as Record<string, any>;
  const metadata =
    typeof data.metadata === 'object' && data.metadata ? (data.metadata as Record<string, unknown>) : {};
  return {
    ok: Boolean(data.ok ?? true),
    finalUrl: String(data.finalUrl || payload.url),
    statusCode: Number.isFinite(Number(data.statusCode)) ? Number(data.statusCode) : null,
    fetcherUsed: normalizeMode(data.fetcherUsed || payload.mode),
    blockedSuspected: Boolean(data.blockedSuspected),
    html: typeof data.html === 'string' ? data.html : null,
    text: typeof data.text === 'string' ? data.text : null,
    timings: typeof data.timings === 'object' && data.timings ? data.timings : undefined,
    metadata: {
      sourceTransport: 'SCRAPLING_WORKER',
      ...metadata,
    },
  };
}

async function fetchViaFallback(payload: ScraplingFetchRequest): Promise<ScraplingFetchResponse> {
  const response = await axios.get(payload.url, {
    timeout: payload.timeoutMs || DEFAULT_TIMEOUT_MS,
    responseType: 'text',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    validateStatus: () => true,
  });

  const html = typeof response.data === 'string' ? response.data : '';
  const blocked = isBlockedLike(response.status) || !html.trim();

  return {
    ok: response.status >= 200 && response.status < 400,
    finalUrl: String((response.request as any)?.res?.responseUrl || payload.url),
    statusCode: Number.isFinite(response.status) ? response.status : null,
    fetcherUsed: guessFetcher(payload.mode, blocked),
    blockedSuspected: blocked,
    html: payload.returnHtml === false ? null : html,
    text: payload.returnText === false ? null : stripHtml(html),
    timings: undefined,
    metadata: {
      sourceTransport: 'HTTP_FALLBACK',
      fallback: true,
      contentType: String(response.headers['content-type'] || ''),
    },
    fallbackReason: 'SCRAPLING_WORKER_URL is not configured; used lightweight HTTP fallback.',
  };
}

function normalizeHostname(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/^www\./i, '');
}

function normalizeUrlForQueue(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.hash = '';
    const normalized = parsed.toString();
    if (parsed.pathname === '/' || !normalized.endsWith('/')) return normalized;
    return normalized.slice(0, -1);
  } catch {
    return '';
  }
}

function toAllowedDomainSet(payload: ScraplingCrawlRequest): Set<string> {
  const candidates =
    Array.isArray(payload.allowedDomains) && payload.allowedDomains.length > 0
      ? payload.allowedDomains
      : payload.startUrls;
  const domains = candidates
    .map((entry) => {
      const value = String(entry || '').trim();
      if (!value) return '';
      try {
        const parsed = new URL(value);
        return normalizeHostname(parsed.hostname);
      } catch {
        return normalizeHostname(value.replace(/^https?:\/\//i, '').split('/')[0] || '');
      }
    })
    .filter(Boolean);
  return new Set(domains);
}

function isAllowedUrlByDomain(url: string, allowedDomains: Set<string>): boolean {
  if (allowedDomains.size === 0) return true;
  try {
    const host = normalizeHostname(new URL(url).hostname);
    return host.length > 0 && allowedDomains.has(host);
  } catch {
    return false;
  }
}

function extractLinksFromHtml(html: string, baseUrl: string, allowedDomains: Set<string>): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const source = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  if (!source.trim()) return links;

  const hrefRegex = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'<>`]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(source))) {
    const rawHref = String(match[1] || match[2] || match[3] || '').trim();
    if (!rawHref) continue;
    if (
      rawHref.startsWith('#') ||
      /^javascript:/i.test(rawHref) ||
      /^mailto:/i.test(rawHref) ||
      /^tel:/i.test(rawHref) ||
      /^data:/i.test(rawHref) ||
      /^blob:/i.test(rawHref) ||
      /window\.location/i.test(rawHref)
    ) {
      continue;
    }

    try {
      const resolved = new URL(rawHref, baseUrl).toString();
      const normalized = normalizeUrlForQueue(resolved);
      if (!normalized) continue;
      if (/\.(?:pdf|jpg|jpeg|png|gif|svg|webp|mp4|mov|avi|zip|rar|7z|docx?|xlsx?|pptx?)(?:$|[?#])/i.test(normalized)) {
        continue;
      }
      if (!isAllowedUrlByDomain(normalized, allowedDomains)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(normalized);
    } catch {
      // skip malformed href values
    }
  }

  return links;
}

function fallbackExtract(request: ScraplingExtractRequest): ScraplingExtractResponse {
  const bodyText = request.snapshotHtml ? stripHtml(request.snapshotHtml) : '';
  const extracted = {
    text: compactText(bodyText || '', 5000),
  };
  return {
    ok: true,
    extracted,
    confidence: bodyText ? 0.45 : 0.2,
    warnings: [
      'Using fallback extract mode. Configure SCRAPLING_WORKER_URL for full structured extraction.',
    ],
    adaptiveUpdates: [],
    fallbackReason: 'SCRAPLING_WORKER_URL is not configured.',
  };
}

async function fallbackCrawl(payload: ScraplingCrawlRequest): Promise<ScraplingCrawlResponse> {
  const fallbackMaxPages = Math.max(1, Math.min(60, Number(payload.maxPages || 20)));
  const fallbackMaxDepth = Math.max(0, Math.min(5, Number(payload.maxDepth || 1)));
  const allowedDomains = toAllowedDomainSet(payload);
  const queue: Array<{ url: string; depth: number }> = payload.startUrls
    .map((entry) => normalizeUrlForQueue(entry))
    .filter(Boolean)
    .map((url) => ({ url, depth: 0 }));
  const queuedSet = new Set<string>(queue.map((entry) => entry.url));
  const visited = new Set<string>();
  const pages: ScraplingCrawlPage[] = [];
  let failed = 0;
  let queued = queue.length;

  while (queue.length > 0 && pages.length < fallbackMaxPages) {
    const next = queue.shift();
    if (!next) break;
    const currentUrl = normalizeUrlForQueue(next.url);
    if (!currentUrl) continue;
    queuedSet.delete(currentUrl);
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);
    if (!isAllowedUrlByDomain(currentUrl, allowedDomains)) continue;

    try {
      const result = await fetchViaFallback({
        url: currentUrl,
        mode: payload.mode,
        timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, 12_000),
        returnHtml: true,
        returnText: true,
      });
      pages.push({
        url: currentUrl,
        finalUrl: result.finalUrl,
        statusCode: result.statusCode || undefined,
        fetcherUsed: result.fetcherUsed,
        text: result.text || null,
        html: result.html || null,
        metadata: result.metadata || { sourceTransport: 'HTTP_FALLBACK' },
      });

      if (next.depth >= fallbackMaxDepth) continue;

      const baseUrl = result.finalUrl || currentUrl;
      const links = extractLinksFromHtml(result.html || '', baseUrl, allowedDomains);
      for (const link of links) {
        if (pages.length + queue.length >= fallbackMaxPages * 3) break;
        if (visited.has(link) || queuedSet.has(link)) continue;
        queue.push({ url: link, depth: next.depth + 1 });
        queuedSet.add(link);
        queued += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    ok: true,
    runId: `fallback-${Date.now()}`,
    summary: {
      queued,
      fetched: pages.filter((page) => (page.statusCode || 0) >= 200 && (page.statusCode || 0) < 400).length,
      failed: pages.filter((page) => (page.statusCode || 0) >= 400 || !page.statusCode).length + failed,
    },
    pages,
    fallbackReason: 'Used HTTP fallback crawler with on-page link discovery.',
  };
}

export const scraplingClient = {
  isWorkerConfigured(): boolean {
    return Boolean(WORKER_URL);
  },

  async fetch(request: ScraplingFetchRequest): Promise<ScraplingFetchResponse> {
    const payload: ScraplingFetchRequest = {
      ...request,
      mode: normalizeMode(request.mode),
      timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS,
      returnHtml: request.returnHtml !== false,
      returnText: request.returnText !== false,
    };

    if (!WORKER_URL) {
      return fetchViaFallback(payload);
    }

    try {
      const workerResult = await fetchViaWorker(payload);
      if (workerResult.ok && !workerResult.blockedSuspected && !hasUsableWorkerContent(workerResult)) {
        console.warn('[ScraplingClient] Worker returned empty html/text, falling back to HTTP fetch.');
        const fallback = await fetchViaFallback(payload);
        fallback.fallbackReason =
          workerResult.fallbackReason ||
          'Worker returned empty html/text payload; used HTTP fallback for usable content.';
        fallback.metadata = {
          ...(workerResult.metadata || {}),
          ...(fallback.metadata || {}),
          workerEmptyPayload: true,
        };
        return fallback;
      }
      return workerResult;
    } catch (error: any) {
      console.warn('[ScraplingClient] Worker fetch failed, falling back to lightweight mode:', error?.message || error);
      const fallback = await fetchViaFallback(payload);
      fallback.fallbackReason = `Worker fetch failed: ${error?.message || 'unknown error'}`;
      return fallback;
    }
  },

  async crawl(request: ScraplingCrawlRequest): Promise<ScraplingCrawlResponse> {
    const payload: ScraplingCrawlRequest = {
      ...request,
      mode: normalizeMode(request.mode),
      maxPages: Math.max(1, Math.min(200, Number(request.maxPages || 20))),
      maxDepth: Math.max(0, Math.min(5, Number(request.maxDepth || 1))),
      concurrency: Math.max(1, Math.min(20, Number(request.concurrency || 4))),
    };

    if (!WORKER_URL) {
      return fallbackCrawl(payload);
    }

    try {
      const crawlTimeoutMs = Math.max(
        DEFAULT_TIMEOUT_MS,
        60_000,
        Math.min(600_000, (payload.maxPages || 20) * 4_000),
      );
      const response = await axios.post(`${WORKER_URL}/v1/crawl`, payload, {
        timeout: crawlTimeoutMs,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (response.data || {}) as Record<string, any>;
      const pages: ScraplingCrawlPage[] = Array.isArray(data.pages)
        ? data.pages.map((page) => ({
            url: String(page.url || ''),
            finalUrl: typeof page.finalUrl === 'string' ? page.finalUrl : undefined,
            statusCode: Number.isFinite(Number(page.statusCode)) ? Number(page.statusCode) : undefined,
            fetcherUsed: normalizeMode(page.fetcherUsed),
            text: typeof page.text === 'string' ? page.text : null,
            html: typeof page.html === 'string' ? page.html : null,
            metadata:
              typeof page.metadata === 'object' && page.metadata
                ? (page.metadata as Record<string, unknown>)
                : { sourceTransport: 'SCRAPLING_WORKER' },
          }))
        : [];

      const hasUsablePageContent = pages.some((page) => hasUsableWorkerContent(page));
      if (pages.length > 0 && !hasUsablePageContent) {
        console.warn('[ScraplingClient] Worker crawl returned empty page payloads, falling back to HTTP crawl mode.');
        const fallback = await fallbackCrawl(payload);
        fallback.fallbackReason =
          data.fallbackReason ||
          'Worker crawl pages contained no html/text; used HTTP fallback crawl for usable content.';
        return fallback;
      }

      return {
        ok: Boolean(data.ok ?? true),
        runId: String(data.runId || `run-${Date.now()}`),
        summary: {
          queued: Number(data.summary?.queued || 0),
          fetched: Number(data.summary?.fetched || 0),
          failed: Number(data.summary?.failed || 0),
        },
        pages,
      };
    } catch (error: any) {
      console.warn('[ScraplingClient] Worker crawl failed, using fallback crawl mode:', error?.message || error);
      const fallback = await fallbackCrawl(payload);
      fallback.fallbackReason = `Worker crawl failed: ${error?.message || 'unknown error'}`;
      return fallback;
    }
  },

  async extract(request: ScraplingExtractRequest): Promise<ScraplingExtractResponse> {
    if (!WORKER_URL) return fallbackExtract(request);

    try {
      const response = await axios.post(`${WORKER_URL}/v1/extract`, request, {
        timeout: Math.max(DEFAULT_TIMEOUT_MS, 40_000),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (response.data || {}) as Record<string, any>;
      return {
        ok: Boolean(data.ok ?? true),
        extracted: (typeof data.extracted === 'object' && data.extracted ? data.extracted : {}) as Record<string, unknown>,
        confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : 0,
        warnings: Array.isArray(data.warnings) ? data.warnings.map((item) => String(item)) : [],
        adaptiveUpdates: Array.isArray(data.adaptiveUpdates)
          ? data.adaptiveUpdates
              .map((row) => ({
                key: String(row?.key || ''),
                element: (row?.element && typeof row.element === 'object' ? row.element : {}) as Record<string, unknown>,
              }))
              .filter((row) => row.key)
          : [],
      };
    } catch (error: any) {
      const fallback = fallbackExtract(request);
      fallback.fallbackReason = `Worker extract failed: ${error?.message || 'unknown error'}`;
      return fallback;
    }
  },
};
