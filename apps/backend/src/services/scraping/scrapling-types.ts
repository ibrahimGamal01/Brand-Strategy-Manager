export type ScraplingMode = 'AUTO' | 'HTTP' | 'DYNAMIC' | 'STEALTH';

export type ScraplingFetchRequest = {
  url: string;
  mode?: ScraplingMode;
  sessionKey?: string;
  timeoutMs?: number;
  proxyStrategy?: 'NONE' | 'ROTATE' | 'FIXED';
  returnHtml?: boolean;
  returnText?: boolean;
  waitFor?: {
    type: 'network_idle' | 'selector' | 'timeout';
    value?: string | number;
  };
};

export type ScraplingFetchResponse = {
  ok: boolean;
  finalUrl: string;
  statusCode: number | null;
  fetcherUsed: ScraplingMode;
  blockedSuspected: boolean;
  html?: string | null;
  text?: string | null;
  timings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  fallbackReason?: string;
};

export type ScraplingCrawlRequest = {
  startUrls: string[];
  allowedDomains?: string[];
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  resumeKey?: string;
  mode?: ScraplingMode;
};

export type ScraplingCrawlPage = {
  url: string;
  finalUrl?: string;
  statusCode?: number;
  fetcherUsed?: ScraplingMode;
  text?: string | null;
  html?: string | null;
};

export type ScraplingCrawlResponse = {
  ok: boolean;
  runId: string;
  summary: {
    queued: number;
    fetched: number;
    failed: number;
  };
  pages: ScraplingCrawlPage[];
  fallbackReason?: string;
};

export type ScraplingExtractRequest = {
  url?: string;
  snapshotHtml?: string;
  recipeSchema: Record<string, unknown>;
  adaptiveNamespace?: string;
};

export type ScraplingExtractResponse = {
  ok: boolean;
  extracted: Record<string, unknown>;
  confidence: number;
  warnings: string[];
  adaptiveUpdates: Array<{
    key: string;
    element: Record<string, unknown>;
  }>;
  fallbackReason?: string;
};

export type UrlGuardResult = {
  allowed: boolean;
  reason?: string;
  normalizedUrl?: string;
  hostname?: string;
};
