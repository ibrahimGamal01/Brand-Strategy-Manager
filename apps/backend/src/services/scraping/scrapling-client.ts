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

async function fetchViaWorker(payload: ScraplingFetchRequest): Promise<ScraplingFetchResponse> {
  const response = await axios.post(`${WORKER_URL}/v1/fetch`, payload, {
    timeout: payload.timeoutMs || DEFAULT_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
  const data = (response.data || {}) as Record<string, any>;
  return {
    ok: Boolean(data.ok ?? true),
    finalUrl: String(data.finalUrl || payload.url),
    statusCode: Number.isFinite(Number(data.statusCode)) ? Number(data.statusCode) : null,
    fetcherUsed: normalizeMode(data.fetcherUsed || payload.mode),
    blockedSuspected: Boolean(data.blockedSuspected),
    html: typeof data.html === 'string' ? data.html : null,
    text: typeof data.text === 'string' ? data.text : null,
    timings: typeof data.timings === 'object' && data.timings ? data.timings : undefined,
    metadata: typeof data.metadata === 'object' && data.metadata ? data.metadata : undefined,
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
      fallback: true,
      contentType: String(response.headers['content-type'] || ''),
    },
    fallbackReason: 'SCRAPLING_WORKER_URL is not configured; used lightweight HTTP fallback.',
  };
}

function normalizeFallbackCrawlPages(
  startUrls: string[],
  fetchResults: ScraplingFetchResponse[],
): ScraplingCrawlPage[] {
  return fetchResults.map((result, index) => ({
    url: startUrls[index],
    finalUrl: result.finalUrl,
    statusCode: result.statusCode || undefined,
    fetcherUsed: result.fetcherUsed,
    text: result.text || null,
    html: result.html || null,
  }));
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
  const targets = payload.startUrls.slice(0, payload.maxPages || 20);
  const results = await Promise.all(
    targets.map((url) =>
      scraplingClient.fetch({ url, mode: payload.mode, timeoutMs: DEFAULT_TIMEOUT_MS, returnHtml: false, returnText: true }),
    ),
  );
  const pages = normalizeFallbackCrawlPages(targets, results);
  return {
    ok: true,
    runId: `fallback-${Date.now()}`,
    summary: {
      queued: targets.length,
      fetched: pages.filter((page) => (page.statusCode || 0) >= 200 && (page.statusCode || 0) < 400).length,
      failed: pages.filter((page) => (page.statusCode || 0) >= 400 || !page.statusCode).length,
    },
    pages,
    fallbackReason: 'SCRAPLING_WORKER_URL is not configured; fallback crawl only fetches provided URLs.',
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
      return await fetchViaWorker(payload);
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
      const response = await axios.post(`${WORKER_URL}/v1/crawl`, payload, {
        timeout: Math.max(DEFAULT_TIMEOUT_MS, 60_000),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (response.data || {}) as Record<string, any>;
      return {
        ok: Boolean(data.ok ?? true),
        runId: String(data.runId || `run-${Date.now()}`),
        summary: {
          queued: Number(data.summary?.queued || 0),
          fetched: Number(data.summary?.fetched || 0),
          failed: Number(data.summary?.failed || 0),
        },
        pages: Array.isArray(data.pages)
          ? data.pages.map((page) => ({
              url: String(page.url || ''),
              finalUrl: typeof page.finalUrl === 'string' ? page.finalUrl : undefined,
              statusCode: Number.isFinite(Number(page.statusCode)) ? Number(page.statusCode) : undefined,
              fetcherUsed: normalizeMode(page.fetcherUsed),
              text: typeof page.text === 'string' ? page.text : null,
              html: typeof page.html === 'string' ? page.html : null,
            }))
          : [],
      };
    } catch (error: any) {
      console.warn('[ScraplingClient] Worker crawl failed, using fallback crawl mode:', error?.message || error);
      const fallback = await fallbackCrawl({ ...payload, maxPages: Math.min(payload.maxPages || 20, 20) });
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
