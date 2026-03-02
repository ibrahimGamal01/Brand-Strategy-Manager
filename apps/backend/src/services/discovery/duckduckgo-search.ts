/**
 * DuckDuckGo Search Service (Python-backed) v2
 * 
 * Uses the ddgs Python library for fast, reliable search
 * Saves RAW results to database for multi-purpose processing
 * 
 * Capabilities:
 * 1. Brand Context Search (website, socials, summary)
 * 2. Competitor Discovery (finding similar accounts)
 * 3. Handle Validation (checking if handle is legitimate)
 * 4. Raw Results Storage (for later processing)
 */

import { spawn } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_DDG_TIMEOUT_MS = 180_000;
const MAX_DDG_ERROR_SNIPPET = 4_000;

interface DdgRunResult {
  stdout: string;
  stderr: string;
}

function trimForLog(text: string, maxLength: number = MAX_DDG_ERROR_SNIPPET): string {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(-maxLength)} (truncated)`;
}

function isExpectedDdgNoise(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('certificate_verify_failed') ||
    message.includes('self signed certificate') ||
    message.includes('tls') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('timed out') ||
    message.includes('429') ||
    message.includes('403') ||
    message.includes('too many requests') ||
    message.includes('temporarily unavailable')
  );
}

function logDdgFailure(scope: string, error: unknown): void {
  const message = String((error as any)?.message || error || 'unknown error');
  if (isExpectedDdgNoise(error)) {
    console.warn(`[DDGSearch] ${scope} degraded: ${message}`);
    return;
  }
  console.error(`[DDGSearch] ${scope} failed:`, message);
}

function resolveDdgScriptPath(): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'scripts/ddg_search.py'),
    path.join(cwd, 'apps/backend/scripts/ddg_search.py'),
    path.resolve(cwd, '../backend/scripts/ddg_search.py'),
    path.resolve(__dirname, '../../../scripts/ddg_search.py'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`ddg_search.py not found. Checked: ${candidates.join(', ')}`);
}

async function runDdgCommand(
  args: string[],
  timeoutMs: number = DEFAULT_DDG_TIMEOUT_MS
): Promise<DdgRunResult> {
  const scriptPath = resolveDdgScriptPath();
  return await new Promise<DdgRunResult>((resolve, reject) => {
    const child = spawn('python3', [scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new Error(
          `DDG command timed out after ${timeoutMs}ms: python3 ${path.basename(scriptPath)} ${args.join(' ')}`
        )
      );
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const stderrSnippet = trimForLog(stderr);
      reject(
        new Error(
          `DDG command failed (code=${code ?? 'null'}, signal=${signal ?? 'none'}): python3 ${path.basename(scriptPath)} ${args.join(' ')}${stderrSnippet ? ` | stderr=${stderrSnippet}` : ''}`
        )
      );
    });
  });
}

export interface RawSearchResult {
  query: string;
  title: string;
  href: string;
  body: string;
}

export interface BrandContextResult {
  brand_name: string;
  website_url: string | null;
  instagram_handle: string | null;
  facebook_url: string | null;
  tiktok_handle: string | null;
  linkedin_url: string | null;
  twitter_handle: string | null;
  youtube_channel: string | null;
  context_summary: string;
  raw_results: RawSearchResult[];
  error?: string;
}

export interface CompetitorSearchResult {
  competitors: string[];
  raw_results: RawSearchResult[];
  total_raw: number;
  total_handles: number;
  intent?: CompetitorDiscoveryIntent;
  queries?: string[];
}

export type CompetitorDiscoveryIntent =
  | 'COMPANY_BRAND'
  | 'CREATOR'
  | 'LOCAL_BUSINESS'
  | 'B2B_SAAS';

export interface CompetitorDiscoveryIntentSignals {
  businessType?: string | null;
  offerModel?: string | null;
  targetMarket?: string | null;
  niche?: string | null;
  description?: string | null;
}

const CREATOR_HINT_RE =
  /(creator|influencer|blogger|youtuber|tiktoker|personal brand|ugc|content creator|coach creator)/i;
const LOCAL_HINT_RE =
  /(local|clinic|dental|salon|barber|restaurant|cafe|spa|gym|studio|near me|city|neighborhood)/i;
const SAAS_HINT_RE =
  /(saas|software|platform|crm|b2b|enterprise|api|automation|workflow|tool)/i;

export function inferCompetitorDiscoveryIntent(
  signals: CompetitorDiscoveryIntentSignals
): CompetitorDiscoveryIntent {
  const haystack = [
    signals.businessType,
    signals.offerModel,
    signals.targetMarket,
    signals.niche,
    signals.description,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');

  if (!haystack) return 'COMPANY_BRAND';
  if (CREATOR_HINT_RE.test(haystack)) return 'CREATOR';
  if (LOCAL_HINT_RE.test(haystack)) return 'LOCAL_BUSINESS';
  if (SAAS_HINT_RE.test(haystack)) return 'B2B_SAAS';
  return 'COMPANY_BRAND';
}

export interface HandleValidationResult {
  handle: string;
  platform: string;
  is_valid: boolean;
  confidence: number;
  reason: string;
  found_urls: string[];
  raw_results: RawSearchResult[];
  error?: string;
}

export interface SocialSearchResult {
  brand_name: string;
  instagram: string[];
  tiktok: string[];
  youtube: string[];
  twitter: string[];
  linkedin: string[];
  facebook: string[];
  raw_results: Array<RawSearchResult & { platform: string }>;
  totals: {
    instagram: number;
    tiktok: number;
    youtube: number;
    twitter: number;
    linkedin: number;
    facebook: number;
    total: number;
    raw: number;
  };
  error?: string;
}

export async function searchRawDDG(
  queries: string[],
  options?: {
    timeoutMs?: number;
    maxResults?: number;
    researchJobId?: string;
    source?: string;
  }
): Promise<RawSearchResult[]> {
  const normalizedQueries = Array.from(
    new Set(
      (queries || [])
        .map((query) => String(query || '').trim())
        .filter(Boolean)
    )
  );
  if (normalizedQueries.length === 0) return [];

  try {
    const { stdout, stderr } = await runDdgCommand(
      ['raw', ...normalizedQueries],
      options?.timeoutMs ?? 60_000
    );

    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }

    const parsed = JSON.parse(stdout) as {
      results?: RawSearchResult[];
      total?: number;
    };
    const results = (parsed.results || []).slice(0, Math.max(1, Number(options?.maxResults || 120)));

    if (options?.researchJobId && results.length > 0) {
      await saveRawResultsToDB(
        options.researchJobId,
        results,
        options.source || 'duckduckgo_raw_query'
      );
    }

    return results;
  } catch (error: any) {
    logDdgFailure('Raw search', error);
    return [];
  }
}

const HANDLE_STOPWORDS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'accounts',
  'account',
  'login',
  'signup',
  'about',
  'share',
  'video',
  'videos',
  'discover',
  'fyp',
  'foryou',
  'hashtag',
  'search',
  'instagram',
  'tiktok',
  'www',
]);

function normalizeExtractedHandle(raw: string, options?: { minLength?: number; maxLength?: number }): string {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]/g, '');

  const minLength = options?.minLength ?? 2;
  const maxLength = options?.maxLength ?? 30;
  if (!normalized || normalized.length < minLength || normalized.length > maxLength) return '';
  if (normalized.includes('..')) return '';
  if (HANDLE_STOPWORDS.has(normalized)) return '';
  if (normalized.endsWith('.com') || normalized.endsWith('.org') || normalized.endsWith('.net')) {
    return '';
  }
  return normalized;
}

type SocialDiscoveryPlatform = 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'linkedin';

export interface SocialHandleCandidate {
  platform: SocialDiscoveryPlatform;
  handle: string;
  profileUrl: string;
  confidence: number;
  reason: string;
  source: string;
  isLikelyClient: boolean;
}

function platformPatterns(platform: SocialDiscoveryPlatform): {
  urlRegex: RegExp;
  mentionRegex?: RegExp;
  maxLength: number;
  hostMarker: string;
} {
  if (platform === 'instagram') {
    return {
      urlRegex: /instagram\.com\/([a-z0-9._]{2,40})/gi,
      mentionRegex: /@([a-z0-9._]{2,40})/gi,
      maxLength: 30,
      hostMarker: 'instagram.com',
    };
  }
  if (platform === 'tiktok') {
    return {
      urlRegex: /tiktok\.com\/@([a-z0-9._]{2,40})/gi,
      mentionRegex: /@([a-z0-9._]{2,40})/gi,
      maxLength: 30,
      hostMarker: 'tiktok.com',
    };
  }
  if (platform === 'youtube') {
    return {
      urlRegex: /youtube\.com\/(?:@|c\/|channel\/|user\/)?([a-z0-9._-]{2,80})/gi,
      mentionRegex: /@([a-z0-9._-]{2,80})/gi,
      maxLength: 80,
      hostMarker: 'youtube.com',
    };
  }
  if (platform === 'linkedin') {
    return {
      urlRegex: /linkedin\.com\/(?:in|company)\/([a-z0-9-]{2,100})/gi,
      maxLength: 80,
      hostMarker: 'linkedin.com',
    };
  }
  return {
    urlRegex: /(?:x|twitter)\.com\/@?([a-z0-9_]{1,40})/gi,
    mentionRegex: /@([a-z0-9_]{1,40})/gi,
    maxLength: 15,
    hostMarker: 'x.com',
  };
}

function profileUrlForCandidate(platform: SocialDiscoveryPlatform, handle: string): string {
  if (platform === 'instagram') return `https://www.instagram.com/${handle}`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@${handle}`;
  if (platform === 'youtube') return `https://www.youtube.com/@${handle}`;
  if (platform === 'linkedin') return `https://www.linkedin.com/in/${handle}`;
  return `https://x.com/${handle}`;
}

function clampConfidence(score: number): number {
  if (!Number.isFinite(score)) return 0.1;
  return Math.max(0.05, Math.min(0.99, score));
}

function scoreHandleCandidate(input: {
  platform: SocialDiscoveryPlatform;
  handle: string;
  row: RawSearchResult;
  domain: string;
}): number {
  const { platform, handle, row, domain } = input;
  const href = String(row.href || '').toLowerCase();
  const title = String(row.title || '').toLowerCase();
  const body = String(row.body || '').toLowerCase();
  const query = String(row.query || '').toLowerCase();
  const text = `${title} ${body}`;
  const host = domain.toLowerCase();
  const rootToken = host.split('.')[0]?.replace(/[^a-z0-9]/g, '') || '';

  let score = 0.2;
  const platformKeyword = platform === 'twitter' ? 'x' : platform;
  const handleLower = handle.toLowerCase();
  const hasDomainInHref = href.includes(host);
  const hasDomainInText = text.includes(host);
  const hasRootTokenInHandle = Boolean(rootToken && handleLower.includes(rootToken));

  if (hasDomainInHref) score += 0.3;
  if (hasDomainInText) score += 0.24;
  if (query.includes(platformKeyword)) score += 0.06;
  if (href.includes(platformKeyword)) score += 0.08;
  if (hasRootTokenInHandle) score += 0.28;
  if (rootToken && handleLower === rootToken) score += 0.18;
  if (/(official|team|hq|studio|company|inc|co)/.test(handle)) score += 0.08;
  if (handleLower.length <= 3) score -= 0.25;
  if (handleLower.endsWith('_') || handleLower.startsWith('_')) score -= 0.16;
  if (!hasDomainInHref && !hasDomainInText && !hasRootTokenInHandle) score -= 0.12;
  if (/fans|archive|backup|news|media|community|forum/.test(handle)) score -= 0.22;
  return clampConfidence(score);
}

function buildCandidatesFromRawResults(
  rawResults: RawSearchResult[],
  cleanDomain: string
): SocialHandleCandidate[] {
  const candidates = new Map<string, SocialHandleCandidate>();
  const platforms: SocialDiscoveryPlatform[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'];
  const rootToken = cleanDomain.split('.')[0]?.replace(/[^a-z0-9]/g, '').toLowerCase() || '';

  for (const row of rawResults || []) {
    const href = String(row.href || '');
    const title = String(row.title || '');
    const body = String(row.body || '');
    const text = `${title} ${body}`.toLowerCase();

    for (const platform of platforms) {
      const pattern = platformPatterns(platform);
      const matches = [...href.matchAll(pattern.urlRegex)];
      for (const match of matches) {
        const handle = normalizeExtractedHandle(match[1] || '', { maxLength: pattern.maxLength });
        if (!handle) continue;
        const confidence = scoreHandleCandidate({ platform, handle, row, domain: cleanDomain });
        const key = `${platform}:${handle}`;
        const candidate: SocialHandleCandidate = {
          platform,
          handle,
          profileUrl: profileUrlForCandidate(platform, handle),
          confidence,
          reason: `Found via ${platform} profile result aligned with ${cleanDomain}.`,
          source: 'ddg_social_search',
          isLikelyClient: confidence >= 0.78,
        };
        const existing = candidates.get(key);
        if (!existing || candidate.confidence > existing.confidence) {
          candidates.set(key, candidate);
        }
      }

      if (!pattern.mentionRegex) continue;
      if (!text.includes(platform) && !href.toLowerCase().includes(pattern.hostMarker)) continue;
      if (rootToken && !text.includes(rootToken) && !href.toLowerCase().includes(rootToken)) continue;
      const mentions = [...text.matchAll(pattern.mentionRegex)];
      for (const mention of mentions) {
        const handle = normalizeExtractedHandle(mention[1] || '', { maxLength: pattern.maxLength });
        if (!handle) continue;
        const confidence = clampConfidence(scoreHandleCandidate({ platform, handle, row, domain: cleanDomain }) - 0.12);
        const key = `${platform}:${handle}`;
        const candidate: SocialHandleCandidate = {
          platform,
          handle,
          profileUrl: profileUrlForCandidate(platform, handle),
          confidence,
          reason: `Mentioned in ${platform}-related result for ${cleanDomain}.`,
          source: 'ddg_social_mention',
          isLikelyClient: confidence >= 0.8,
        };
        const existing = candidates.get(key);
        if (!existing || candidate.confidence > existing.confidence) {
          candidates.set(key, candidate);
        }
      }
    }
  }

  return Array.from(candidates.values()).sort((a, b) => b.confidence - a.confidence);
}

function extractHandlesFromRawResults(
  rawResults: RawSearchResult[],
  platform: 'instagram' | 'tiktok'
): string[] {
  const patterns = platformPatterns(platform);
  const handles = new Set<string>();

  for (const row of rawResults || []) {
    const href = String(row.href || '');
    const title = String(row.title || '');
    const body = String(row.body || '');
    const text = `${title} ${body}`.toLowerCase();

    for (const match of href.matchAll(patterns.urlRegex)) {
      const handle = normalizeExtractedHandle(match[1] || '', { maxLength: patterns.maxLength });
      if (handle) handles.add(handle);
    }

    if (!patterns.mentionRegex) continue;
    if (!text.includes(platform) && !href.toLowerCase().includes(patterns.hostMarker)) continue;
    for (const mention of text.matchAll(patterns.mentionRegex)) {
      const handle = normalizeExtractedHandle(mention[1] || '', { maxLength: patterns.maxLength });
      if (handle) handles.add(handle);
    }
  }

  return Array.from(handles);
}

/**
 * Domain-first search to discover a website's Instagram/TikTok handles.
 * Used by intake suggestion layer so we suggest the real handle (e.g. eluumis_official) not a guess from brand name.
 */
export async function searchSocialHandlesForWebsite(
  domain: string,
  options?: { timeoutMs?: number }
): Promise<{
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  linkedin?: string;
  twitter?: string;
  candidates: SocialHandleCandidate[];
}> {
  const out: {
    instagram?: string;
    tiktok?: string;
    youtube?: string;
    linkedin?: string;
    twitter?: string;
    candidates: SocialHandleCandidate[];
  } = { candidates: [] };
  const cleanDomain = String(domain || '').trim().replace(/^https?:\/\//, '').split('/')[0];
  if (!cleanDomain) return out;

  try {
    const queries = [
      `${cleanDomain} instagram`,
      `${cleanDomain} tiktok`,
      `${cleanDomain} youtube`,
      `${cleanDomain} linkedin`,
      `${cleanDomain} twitter`,
    ];
    const { stdout, stderr } = await runDdgCommand(
      ['raw', ...queries],
      options?.timeoutMs ?? 30_000
    );
    if (stderr) console.log(`[DDGSearch] ${stderr}`);

    const parsed = JSON.parse(stdout) as { results?: RawSearchResult[]; total?: number };
    const rawResults = parsed.results || [];
    const candidates = buildCandidatesFromRawResults(rawResults, cleanDomain);
    out.candidates = candidates.slice(0, 20);
    out.instagram = candidates.find((candidate) => candidate.platform === 'instagram')?.handle;
    out.tiktok = candidates.find((candidate) => candidate.platform === 'tiktok')?.handle;
    out.youtube = candidates.find((candidate) => candidate.platform === 'youtube')?.handle;
    out.linkedin = candidates.find((candidate) => candidate.platform === 'linkedin')?.handle;
    out.twitter = candidates.find((candidate) => candidate.platform === 'twitter')?.handle;

    if (candidates.length > 0) {
      console.log(
        `[DDGSearch] Website ${cleanDomain} social candidates: ${candidates
          .slice(0, 5)
          .map((candidate) => `${candidate.platform}=@${candidate.handle}`)
          .join(', ')}`
      );
    }
    return out;
  } catch (error: any) {
    logDdgFailure(`searchSocialHandlesForWebsite (${cleanDomain})`, error);
    return out;
  }
}

/**
 * Save raw search results to database for later processing
 */
export async function saveRawResultsToDB(
  researchJobId: string,
  results: RawSearchResult[],
  source: string = 'duckduckgo'
): Promise<number> {
  if (!results || results.length === 0) return 0;
  
  try {
    const data = results.map(r => ({
      researchJobId,
      query: r.query,
      source,
      title: r.title,
      href: r.href,
      body: r.body,
    }));
    
    const created = await prisma.rawSearchResult.createMany({
      data,
      skipDuplicates: true,
    });
    
    console.log(`[DDGSearch] Saved ${created.count} raw results to DB`);
    return created.count;
    
  } catch (error: any) {
    logDdgFailure('saveRawResultsToDB', error);
    return 0;
  }
}

/**
 * Search for brand context using DuckDuckGo
 * Returns website, social handles, context summary, AND raw results
 */
export async function searchBrandContextDDG(
  brandName: string,
  researchJobId?: string,
  options?: { timeoutMs?: number }
): Promise<BrandContextResult> {
  console.log(`[DDGSearch] Searching brand context for: "${brandName}"`);
  
  try {
    const { stdout, stderr } = await runDdgCommand(
      ['brand_context', brandName],
      options?.timeoutMs ?? 120_000
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: BrandContextResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Found: website=${result.website_url}, instagram=@${result.instagram_handle}, raw=${result.raw_results?.length || 0}`);
    
    // Save raw results to DB if research job provided
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(researchJobId, result.raw_results, 'duckduckgo_brand_context');
    }
    
    return result;
    
  } catch (error: any) {
    logDdgFailure('Brand context search', error);
    return {
      brand_name: brandName,
      website_url: null,
      instagram_handle: null,
      facebook_url: null,
      tiktok_handle: null,
      linkedin_url: null,
      twitter_handle: null,
      youtube_channel: null,
      context_summary: '',
      raw_results: [],
      error: error.message,
    };
  }
}

/**
 * Search for competitor Instagram handles using DuckDuckGo
 * Returns competitors AND raw results for DB storage
 */
export async function searchCompetitorsDDG(
  handle: string,
  niche: string,
  maxResults: number = 100,
  researchJobId?: string,
  intent: CompetitorDiscoveryIntent = 'COMPANY_BRAND'
): Promise<string[]> {
  console.log(
    `[DDGSearch] Searching competitors for @${handle} in "${niche}" with intent=${intent}`
  );
  
  try {
    const { stdout, stderr } = await runDdgCommand(
      ['competitors', handle, niche, String(maxResults), intent],
      60_000
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: CompetitorSearchResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Found ${result.competitors.length} competitors from ${result.total_raw} raw results`);
    
    // Save raw results to DB if research job provided
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(researchJobId, result.raw_results, 'duckduckgo_competitors');
    }
    
    return result.competitors || [];
    
  } catch (error: any) {
    logDdgFailure('Competitor search', error);
    return [];
  }
}


/**
 * Perform a direct search for competitors using a specific query
 * e.g., "Brand Name competitors instagram"
 */
export async function performDirectCompetitorSearch(query: string): Promise<string[]> {
  console.log(`[DDGSearch] Running direct competitor search: "${query}"`);
  return performDirectCompetitorSearchForPlatform(query, 'instagram', 30);
}

export async function performDirectCompetitorSearchForPlatform(
  query: string,
  platform: 'instagram' | 'tiktok',
  maxResults: number = 30,
  timeoutMs: number = 30_000
): Promise<string[]> {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return [];

  console.log(`[DDGSearch] Running direct ${platform} search: "${normalizedQuery}"`);

  try {
    const enrichedQueries =
      platform === 'instagram'
        ? [
            `${normalizedQuery} site:instagram.com`,
            `${normalizedQuery} instagram competitors`,
            `${normalizedQuery} instagram accounts like`,
          ]
        : [
            `${normalizedQuery} site:tiktok.com`,
            `${normalizedQuery} tiktok competitors`,
            `${normalizedQuery} tiktok creators like`,
          ];
    const { stdout, stderr } = await runDdgCommand(['raw', ...enrichedQueries], timeoutMs);

    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }

    const parsed = JSON.parse(stdout) as {
      results?: RawSearchResult[];
      total?: number;
    };
    const rawResults = parsed.results || [];
    const handles = extractHandlesFromRawResults(rawResults, platform).slice(
      0,
      Math.max(1, maxResults)
    );

    console.log(
      `[DDGSearch] Direct ${platform} search found ${handles.length} handles from ${rawResults.length} raw results`
    );
    return handles;
  } catch (error: any) {
    logDdgFailure(`Direct ${platform} search`, error);
    return [];
  }
}

/**
 * Full competitor search including raw results (for when you need everything)
 */
export async function searchCompetitorsDDGFull(
  handle: string,
  niche: string,
  maxResults: number = 100,
  researchJobId?: string,
  intent: CompetitorDiscoveryIntent = 'COMPANY_BRAND'
): Promise<CompetitorSearchResult> {
  console.log(
    `[DDGSearch] Full competitor search for @${handle} in "${niche}" with intent=${intent}`
  );
  
  try {
    const { stdout, stderr } = await runDdgCommand(
      ['competitors', handle, niche, String(maxResults), intent],
      60_000
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: CompetitorSearchResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Full search: ${result.competitors.length} handles, ${result.total_raw} raw results`);
    
    // Save raw results to DB
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(researchJobId, result.raw_results, 'duckduckgo_competitors');
    }
    
    return result;
    
  } catch (error: any) {
    logDdgFailure('Full competitor search', error);
    return {
      competitors: [],
      raw_results: [],
      total_raw: 0,
      total_handles: 0,
    };
  }
}

/**
 * Validate if a handle appears to be legitimate using DuckDuckGo
 */
export async function validateHandleDDG(
  handle: string,
  platform: string = 'instagram'
): Promise<HandleValidationResult> {
  console.log(`[DDGSearch] Validating @${handle} on ${platform}`);
  
  try {
    const { stdout, stderr } = await runDdgCommand(['validate', handle, platform], 12_000);
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: HandleValidationResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Validation: ${result.is_valid ? 'VALID' : 'INVALID'} (${Math.round(result.confidence * 100)}%)`);
    
    return result;
    
  } catch (error: any) {
    logDdgFailure('Handle validation', error);
    return {
      handle,
      platform,
      is_valid: false,
      confidence: 0,
      reason: `Validation failed: ${error.message}`,
      found_urls: [],
      raw_results: [],
      error: error.message,
    };
  }
}

/**
 * Site-limited search for social media profiles
 * Uses site: operator to find profiles on specific platforms
 */
export async function searchSocialProfiles(
  brandName: string,
  researchJobId?: string,
  options?: { timeoutMs?: number }
): Promise<SocialSearchResult> {
  console.log(`[DDGSearch] Site-limited social search for: "${brandName}"`);
  
  try {
    const { stdout, stderr } = await runDdgCommand(
      ['social_search', brandName],
      options?.timeoutMs ?? 45_000
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: SocialSearchResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Social search found: Instagram=${result.instagram?.length || 0}, TikTok=${result.tiktok?.length || 0}, YouTube=${result.youtube?.length || 0}`);
    
    // Save raw results to DB if research job provided
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(
        researchJobId, 
        result.raw_results.map(r => ({
          query: r.query,
          title: r.title,
          href: r.href,
          body: r.body,
        })), 
        'duckduckgo_social_search'
      );
    }
    
    return result;
    
  } catch (error: any) {
    logDdgFailure('Social search', error);
    return {
      brand_name: brandName,
      instagram: [],
      tiktok: [],
      youtube: [],
      twitter: [],
      linkedin: [],
      facebook: [],
      raw_results: [],
      totals: {
        instagram: 0,
        tiktok: 0,
        youtube: 0,
        twitter: 0,
        linkedin: 0,
        facebook: 0,
        total: 0,
        raw: 0,
      },
      error: error.message,
    };
  }
}

// Interfaces for gather_all results
export interface NewsResult {
  query: string;
  title: string;
  body: string;
  url: string;
  source: string;
  image_url: string;
  published_at: string;
}

export interface VideoResult {
  query: string;
  title: string;
  description: string;
  url: string;
  embed_url: string;
  duration: string;
  publisher: string;
  uploader: string;
  view_count: number | null;
  thumbnail_url: string;
  published_at: string;
}

export interface ImageResult {
  query: string;
  title: string;
  image_url: string;
  thumbnail_url: string;
  source_url: string;
  width: number | null;
  height: number | null;
}

export interface GatherAllResult {
  brand_name: string;
  niche: string;
  text_results: RawSearchResult[];
  news_results: NewsResult[];
  video_results: VideoResult[];
  image_results: ImageResult[];
  totals: {
    text: number;
    news: number;
    videos: number;
    images: number;
    total: number;
  };
}

/**
 * Build handles for social scrape from job's explicit client data (form / inputData / clientAccounts).
 * Only use DDG-discovered handles when the user has not provided any.
 */
async function getClientHandlesForJob(researchJobId: string): Promise<Record<string, string>> {
  const { normalizeHandle } = await import('../intake/brain-intake-utils.js');
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: { client: { include: { clientAccounts: true } } },
  });
  if (!job) return {};

  const inputData = (job.inputData || {}) as Record<string, unknown>;
  const handles: Record<string, string> = {};

  if (inputData.handles && typeof inputData.handles === 'object') {
    for (const [platform, raw] of Object.entries(inputData.handles)) {
      if ((platform === 'instagram' || platform === 'tiktok') && typeof raw === 'string' && raw) {
        const h = normalizeHandle(raw);
        if (h) handles[platform] = h;
      }
    }
  }
  if (Object.keys(handles).length === 0 && inputData.handle && typeof inputData.handle === 'string') {
    const platform = String((inputData.platform as string) || 'instagram').toLowerCase();
    if (platform === 'instagram' || platform === 'tiktok') {
      const h = normalizeHandle(inputData.handle);
      if (h) handles[platform] = h;
    }
  }
  for (const acc of job.client?.clientAccounts || []) {
    if ((acc.platform === 'instagram' || acc.platform === 'tiktok') && acc.handle) {
      const h = normalizeHandle(acc.handle);
      if (h && !handles[acc.platform]) handles[acc.platform] = h;
    }
  }
  return handles;
}

/**
 * COMPREHENSIVE: Gather ALL DDG data and save to DB
 * This is the main entry point for maximizing data collection.
 * Social content scrape uses the job's client handles first; DDG-discovered handles only as fallback when none provided.
 */
export async function gatherAllDDG(
  brandName: string,
  niche: string,
  researchJobId: string
): Promise<GatherAllResult> {
  console.log(`[DDGSearch] Starting comprehensive gather for "${brandName}" in "${niche}"`);
  
  try {
    const { stdout, stderr } = await runDdgCommand(['gather_all', brandName, niche], 180_000);
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: GatherAllResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Gathered: ${result.totals.total} total (${result.totals.text} text, ${result.totals.news} news, ${result.totals.videos} videos, ${result.totals.images} images)`);
    
    // Save all results to DB
    await saveAllResultsToDB(researchJobId, result);
    
    // Scrape social content from CLIENT handles (form / inputData / clientAccounts) first; only fall back to DDG-discovered handles when none exist
    console.log(`[DDGSearch] Scraping social content for images/videos...`);
    let handles: Record<string, string> = await getClientHandlesForJob(researchJobId);
    if (Object.keys(handles).length === 0) {
      const brandContext = await searchBrandContextDDG(brandName, researchJobId);
      if (brandContext.instagram_handle) handles.instagram = brandContext.instagram_handle;
      if (brandContext.tiktok_handle) handles.tiktok = brandContext.tiktok_handle;
      if (Object.keys(handles).length > 0) {
        console.log(`[DDGSearch] No client handles on job; using DDG-discovered handles as fallback`);
      }
    } else {
      console.log(`[DDGSearch] Using job client handles: ${Object.entries(handles).map(([p, h]) => `${p}:@${h}`).join(', ')}`);
    }

    if (Object.keys(handles).length > 0) {
      const socialContent = await scrapeSocialContent(handles, 30, researchJobId);
      console.log(`[DDGSearch] Scraped ${socialContent.totals.images} images, ${socialContent.totals.videos} videos from social profiles`);
    } else {
      console.log(`[DDGSearch] No social handles available, skipping social content scrape`);
    }
    
    return result;
    
  } catch (error: any) {
    logDdgFailure('gatherAllDDG', error);
    throw error;
  }
}

/**
 * Save all gathered results to their respective DB tables
 */
async function saveAllResultsToDB(researchJobId: string, result: GatherAllResult): Promise<void> {
  console.log(`[DDGSearch] Saving ${result.totals.total} results to DB (with deduplication)...`);
  
  // Save text results with upsert for proper deduplication
  if (result.text_results.length > 0) {
    let newCount = 0;
    let updatedCount = 0;
    
    for (const r of result.text_results) {
      try {
        const existing = await prisma.rawSearchResult.findUnique({
          where: {
            researchJobId_href: { researchJobId, href: r.href },
          },
        });
        
        if (existing) {
          // Update seen count
          await prisma.rawSearchResult.update({
            where: { id: existing.id },
            data: {
              lastSeenAt: new Date(),
              seenCount: existing.seenCount + 1,
            },
          });
          updatedCount++;
        } else {
          // Create new
          await prisma.rawSearchResult.create({
            data: {
              researchJobId,
              query: r.query,
              source: 'duckduckgo',
              title: r.title,
              href: r.href,
              body: r.body,
            },
          });
          newCount++;
        }
      } catch (error: any) {
        // Skip duplicates
        if (!error.message?.includes('Unique constraint')) {
          logDdgFailure('saveAllResultsToDB.textResult', error);
        }
      }
    }
    console.log(`[DDGSearch] Text: ${newCount} new, ${updatedCount} updated`);
  }
  
  // Save news results
  if (result.news_results.length > 0) {
    const newsData = result.news_results.map(r => ({
      researchJobId,
      query: r.query,
      title: r.title,
      body: r.body || null,
      url: r.url,
      source: r.source || null,
      imageUrl: r.image_url || null,
      publishedAt: r.published_at || null,
    }));
    
    const newsCreated = await prisma.ddgNewsResult.createMany({
      data: newsData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${newsCreated.count} news results`);
  }
  
  // Save video results
  if (result.video_results.length > 0) {
    const videoData = result.video_results.map(r => ({
      researchJobId,
      query: r.query,
      title: r.title,
      description: r.description || null,
      url: r.url,
      embedUrl: r.embed_url || null,
      duration: r.duration || null,
      publisher: r.publisher || null,
      uploader: r.uploader || null,
      viewCount: r.view_count || null,
      thumbnailUrl: r.thumbnail_url || null,
      publishedAt: r.published_at || null,
    }));
    
    const videoCreated = await prisma.ddgVideoResult.createMany({
      data: videoData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${videoCreated.count} video results`);
  }
  
  // Save image results
  if (result.image_results.length > 0) {
    const imageData = result.image_results.map(r => ({
      researchJobId,
      query: r.query,
      title: r.title,
      imageUrl: r.image_url,
      thumbnailUrl: r.thumbnail_url || null,
      sourceUrl: r.source_url,
      width: r.width || null,
      height: r.height || null,
    }));
    
    const imageCreated = await prisma.ddgImageResult.createMany({
      data: imageData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${imageCreated.count} image results`);
  }
  
  console.log(`[DDGSearch] All results saved to DB`);
}

// Interfaces for scrape_social_content results
export interface ScrapedSocialImage {
  platform: string;
  handle: string;
  image_url: string;
  thumbnail_url: string;
  source_url: string;
  title: string;
  width: number | null;
  height: number | null;
}

export interface ScrapedSocialVideo {
  platform: string;
  handle: string;
  video_url: string;
  embed_url: string;
  thumbnail_url: string;
  title: string;
  description: string;
  duration: string;
  publisher: string;
}

export interface ScrapedSocialPost {
  platform: string;
  handle: string;
  caption_snippet: string;
  source_url: string;
  has_media: boolean;
  is_video?: boolean;
}

export interface ScrapeSocialContentResult {
  handles: Record<string, string>;
  images: ScrapedSocialImage[];
  videos: ScrapedSocialVideo[];
  posts: ScrapedSocialPost[];
  platforms_searched: string[];
  totals: {
    images: number;
    videos: number;
    posts: number;
    platforms: number;
  };
  error?: string;
}

/**
 * Scrape images and videos for social handles using site-limited search
 * This is the workaround for direct API access when rate-limited
 * 
 * IMPORTANT: This is the ONLY source for media alongside authenticated Instagram
 */
export async function scrapeSocialContent(
  handles: Record<string, string>,
  maxItems: number = 30,
  researchJobId?: string
): Promise<ScrapeSocialContentResult> {
  // Build args string like: instagram:handle tiktok:handle
  const handleArgList = Object.entries(handles)
    .filter(([_, handle]) => handle)
    .map(([platform, handle]) => `${platform}:${handle}`);
  const handleArgs = handleArgList.join(' ');
  
  if (!handleArgs) {
    return {
      handles: {},
      images: [],
      videos: [],
      posts: [],
      platforms_searched: [],
      totals: { images: 0, videos: 0, posts: 0, platforms: 0 },
      error: 'No handles provided',
    };
  }
  
  console.log(`[DDGSearch] Scraping social content: ${handleArgs} (max ${maxItems})`);
  
  try {
    const { stdout, stderr } = await runDdgCommand(
      ['scrape_content', ...handleArgList, String(maxItems)],
      120_000
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: ScrapeSocialContentResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Scraped: ${result.totals.images} images, ${result.totals.videos} videos from ${result.platforms_searched.join(', ')}`);
    
    // Save to DB if researchJobId provided
    if (researchJobId) {
      await saveSocialContentToDB(researchJobId, result);
    }
    
    return result;
    
  } catch (error: any) {
    logDdgFailure('Social content scrape', error);
    return {
      handles,
      images: [],
      videos: [],
      posts: [],
      platforms_searched: [],
      totals: { images: 0, videos: 0, posts: 0, platforms: 0 },
      error: error.message,
    };
  }
}

/**
 * Save scraped social content to DB
 * Marks source as 'site_limited_social' to distinguish from generic DDG
 */
async function saveSocialContentToDB(
  researchJobId: string,
  result: ScrapeSocialContentResult
): Promise<void> {
  console.log(`[DDGSearch] Saving ${result.totals.images} images and ${result.totals.videos} videos to DB...`);
  
  // Save images
  if (result.images.length > 0) {
    const imageData = result.images.map(img => ({
      researchJobId,
      query: `site:${img.platform}.com @${img.handle}`, // Reconstruct query for consistency
      title: img.title,
      imageUrl: img.image_url,
      thumbnailUrl: img.thumbnail_url,
      sourceUrl: img.source_url,
      width: img.width,
      height: img.height,
    }));
    
    const created = await prisma.ddgImageResult.createMany({
      data: imageData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${created.count} social images`);
  }
  
  // Save videos
  if (result.videos.length > 0) {
    const videoData = result.videos.map(vid => ({
      researchJobId,
      query: `site:${vid.platform}.com @${vid.handle}`,
      title: vid.title,
      description: vid.description,
      url: vid.video_url,
      embedUrl: vid.embed_url,
      duration: vid.duration,
      publisher: vid.publisher,
      thumbnailUrl: vid.thumbnail_url,
    }));
    
    const created = await prisma.ddgVideoResult.createMany({
      data: videoData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${created.count} social videos`);
  }
}
