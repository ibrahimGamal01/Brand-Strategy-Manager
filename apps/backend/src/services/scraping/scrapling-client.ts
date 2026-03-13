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
import {
  computeRetryBackoffMs,
  createProxyPoolFromEnv,
  isRetryableNetworkError,
  logProxyAttempt,
  proxyUrlToAxiosConfig,
  resolveAllowDirectForScope,
  sleep,
  type ProxyAcquireTarget,
} from '../network/proxy-rotation';

const DEFAULT_TIMEOUT_MS = Number(process.env.SCRAPLING_TIMEOUT_MS || 20_000);
const WORKER_URL = String(process.env.SCRAPLING_WORKER_URL || '').replace(/\/$/, '');
const DEFAULT_CRAWL_TIMEOUT_MS = Math.max(
  DEFAULT_TIMEOUT_MS,
  Number(process.env.SCRAPLING_CRAWL_TIMEOUT_DEFAULT_MS || 90_000)
);
const MAX_CRAWL_TIMEOUT_MS = Math.max(
  DEFAULT_CRAWL_TIMEOUT_MS,
  Number(process.env.SCRAPLING_CRAWL_TIMEOUT_MAX_MS || 300_000)
);
const SCRAPLING_WARNING_THROTTLE_MS = Math.max(10_000, Number(process.env.SCRAPLING_WARNING_THROTTLE_MS || 60_000));
const SCRAPLING_FETCH_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.SCRAPLING_FETCH_MAX_ATTEMPTS || process.env.SCRAPER_COMMAND_MAX_ATTEMPTS || 3)
);
const scraplingWarningTimestamps = new Map<string, number>();

type ScraplingProxyStrategy = 'NONE' | 'ROTATE' | 'FIXED';

const scraplingRotateProxyPool = createProxyPoolFromEnv({
  name: 'scrapling-rotate',
  envKeys: ['SCRAPLING_PROXY_URLS', 'SCRAPER_PROXY_URLS', 'PROXY_URLS', 'PROXY_URL'],
  includeDirect: false,
  maxFailuresBeforeCooldown: Number(process.env.SCRAPER_PROXY_MAX_FAILURES || 2),
  maxFailuresEnvKey: 'SCRAPER_PROXY_MAX_FAILURES',
  cooldownMs: Number(process.env.SCRAPER_PROXY_COOLDOWN_MS || 120_000),
  cooldownEnvKey: 'SCRAPER_PROXY_COOLDOWN_MS',
  fileEnvKey: 'PROXY_LIST_PATH',
});

const scraplingFixedProxyPool = createProxyPoolFromEnv({
  name: 'scrapling-fixed',
  envKeys: ['SCRAPLING_PROXY_URL', 'SCRAPER_PROXY_URL', 'PROXY_URL'],
  includeDirect: false,
  maxFailuresBeforeCooldown: Number(process.env.SCRAPER_PROXY_MAX_FAILURES || 2),
  maxFailuresEnvKey: 'SCRAPER_PROXY_MAX_FAILURES',
  cooldownMs: Number(process.env.SCRAPER_PROXY_COOLDOWN_MS || 120_000),
  cooldownEnvKey: 'SCRAPER_PROXY_COOLDOWN_MS',
});

function warnScraplingWithThrottle(key: string, message: string, detail?: unknown): void {
  const now = Date.now();
  const previous = scraplingWarningTimestamps.get(key) || 0;
  if (now - previous < SCRAPLING_WARNING_THROTTLE_MS) return;
  scraplingWarningTimestamps.set(key, now);
  if (detail !== undefined) {
    console.warn(message, detail);
  } else {
    console.warn(message);
  }
}

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

function normalizeProxyStrategy(raw: unknown): ScraplingProxyStrategy {
  const value = String(raw || 'NONE').trim().toUpperCase();
  if (value === 'FIXED' || value === 'ROTATE') return value;
  return 'NONE';
}

function buildDirectTarget(id: string): ProxyAcquireTarget {
  return {
    id,
    proxyUrl: null,
    label: 'direct',
    isDirect: true,
    cooldownHit: false,
  };
}

function decorateWithProxyMetadata(
  result: ScraplingFetchResponse,
  params: {
    requestedStrategy: ScraplingProxyStrategy;
    resolvedStrategy: ScraplingProxyStrategy | 'NONE';
    target: ProxyAcquireTarget;
    attempt: number;
    allowDirect: boolean;
  }
): ScraplingFetchResponse {
  return {
    ...result,
    metadata: {
      ...(result.metadata || {}),
      requestedProxyStrategy: params.requestedStrategy,
      resolvedProxyStrategy: params.resolvedStrategy,
      proxyStrategy: params.resolvedStrategy,
      proxyTargetId: params.target.id,
      proxyTarget: params.target.label,
      proxyIsDirect: params.target.isDirect,
      proxyAttempt: params.attempt,
      proxyScope: 'scrapling',
      proxyAllowDirect: params.allowDirect,
    },
  };
}

function selectScraplingTarget(params: {
  requestedStrategy: ScraplingProxyStrategy;
  attempt: number;
  maxAttempts: number;
  allowDirect: boolean;
}): {
  target: ProxyAcquireTarget;
  resolvedStrategy: ScraplingProxyStrategy | 'NONE';
  pool: 'rotate' | 'fixed' | null;
} {
  const { requestedStrategy, attempt, maxAttempts, allowDirect } = params;
  const directFallbackAttempt = allowDirect && requestedStrategy !== 'NONE' && attempt === maxAttempts && maxAttempts > 1;

  if (requestedStrategy === 'NONE') {
    return {
      target: buildDirectTarget('scrapling:direct'),
      resolvedStrategy: 'NONE',
      pool: null,
    };
  }

  if (requestedStrategy === 'FIXED') {
    if (directFallbackAttempt) {
      return {
        target: buildDirectTarget('scrapling:fixed:direct'),
        resolvedStrategy: 'NONE',
        pool: null,
      };
    }
    if (!scraplingFixedProxyPool.hasConfiguredProxies()) {
      if (allowDirect) {
        return {
          target: buildDirectTarget('scrapling:fixed:direct'),
          resolvedStrategy: 'NONE',
          pool: null,
        };
      }
      throw new Error('Scrapling FIXED proxy strategy requested but no fixed proxy is configured');
    }
    const target = scraplingFixedProxyPool.acquire();
    return {
      target,
      resolvedStrategy: target.isDirect ? 'NONE' : 'FIXED',
      pool: 'fixed',
    };
  }

  if (directFallbackAttempt) {
    return {
      target: buildDirectTarget('scrapling:rotate:direct'),
      resolvedStrategy: 'NONE',
      pool: null,
    };
  }

  if (!scraplingRotateProxyPool.hasConfiguredProxies()) {
    if (allowDirect) {
      return {
        target: buildDirectTarget('scrapling:rotate:direct'),
        resolvedStrategy: 'NONE',
        pool: null,
      };
    }
    throw new Error('Scrapling ROTATE proxy strategy requested but no rotating proxies are configured');
  }

  const target = scraplingRotateProxyPool.acquire();
  return {
    target,
    resolvedStrategy: target.isDirect ? 'NONE' : 'ROTATE',
    pool: 'rotate',
  };
}

function hasUsableWorkerContent(payload: { html?: string | null; text?: string | null }): boolean {
  const html = String(payload.html || '').trim();
  const text = String(payload.text || '').trim();
  return html.length > 0 || text.length > 0;
}

function resolveCrawlTimeoutMs(requestedTimeoutMs: unknown, maxPages: number): number {
  const requested = Number(requestedTimeoutMs || 0);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.max(45_000, Math.min(MAX_CRAWL_TIMEOUT_MS, Math.round(requested)));
  }
  const derived = Math.round(maxPages * 2_500);
  return Math.max(DEFAULT_CRAWL_TIMEOUT_MS, Math.min(MAX_CRAWL_TIMEOUT_MS, derived));
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
  const proxyConfig = proxyUrlToAxiosConfig(payload.proxyUrl || null);
  const response = await axios.get(payload.url, {
    timeout: payload.timeoutMs || DEFAULT_TIMEOUT_MS,
    responseType: 'text',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    proxy: proxyConfig ?? false,
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
      proxyTarget: payload.proxyUrl || null,
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
  const deadlineMs = Number(payload.timeoutMs || 0) > 0 ? Date.now() + Number(payload.timeoutMs) : null;
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
  let timedOut = false;

  while (queue.length > 0 && pages.length < fallbackMaxPages) {
    if (deadlineMs && Date.now() >= deadlineMs) {
      timedOut = true;
      break;
    }
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
    fallbackReason: timedOut
      ? `Used HTTP fallback crawler with on-page link discovery, but timed out after ${Number(payload.timeoutMs || 0)}ms.`
      : 'Used HTTP fallback crawler with on-page link discovery.',
  };
}

export const scraplingClient = {
  isWorkerConfigured(): boolean {
    return Boolean(WORKER_URL);
  },

  async fetch(request: ScraplingFetchRequest): Promise<ScraplingFetchResponse> {
    const requestedStrategy = normalizeProxyStrategy(request.proxyStrategy);
    const allowDirect = resolveAllowDirectForScope('scrapling');
    const maxAttempts = requestedStrategy === 'NONE' ? 1 : SCRAPLING_FETCH_MAX_ATTEMPTS;

    const payloadBase: ScraplingFetchRequest = {
      ...request,
      mode: normalizeMode(request.mode),
      proxyStrategy: requestedStrategy,
      timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS,
      returnHtml: request.returnHtml !== false,
      returnText: request.returnText !== false,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const selection = selectScraplingTarget({
        requestedStrategy,
        attempt,
        maxAttempts,
        allowDirect,
      });
      const { target, resolvedStrategy, pool } = selection;
      const payloadAttempt: ScraplingFetchRequest = {
        ...payloadBase,
        proxyUrl: target.proxyUrl || undefined,
      };

      logProxyAttempt({
        scope: 'scrapling',
        attempt,
        target,
        outcome: 'attempt',
      });
      if (requestedStrategy !== 'NONE' && target.isDirect) {
        logProxyAttempt({
          scope: 'scrapling',
          attempt,
          target,
          outcome: 'direct_fallback',
          retryable: null,
        });
      }

      try {
        let result = WORKER_URL ? await fetchViaWorker(payloadAttempt) : await fetchViaFallback(payloadAttempt);
        if (WORKER_URL && result.ok && !result.blockedSuspected && !hasUsableWorkerContent(result)) {
          warnScraplingWithThrottle(
            'worker-empty-fetch',
            '[ScraplingClient] Worker returned empty html/text, falling back to HTTP fetch.'
          );
          const fallback = await fetchViaFallback(payloadAttempt);
          fallback.fallbackReason =
            result.fallbackReason ||
            'Worker returned empty html/text payload; used HTTP fallback for usable content.';
          fallback.metadata = {
            ...(result.metadata || {}),
            ...(fallback.metadata || {}),
            workerEmptyPayload: true,
          };
          result = fallback;
        }

        const retryableResult = !result.ok && (result.blockedSuspected || isBlockedLike(result.statusCode));
        if (pool === 'rotate' && target.proxyUrl) {
          if (retryableResult) scraplingRotateProxyPool.recordFailure(target.id);
          else scraplingRotateProxyPool.recordSuccess(target.id);
        }
        if (pool === 'fixed' && target.proxyUrl) {
          if (retryableResult) scraplingFixedProxyPool.recordFailure(target.id);
          else scraplingFixedProxyPool.recordSuccess(target.id);
        }

        logProxyAttempt({
          scope: 'scrapling',
          attempt,
          target,
          outcome: retryableResult ? 'failure' : 'success',
          retryable: retryableResult ? true : false,
        });

        const decorated = decorateWithProxyMetadata(result, {
          requestedStrategy,
          resolvedStrategy,
          target,
          attempt,
          allowDirect,
        });

        if (retryableResult && attempt < maxAttempts) {
          await sleep(computeRetryBackoffMs(attempt));
          continue;
        }

        return decorated;
      } catch (error: any) {
        lastError = error as Error;
        const retryable = isRetryableNetworkError(error);
        if (pool === 'rotate' && target.proxyUrl) {
          scraplingRotateProxyPool.recordFailure(target.id);
        }
        if (pool === 'fixed' && target.proxyUrl) {
          scraplingFixedProxyPool.recordFailure(target.id);
        }
        logProxyAttempt({
          scope: 'scrapling',
          attempt,
          target,
          outcome: 'failure',
          error,
          retryable,
        });

        if (retryable && attempt < maxAttempts) {
          await sleep(computeRetryBackoffMs(attempt));
          continue;
        }

        if (WORKER_URL) {
          warnScraplingWithThrottle(
            'worker-fetch-failed',
            '[ScraplingClient] Worker fetch failed, falling back to lightweight mode:',
            error?.message || error
          );
          const fallback = await fetchViaFallback(payloadAttempt);
          fallback.fallbackReason = `Worker fetch failed: ${error?.message || 'unknown error'}`;
          return decorateWithProxyMetadata(fallback, {
            requestedStrategy,
            resolvedStrategy,
            target,
            attempt,
            allowDirect,
          });
        }

        throw error;
      }
    }

    throw lastError || new Error('Scrapling fetch failed');
  },

  async crawl(request: ScraplingCrawlRequest): Promise<ScraplingCrawlResponse> {
    const normalizedMaxPages = Math.max(1, Math.min(200, Number(request.maxPages || 20)));
    const crawlTimeoutMs = resolveCrawlTimeoutMs(request.timeoutMs, normalizedMaxPages);
    const payload: ScraplingCrawlRequest = {
      ...request,
      mode: normalizeMode(request.mode),
      maxPages: normalizedMaxPages,
      maxDepth: Math.max(0, Math.min(5, Number(request.maxDepth || 1))),
      concurrency: Math.max(1, Math.min(20, Number(request.concurrency || 4))),
      timeoutMs: crawlTimeoutMs,
    };

    if (!WORKER_URL) {
      return fallbackCrawl(payload);
    }

    try {
      const { timeoutMs: _timeoutMs, ...workerPayload } = payload;
      const response = await axios.post(`${WORKER_URL}/v1/crawl`, workerPayload, {
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
        warnScraplingWithThrottle(
          'worker-empty-crawl',
          '[ScraplingClient] Worker crawl returned empty page payloads, falling back to HTTP crawl mode.'
        );
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
      warnScraplingWithThrottle(
        'worker-crawl-failed',
        '[ScraplingClient] Worker crawl failed, using fallback crawl mode:',
        error?.message || error
      );
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
