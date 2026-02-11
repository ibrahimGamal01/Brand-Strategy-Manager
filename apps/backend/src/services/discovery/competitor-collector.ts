import { suggestCompetitorsMultiPlatform } from '../ai/competitor-discovery';
import {
  performDirectCompetitorSearchForPlatform,
  searchRawDDG,
  searchSocialProfiles,
} from './duckduckgo-search';
import { ConnectorHealthTracker } from './connector-health';
import { CompetitorQueryPlan } from './competitor-query-composer';
import { CompetitorSurface } from './competitor-platform-detector';

export interface CandidateEvidenceInput {
  sourceType: string;
  query?: string | null;
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  signalScore: number;
}

export interface CollectedCandidate {
  platform: CompetitorSurface;
  handle: string;
  normalizedHandle: string;
  profileUrl: string | null;
  canonicalName: string;
  websiteDomain: string | null;
  sources: string[];
  evidence: CandidateEvidenceInput[];
  baseSignal: number;
}

export interface CollectorDiagnostics {
  rawCollectedCount: number;
  dedupedCount: number;
  perPlatform: Record<CompetitorSurface, number>;
}

export interface CollectorInput {
  researchJobId: string;
  brandName: string;
  niche: string;
  description: string;
  selectedSurfaces: CompetitorSurface[];
  queryPlan: CompetitorQueryPlan;
  precision: 'high' | 'balanced';
  connectorHealth: ConnectorHealthTracker;
  excludeHandles: string[];
  excludeDomains: string[];
}

const SOCIAL_DOMAIN_SUFFIXES = [
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'facebook.com',
];

const NOISY_WEBSITE_DOMAIN_RE =
  /(^|\.)(google\.com|bing\.com|etsy\.com|ebay\.[a-z.]+|amazon\.[a-z.]+|podcasts\.apple\.com|open\.spotify\.com|linktr\.ee|beacons\.ai)$/i;

const NOISY_HANDLE_PATTERN =
  /(coupon|deal|giveaway|meme|quotes|fan(page|_page)?|officialfan|globalnews|hunter|viral|clip[s]?|promo|discount|freebies?|news|crypto|bitcoin)/i;

const SOCIAL_ROUTE_STOPWORDS = new Set([
  'stories',
  'story',
  'reel',
  'reels',
  'explore',
  'p',
  'accounts',
  'account',
  'about',
  'watch',
  'video',
  'videos',
  'post',
  'posts',
  'hashtag',
  'hashtags',
  'tag',
  'tags',
  'share',
  'search',
  'home',
  'discover',
  'channel',
  'channels',
  'shorts',
  'music',
  'live',
  'status',
  'groups',
  'events',
  'photos',
  'photo',
  'messages',
]);

const LOW_SIGNAL_DICTIONARY_HANDLES = new Set([
  'official',
  'business',
  'marketing',
  'brand',
  'brands',
  'company',
  'companies',
  'enterprise',
  'advisor',
  'advisors',
  'publication',
  'publications',
  'support',
  'help',
  'blog',
  'shop',
  'store',
  'stores',
  'community',
  'creator',
  'creators',
  'content',
  'social',
  'media',
  'news',
  'viral',
  'quotes',
  'motivation',
  ...Array.from(SOCIAL_ROUTE_STOPWORDS),
]);

function toHandle(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]/g, '');
}

function normalizeHandleForSurface(surface: CompetitorSurface, raw: string): string {
  const value = toHandle(raw);
  if (!value) return '';
  if (surface === 'website') return value.replace(/^www\./, '');
  return value.replace(/-/g, '_');
}

function handleLooksNoisy(handle: string): boolean {
  if (!handle) return true;
  if (handle.length < 3) return true;
  if (LOW_SIGNAL_DICTIONARY_HANDLES.has(handle)) return true;
  if (handle.includes('.com') || handle.includes('.net') || handle.includes('.org')) return true;
  if (/^\d{6,}$/.test(handle)) return true;
  if (/^[a-z]?\d{7,}$/.test(handle)) return true;
  if (/^uc[a-z0-9_-]{10,}$/i.test(handle)) return true;
  if (!/[a-z]/.test(handle)) return true;
  if (/^[a-z]{1,2}\d+[a-z]?$/.test(handle)) return true;
  if (NOISY_HANDLE_PATTERN.test(handle)) return true;
  return false;
}

function isSocialDomain(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  return SOCIAL_DOMAIN_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isNoisyWebsiteDomain(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return true;
  if (isSocialDomain(host)) return true;
  if (NOISY_WEBSITE_DOMAIN_RE.test(host)) return true;
  if (host.split('.').some((part) => part.length === 1)) return true;
  return false;
}

function inferProfileUrl(surface: CompetitorSurface, handle: string): string | null {
  if (!handle) return null;
  switch (surface) {
    case 'instagram':
      return `https://www.instagram.com/${handle}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'youtube':
      return `https://www.youtube.com/@${handle}`;
    case 'linkedin':
      return `https://www.linkedin.com/company/${handle}`;
    case 'x':
      return `https://x.com/${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}`;
    case 'website':
      return handle.includes('.') ? `https://${handle}` : null;
    default:
      return null;
  }
}

function domainFromUrl(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function pathSegments(rawHref: string): string[] {
  try {
    const parsed = new URL(rawHref.startsWith('http') ? rawHref : `https://${rawHref}`);
    return parsed.pathname
      .split('/')
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeParsedHandle(raw: string): string | null {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]/g, '');
  if (!value) return null;
  if (SOCIAL_ROUTE_STOPWORDS.has(value) || LOW_SIGNAL_DICTIONARY_HANDLES.has(value)) return null;
  if (!/[a-z]/.test(value)) return null;
  if (value.length < 2 || value.length > 80) return null;
  return value;
}

function parseHandleFromUrl(surface: CompetitorSurface, href: string): string | null {
  const value = String(href || '').trim();
  if (!value) return null;
  const host = domainFromUrl(value);
  if (!host) return null;
  const segments = pathSegments(value);
  if (segments.length === 0) return null;

  if (surface === 'instagram' && !host.endsWith('instagram.com')) return null;
  if (surface === 'tiktok' && !host.endsWith('tiktok.com')) return null;
  if (surface === 'youtube' && !host.endsWith('youtube.com')) return null;
  if (surface === 'linkedin' && !host.endsWith('linkedin.com')) return null;
  if (surface === 'x' && !(host.endsWith('x.com') || host.endsWith('twitter.com'))) return null;
  if (surface === 'facebook' && !(host.endsWith('facebook.com') || host.endsWith('fb.com'))) return null;

  if (surface === 'instagram') {
    const first = segments[0];
    if (!first || SOCIAL_ROUTE_STOPWORDS.has(first)) return null;
    return normalizeParsedHandle(first);
  }

  if (surface === 'tiktok') {
    const first = segments[0];
    if (!first || SOCIAL_ROUTE_STOPWORDS.has(first)) return null;
    if (!first.startsWith('@')) return null;
    return normalizeParsedHandle(first.slice(1));
  }

  if (surface === 'youtube') {
    const first = segments[0];
    if (!first) return null;
    if (first.startsWith('@')) {
      return normalizeParsedHandle(first.slice(1));
    }
    if (first === 'channel' || first === 'c' || first === 'user') {
      const second = segments[1];
      if (!second || SOCIAL_ROUTE_STOPWORDS.has(second)) return null;
      return normalizeParsedHandle(second);
    }
    return null;
  }

  if (surface === 'linkedin') {
    const first = segments[0];
    const second = segments[1];
    if (!(first === 'company' || first === 'in')) return null;
    if (!second || SOCIAL_ROUTE_STOPWORDS.has(second)) return null;
    return normalizeParsedHandle(second);
  }

  if (surface === 'x') {
    const first = segments[0];
    if (!first || SOCIAL_ROUTE_STOPWORDS.has(first)) return null;
    return normalizeParsedHandle(first);
  }

  if (surface === 'facebook') {
    const first = segments[0];
    if (!first || SOCIAL_ROUTE_STOPWORDS.has(first)) return null;
    if (first === 'pages' || first === 'groups' || first === 'watch') return null;
    return normalizeParsedHandle(first);
  }

  return null;
}

function canonicalNameFromHandle(handle: string): string {
  const cleaned = handle.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return handle;
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function maxPerSurface(precision: 'high' | 'balanced'): number {
  return precision === 'high' ? 14 : 24;
}

function candidateTrimRank(candidate: CollectedCandidate): number {
  const sourceScore = Math.min(candidate.sources.length, 4) * 0.22;
  const evidenceScore = Math.min(candidate.evidence.length, 6) * 0.12;
  const urlEvidenceScore = candidate.evidence.some((row) => Boolean(row.url)) ? 0.35 : 0;
  return candidate.baseSignal + sourceScore + evidenceScore + urlEvidenceScore;
}

function finalSurfaceCap(surface: CompetitorSurface, precision: 'high' | 'balanced'): number {
  if (precision === 'balanced') {
    if (surface === 'website') return 16;
    if (surface === 'instagram' || surface === 'tiktok') return 20;
    return 14;
  }
  if (surface === 'website') return 10;
  if (surface === 'instagram' || surface === 'tiktok') return 14;
  return 10;
}

function isLowQualityCandidate(candidate: CollectedCandidate, precision: 'high' | 'balanced'): boolean {
  const rank = candidateTrimRank(candidate);
  const minRank = precision === 'high' ? 0.78 : 0.64;
  const hasUrlEvidence = candidate.evidence.some((row) => Boolean(row.url));
  if (candidate.platform === 'website') {
    return rank < minRank && !hasUrlEvidence;
  }
  return rank < minRank && candidate.sources.length < 2 && !hasUrlEvidence;
}

function buildFallbackQueries(
  surface: CompetitorSurface,
  brandName: string,
  niche: string,
  keywords: string[]
): string[] {
  const anchors = [brandName, niche, ...keywords].filter(Boolean).slice(0, 4);
  const deduped = new Set<string>();

  for (const anchor of anchors) {
    const normalized = String(anchor || '').trim();
    if (!normalized) continue;
    if (surface === 'tiktok') {
      deduped.add(`site:tiktok.com "${normalized}" competitors`);
      deduped.add(`site:tiktok.com "${normalized}" business coach`);
      deduped.add(`site:tiktok.com "${normalized}" creator business`);
      deduped.add(`site:tiktok.com "${normalized}" muslim entrepreneur`);
      deduped.add(`site:tiktok.com "${normalized}" agency owner`);
      deduped.add(`site:tiktok.com "${normalized}" brand strategy`);
    } else if (surface === 'instagram') {
      deduped.add(`site:instagram.com "${normalized}" competitors`);
      deduped.add(`site:instagram.com "${normalized}" business brand`);
    } else if (surface === 'linkedin') {
      deduped.add(`site:linkedin.com/company "${normalized}" alternatives`);
    } else if (surface === 'youtube') {
      deduped.add(`site:youtube.com "${normalized}" competitors channel`);
    } else if (surface === 'website') {
      deduped.add(`"${normalized}" competitors alternatives`);
    }
  }

  return Array.from(deduped);
}

function seedTikTokMirrors(input: CollectorInput, candidates: CollectedCandidate[]): CollectedCandidate[] {
  if (!input.selectedSurfaces.includes('tiktok')) return candidates;

  const existingTikTok = new Set(
    candidates.filter((row) => row.platform === 'tiktok').map((row) => row.normalizedHandle)
  );
  if (existingTikTok.size >= 6) return candidates;

  const mirrorCandidates = candidates
    .filter((row) => row.platform === 'instagram')
    .filter((row) => row.baseSignal >= 0.62 || row.sources.includes('ai_finder'))
    .slice(0, 10);

  const mirroredRows: CollectedCandidate[] = [];
  for (const row of mirrorCandidates) {
    if (existingTikTok.has(row.normalizedHandle)) continue;
    existingTikTok.add(row.normalizedHandle);
    mirroredRows.push({
      ...row,
      platform: 'tiktok',
      profileUrl: inferProfileUrl('tiktok', row.normalizedHandle),
      sources: [...row.sources, 'cross_surface_tiktok_hint'],
      evidence: [
        ...row.evidence,
        {
          sourceType: 'cross_surface_hint',
          query: `tiktok_mirror:${row.normalizedHandle}`,
          title: row.canonicalName,
          snippet: 'Mirrored from high-confidence Instagram peer handle',
          signalScore: 0.34,
        },
      ],
      baseSignal: Math.max(0.34, Math.min(0.58, row.baseSignal * 0.6)),
    });
  }

  return mirroredRows.length > 0 ? [...candidates, ...mirroredRows] : candidates;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function collectCompetitorCandidates(
  input: CollectorInput
): Promise<{ candidates: CollectedCandidate[]; diagnostics: CollectorDiagnostics }> {
  const perPlatform: Record<CompetitorSurface, number> = {
    instagram: 0,
    tiktok: 0,
    youtube: 0,
    linkedin: 0,
    x: 0,
    facebook: 0,
    website: 0,
  };

  const excludeHandles = new Set(input.excludeHandles.map((value) => toHandle(value)));
  const excludeDomains = new Set(input.excludeDomains.map((value) => String(value).toLowerCase()));
  const aggregate = new Map<string, CollectedCandidate>();
  let rawCollectedCount = 0;
  const collectorStartedAt = Date.now();
  const collectorBudgetMs = Math.max(
    45_000,
    Number(process.env.COMPETITOR_COLLECTOR_MAX_MS || (input.precision === 'high' ? 120_000 : 180_000))
  );
  const rawQueryTimeoutMs = input.precision === 'high' ? 20_000 : 30_000;
  const rawQueryMaxResults = input.precision === 'high' ? 50 : 90;
  const fallbackTimeoutMs = input.precision === 'high' ? 15_000 : 20_000;
  const fallbackMaxResults = input.precision === 'high' ? 40 : 60;
  const directQueryLimit = input.precision === 'high' ? 2 : 3;
  const aiFinderTimeoutMs = input.precision === 'high' ? 35_000 : 50_000;
  const isBudgetExceeded = () => Date.now() - collectorStartedAt > collectorBudgetMs;
  const remainingBudgetMs = () => collectorBudgetMs - (Date.now() - collectorStartedAt);
  const boundedTimeout = (preferredMs: number, floorMs: number = 3_000) =>
    Math.max(floorMs, Math.min(preferredMs, Math.max(0, remainingBudgetMs() - 750)));

  const upsertCandidate = (
    surface: CompetitorSurface,
    rawHandle: string,
    source: string,
    signalScore: number,
    evidence: Omit<CandidateEvidenceInput, 'signalScore'>
  ): void => {
    if (!input.selectedSurfaces.includes(surface)) return;
    const normalizedHandle = normalizeHandleForSurface(surface, rawHandle);
    if (!normalizedHandle) return;
    if (surface !== 'website' && handleLooksNoisy(normalizedHandle)) return;
    if (excludeHandles.has(normalizedHandle)) return;
    if (surface === 'website' && (excludeDomains.has(normalizedHandle) || isNoisyWebsiteDomain(normalizedHandle))) {
      return;
    }

    const key = `${surface}:${normalizedHandle}`;
    rawCollectedCount += 1;

    const profileUrl = inferProfileUrl(surface, normalizedHandle);
    const websiteDomain = surface === 'website' ? normalizedHandle : domainFromUrl(profileUrl || '');

    const existing = aggregate.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      existing.baseSignal = Math.max(existing.baseSignal, signalScore);
      existing.evidence.push({
        ...evidence,
        signalScore,
      });
      return;
    }

    aggregate.set(key, {
      platform: surface,
      handle: normalizedHandle,
      normalizedHandle,
      profileUrl,
      canonicalName: canonicalNameFromHandle(normalizedHandle),
      websiteDomain,
      sources: [source],
      evidence: [{ ...evidence, signalScore }],
      baseSignal: signalScore,
    });
  };

  try {
    const social = await searchSocialProfiles(input.brandName, input.researchJobId, {
      timeoutMs: boundedTimeout(45_000),
    });
    input.connectorHealth.markOk('ddg_social_search');

    for (const handle of social.instagram || []) {
      upsertCandidate('instagram', handle, 'social_search', 0.64, {
        sourceType: 'social_search',
        query: `social_search:${input.brandName}`,
      });
    }
    for (const handle of social.tiktok || []) {
      upsertCandidate('tiktok', handle, 'social_search', 0.64, {
        sourceType: 'social_search',
        query: `social_search:${input.brandName}`,
      });
    }
    for (const handle of social.youtube || []) {
      upsertCandidate('youtube', handle, 'social_search', 0.56, {
        sourceType: 'social_search',
        query: `social_search:${input.brandName}`,
      });
    }
    for (const handle of social.linkedin || []) {
      upsertCandidate('linkedin', handle, 'social_search', 0.54, {
        sourceType: 'social_search',
        query: `social_search:${input.brandName}`,
      });
    }
    for (const handle of social.facebook || []) {
      upsertCandidate('facebook', handle, 'social_search', 0.52, {
        sourceType: 'social_search',
        query: `social_search:${input.brandName}`,
      });
    }
    for (const handle of social.twitter || []) {
      upsertCandidate('x', handle, 'social_search', 0.52, {
        sourceType: 'social_search',
        query: `social_search:${input.brandName}`,
      });
    }

    for (const row of social.raw_results || []) {
      const href = String(row.href || '');
      const host = domainFromUrl(href);
      if (!host) continue;

      if (input.selectedSurfaces.includes('website') && !isNoisyWebsiteDomain(host) && !excludeDomains.has(host)) {
        upsertCandidate('website', host, 'social_search_raw', 0.5, {
          sourceType: 'social_search',
          query: row.query || null,
          title: row.title || null,
          url: href,
          snippet: row.body || null,
        });
      }

      const surfaceCandidates: CompetitorSurface[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'facebook'];
      for (const surface of surfaceCandidates) {
        const parsed = parseHandleFromUrl(surface, href);
        if (!parsed) continue;
        upsertCandidate(surface, parsed, 'social_search_raw', 0.58, {
          sourceType: 'social_search',
          query: row.query || null,
          title: row.title || null,
          url: href,
          snippet: row.body || null,
        });
      }
    }
  } catch (error: any) {
    input.connectorHealth.markDegraded('ddg_social_search', error?.message || 'social search failed');
  }

  for (const surface of input.selectedSurfaces) {
    if (isBudgetExceeded()) {
      input.connectorHealth.markDegraded(
        'ddg_raw_query',
        `Collector time budget exceeded before processing surface=${surface}`
      );
      break;
    }

    const queries = input.queryPlan.perSurface[surface] || [];
    if (queries.length === 0) continue;

    try {
      const rawRows = await searchRawDDG(queries, {
        timeoutMs: boundedTimeout(rawQueryTimeoutMs),
        maxResults: rawQueryMaxResults,
        researchJobId: input.researchJobId,
        source: `duckduckgo_orchestrator_${surface}`,
      });
      if (rawRows.length > 0) {
        input.connectorHealth.markOk('ddg_raw_query');
      } else {
        input.connectorHealth.markDegraded('ddg_raw_query', `No raw results for surface=${surface}`);
      }

      for (const row of rawRows) {
        const href = String(row.href || '');
        if (!href) continue;

        if (surface === 'website') {
          const host = domainFromUrl(href);
          if (!host || isNoisyWebsiteDomain(host) || excludeDomains.has(host)) continue;
          upsertCandidate('website', host, 'ddg_query', 0.61, {
            sourceType: 'ddg_query',
            query: row.query || null,
            title: row.title || null,
            url: href,
            snippet: row.body || null,
          });
          continue;
        }

        const parsedHandle = parseHandleFromUrl(surface, href);
        if (!parsedHandle) continue;
        upsertCandidate(surface, parsedHandle, 'ddg_query', 0.63, {
          sourceType: 'ddg_query',
          query: row.query || null,
          title: row.title || null,
          url: href,
          snippet: row.body || null,
        });
      }
    } catch (error: any) {
      input.connectorHealth.markDegraded(
        'ddg_raw_query',
        error?.message || `raw query search failed for ${surface}`
      );
    }

    if (surface !== 'instagram' && surface !== 'tiktok') continue;
    const directQueries = (input.queryPlan.perSurface[surface] || []).slice(0, directQueryLimit);
    for (const query of directQueries) {
      if (isBudgetExceeded()) {
        input.connectorHealth.markDegraded(
          'ddg_direct_search',
          `Collector time budget exceeded during direct search for ${surface}`
        );
        break;
      }

      try {
        const handles = await performDirectCompetitorSearchForPlatform(
          query,
          surface,
          maxPerSurface(input.precision),
          boundedTimeout(30_000)
        );
        input.connectorHealth.markOk('ddg_direct_search');
        for (const handle of handles) {
          upsertCandidate(surface, handle, 'ddg_direct', 0.66, {
            sourceType: 'ddg_query',
            query,
          });
        }
      } catch (error: any) {
        input.connectorHealth.markDegraded('ddg_direct_search', error?.message || `direct search failed for ${surface}`);
      }
    }
  }

  if (
    input.selectedSurfaces.includes('instagram') ||
    input.selectedSurfaces.includes('tiktok')
  ) {
    if (isBudgetExceeded()) {
      input.connectorHealth.markDegraded(
        'ai_competitor_finder',
        'Collector time budget exceeded before AI finder stage'
      );
    } else {
    try {
      const ai = await withTimeout(
        suggestCompetitorsMultiPlatform(
          input.brandName,
          input.niche || 'business',
          input.description,
          {
            maxPerPlatform: input.precision === 'high' ? 14 : 18,
            minRelevanceScore: input.precision === 'high' ? 0.5 : 0.42,
            excludeHandles: Array.from(excludeHandles),
          }
        ),
        boundedTimeout(aiFinderTimeoutMs, 4_000),
        `AI competitor finder timed out after ${aiFinderTimeoutMs}ms`
      );
      input.connectorHealth.markOk('ai_competitor_finder');
      for (const row of ai) {
        const platform =
          row.platform === 'tiktok' ? 'tiktok' : row.platform === 'instagram' ? 'instagram' : null;
        if (!platform) continue;
        upsertCandidate(platform, row.handle, 'ai_finder', row.relevanceScore, {
          sourceType: 'ai_finder',
          query: `ai:${input.brandName}:${input.niche}`,
          title: row.name,
          snippet: row.reasoning,
        });

        // Cross-surface hinting: if TikTok is selected and AI found a strong Instagram peer,
        // attempt the same handle on TikTok (resolver will validate availability).
        if (
          platform === 'instagram' &&
          input.selectedSurfaces.includes('tiktok') &&
          row.relevanceScore >= 0.72
        ) {
          upsertCandidate('tiktok', row.handle, 'ai_cross_surface_hint', 0.35, {
            sourceType: 'ai_hint',
            query: `cross_surface:${row.handle}`,
            title: row.name,
            snippet: row.reasoning,
          });
        }
      }
    } catch (error: any) {
      input.connectorHealth.markDegraded('ai_competitor_finder', error?.message || 'AI finder failed');
    }
    }
  }

  const surfaceCounts = Array.from(aggregate.values()).reduce<Record<CompetitorSurface, number>>(
    (acc, candidate) => {
      acc[candidate.platform] = (acc[candidate.platform] || 0) + 1;
      return acc;
    },
    {
      instagram: 0,
      tiktok: 0,
      youtube: 0,
      linkedin: 0,
      x: 0,
      facebook: 0,
      website: 0,
    }
  );

  for (const surface of input.selectedSurfaces) {
    if (isBudgetExceeded()) {
      input.connectorHealth.markDegraded(
        'ddg_raw_query',
        `Collector time budget exceeded before fallback for surface=${surface}`
      );
      break;
    }

    const minimumTarget = surface === 'tiktok' ? 6 : surface === 'instagram' ? 6 : 3;
    if ((surfaceCounts[surface] || 0) >= minimumTarget) continue;

    const fallbackQueries = buildFallbackQueries(
      surface,
      input.brandName,
      input.niche,
      input.queryPlan.businessKeywords
    );
    if (fallbackQueries.length === 0) continue;

    try {
      const fallbackRows = await searchRawDDG(fallbackQueries, {
        timeoutMs: boundedTimeout(fallbackTimeoutMs),
        maxResults: fallbackMaxResults,
        researchJobId: input.researchJobId,
        source: `duckduckgo_orchestrator_fallback_${surface}`,
      });
      for (const row of fallbackRows) {
        const href = String(row.href || '');
        if (!href) continue;

        if (surface === 'website') {
          const host = domainFromUrl(href);
          if (!host || isNoisyWebsiteDomain(host) || excludeDomains.has(host)) continue;
          upsertCandidate('website', host, 'ddg_fallback', 0.56, {
            sourceType: 'ddg_fallback',
            query: row.query || null,
            title: row.title || null,
            url: href,
            snippet: row.body || null,
          });
          continue;
        }

        const parsedHandle = parseHandleFromUrl(surface, href);
        if (!parsedHandle) continue;
        upsertCandidate(surface, parsedHandle, 'ddg_fallback', 0.57, {
          sourceType: 'ddg_fallback',
          query: row.query || null,
          title: row.title || null,
          url: href,
          snippet: row.body || null,
        });
      }
      input.connectorHealth.markOk('ddg_raw_query');
    } catch (error: any) {
      input.connectorHealth.markDegraded(
        'ddg_raw_query',
        error?.message || `fallback raw query failed for ${surface}`
      );
    }
  }

  const candidatePool = seedTikTokMirrors(input, Array.from(aggregate.values()));
  const groupedBySurface = new Map<CompetitorSurface, CollectedCandidate[]>();
  for (const candidate of candidatePool) {
    if (isLowQualityCandidate(candidate, input.precision)) continue;
    const existing = groupedBySurface.get(candidate.platform) || [];
    existing.push(candidate);
    groupedBySurface.set(candidate.platform, existing);
  }

  const candidates: CollectedCandidate[] = [];
  for (const [surface, rows] of groupedBySurface.entries()) {
    const cap = finalSurfaceCap(surface, input.precision);
    const ranked = rows
      .sort((a, b) => candidateTrimRank(b) - candidateTrimRank(a))
      .slice(0, cap);
    candidates.push(...ranked);
  }

  for (const candidate of candidates) {
    perPlatform[candidate.platform] = (perPlatform[candidate.platform] || 0) + 1;
  }

  return {
    candidates,
    diagnostics: {
      rawCollectedCount,
      dedupedCount: candidates.length,
      perPlatform,
    },
  };
}
