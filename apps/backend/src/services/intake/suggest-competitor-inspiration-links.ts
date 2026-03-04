import { buildLaneQueries } from '../discovery/v3/query-lanes';
import type { CompetitorDiscoveryLane, MarketFingerprint } from '../discovery/v3/types';
import { searchWeb } from '../search/search-service';
import type { SearchRequest, SearchResponse, SearchResultItem } from '../search/search-provider';
import {
  getProfileUrl,
  normalizeWebsiteDomain,
  parseCompetitorInspirationInputs,
} from './brain-intake-utils';
import { normalizeHandleFromUrlOrHandle, normalizeSocialHandlePlatform } from '../handles/platform-handle';

type SearchFn = (
  input: SearchRequest & { provider?: 'auto' | 'brave' | 'ddg' }
) => Promise<SearchResponse>;

type SupportedLane = Extract<
  CompetitorDiscoveryLane,
  'category' | 'alternatives' | 'directories' | 'social' | 'people'
>;

type LaneQuery = { lane: SupportedLane; query: string; locale: string };

type SearchHit = {
  lane: SupportedLane;
  query: string;
  locale: string;
  provider: string;
  item: SearchResultItem;
};

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'among',
  'and',
  'been',
  'being',
  'best',
  'both',
  'business',
  'company',
  'content',
  'create',
  'from',
  'have',
  'into',
  'just',
  'like',
  'many',
  'more',
  'most',
  'other',
  'over',
  'same',
  'some',
  'that',
  'their',
  'them',
  'then',
  'there',
  'they',
  'this',
  'those',
  'very',
  'what',
  'when',
  'where',
  'which',
  'with',
  'your',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'twitter',
  'facebook',
]);

const LANE_WEIGHTS: Record<SupportedLane, number> = {
  category: 1.1,
  alternatives: 1.35,
  directories: 1.2,
  social: 1.0,
  people: 0.95,
};

function partialRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function titleCase(value: string): string {
  return String(value || '')
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ')
    .trim();
}

function normalizeHttpUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    return new URL(url).toString();
  } catch {
    return '';
  }
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeHandle(handle: string): string {
  return String(handle || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function uniqueStrings(items: string[], max = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = String(item || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function tokenize(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && token.length <= 30 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function topKeywords(texts: string[], limit: number): string[] {
  const frequency = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    }
  }
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function parseArrayish(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  return [];
}

function inferBrandNameFromWebsite(website: string): string {
  const url = normalizeHttpUrl(website);
  if (!url) return '';
  const host = hostnameOf(url);
  const root = host.split('.')[0] || '';
  if (!root) return '';
  return titleCase(root.replace(/[-_]+/g, ' ').trim());
}

function buildSelfDomains(payload: Record<string, unknown>): Set<string> {
  const urls = [
    normalizeHttpUrl(payload.website),
    ...parseArrayish(payload.websites).map((entry) => normalizeHttpUrl(entry)),
  ].filter(Boolean);
  const domains = urls
    .map((url) => hostnameOf(url))
    .filter(Boolean)
    .map((host) => host.replace(/^www\./i, '').toLowerCase());
  const out = new Set<string>();
  for (const domain of domains) {
    const normalized = normalizeWebsiteDomain(domain) || domain;
    if (normalized) out.add(normalized.toLowerCase());
  }
  return out;
}

function inferPlatformFromReference(rawValue: string): 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | null {
  const lower = String(rawValue || '').toLowerCase();
  if (lower.includes('instagram.com/')) return 'instagram';
  if (lower.includes('tiktok.com/')) return 'tiktok';
  if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) return 'youtube';
  if (lower.includes('linkedin.com/')) return 'linkedin';
  if (lower.includes('x.com/') || lower.includes('twitter.com/')) return 'x';
  return null;
}

function buildSelfHandles(payload: Record<string, unknown>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const push = (platform: string, handle: string) => {
    const normalized = normalizeHandle(handle);
    if (!normalized) return;
    const key = platform === 'twitter' ? 'x' : platform;
    if (!out.has(key)) out.set(key, new Set<string>());
    out.get(key)!.add(normalized);
  };

  const handles = partialRecord(payload.handles);
  for (const [platformRaw, value] of Object.entries(handles)) {
    const platform = platformRaw === 'twitter' ? 'x' : platformRaw;
    if (!['instagram', 'tiktok', 'youtube', 'linkedin', 'x'].includes(platform)) continue;
    const parserPlatform = platform === 'x' ? 'x' : platform;
    const handle = normalizeHandleFromUrlOrHandle(value, parserPlatform as any);
    if (handle) push(platform, handle);
  }

  const handlesV2 = partialRecord(payload.handlesV2);
  for (const [platformRaw, rawBucket] of Object.entries(handlesV2)) {
    const platform = platformRaw === 'twitter' ? 'x' : platformRaw;
    if (!['instagram', 'tiktok', 'youtube', 'linkedin', 'x'].includes(platform)) continue;
    const bucket = partialRecord(rawBucket);
    const parserPlatform = platform === 'x' ? 'x' : platform;
    const primary = normalizeHandleFromUrlOrHandle(bucket.primary, parserPlatform as any);
    if (primary) push(platform, primary);
    const list = Array.isArray(bucket.handles) ? bucket.handles : [];
    for (const entry of list) {
      const handle = normalizeHandleFromUrlOrHandle(entry, parserPlatform as any);
      if (handle) push(platform, handle);
    }
  }

  const socialRefs = parseArrayish(payload.socialReferences);
  for (const ref of socialRefs) {
    const platformFromString = normalizeSocialHandlePlatform(ref);
    const inferred = inferPlatformFromReference(ref);
    const platform =
      platformFromString === 'x' ? 'x' : platformFromString && platformFromString !== 'facebook' ? platformFromString : inferred;
    if (!platform) continue;
    const parserPlatform = platform === 'x' ? 'x' : platform;
    const handle = normalizeHandleFromUrlOrHandle(ref, parserPlatform as any);
    if (handle) push(platform, handle);
  }

  const derivedCandidates: string[] = [];
  const name = String(payload.name || '').trim();
  if (name) derivedCandidates.push(name);
  const primaryWebsite = normalizeHttpUrl(payload.website);
  if (primaryWebsite) {
    const host = hostnameOf(primaryWebsite);
    const root = host.split('.')[0] || '';
    if (root) derivedCandidates.push(root);
  }
  const websiteList = parseArrayish(payload.websites);
  for (const raw of websiteList.slice(0, 2)) {
    const url = normalizeHttpUrl(raw);
    if (!url) continue;
    const host = hostnameOf(url);
    const root = host.split('.')[0] || '';
    if (root) derivedCandidates.push(root);
  }

  const derivedHandles = uniqueStrings(
    derivedCandidates
      .map((value) =>
        String(value || '')
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '')
          .replace(/^[._-]+|[._-]+$/g, '')
          .trim()
      )
      .filter((value) => value.length >= 3 && value.length <= 40),
    6
  );
  for (const derivedHandle of derivedHandles) {
    for (const platform of ['instagram', 'tiktok', 'youtube', 'linkedin', 'x']) {
      push(platform, derivedHandle);
    }
  }

  return out;
}

function detectPlatform(url: string): 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'web' {
  const host = hostnameOf(url);
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
  return 'web';
}

function pathParts(url: string): string[] {
  try {
    const parsed = new URL(url);
    return parsed.pathname
      .split('/')
      .map((part) => String(part || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function inferHandle(url: string, platform: string): string {
  const parts = pathParts(url);
  if (platform === 'instagram') return normalizeHandle(parts[0] || '');
  if (platform === 'tiktok') {
    const at = parts.find((part) => part.startsWith('@')) || parts[0] || '';
    return normalizeHandle(String(at).replace(/^@/, ''));
  }
  if (platform === 'youtube') {
    const at = parts.find((part) => part.startsWith('@'));
    if (at) return normalizeHandle(String(at).replace(/^@/, ''));
    if (parts[0] && ['channel', 'c', 'user'].includes(parts[0].toLowerCase()) && parts[1]) {
      return normalizeHandle(parts[1]);
    }
    return normalizeHandle(parts[0] || '');
  }
  if (platform === 'linkedin') {
    if (parts[0] === 'company' && parts[1]) return normalizeHandle(parts[1]);
    if (parts[0] === 'in' && parts[1]) return normalizeHandle(parts[1]);
    return normalizeHandle(parts[0] || '');
  }
  if (platform === 'x') return normalizeHandle(parts[0] || '');
  return normalizeWebsiteDomain(hostnameOf(url)) || hostnameOf(url);
}

function normalizeEvidenceUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    parsed.hash = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      const normalized = String(key || '').trim().toLowerCase();
      if (!normalized) continue;
      if (normalized.startsWith('utm_')) {
        parsed.searchParams.delete(key);
        continue;
      }
      if (['gclid', 'fbclid', 'igshid', 'mc_cid', 'mc_eid'].includes(normalized)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
    return parsed.toString();
  } catch {
    return raw;
  }
}

function isSelfCandidate(
  candidate: { platform: string; handle: string; url: string },
  selfDomains: Set<string>,
  selfHandles: Map<string, Set<string>>
): boolean {
  if (candidate.platform === 'web') {
    const domain = normalizeWebsiteDomain(candidate.handle) || candidate.handle;
    return domain ? selfDomains.has(domain.toLowerCase()) : false;
  }
  const bucket = selfHandles.get(candidate.platform) || new Set<string>();
  return bucket.has(normalizeHandle(candidate.handle));
}

function scoreCandidate(hits: SearchHit[], keywords: string[]): number {
  const first = hits[0];
  const laneWeight = LANE_WEIGHTS[first.lane] || 1;
  const bestRank = Math.min(...hits.map((hit) => Number(hit.item.rank || 0)));
  const rankWeight = Math.max(0.15, 1.2 - bestRank * 0.08);
  const occurrenceBoost = Math.min(0.8, hits.length * 0.12);
  const combinedText = hits
    .map((hit) => `${hit.item.title || ''} ${hit.item.snippet || ''}`)
    .join(' ')
    .toLowerCase();
  const overlap = keywords.filter((keyword) => combinedText.includes(keyword.toLowerCase())).length;
  const keywordBoost = Math.min(0.9, overlap * 0.1);
  return laneWeight + rankWeight + occurrenceBoost + keywordBoost;
}

function toCanonicalLink(candidate: {
  platform: 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'web';
  handle: string;
  url: string;
}): string {
  if (candidate.platform === 'web') {
    const normalizedUrl = normalizeEvidenceUrl(candidate.url);
    try {
      const parsed = new URL(normalizedUrl);
      const domain = normalizeWebsiteDomain(parsed.hostname) || parsed.hostname;
      if (!domain) return normalizedUrl;
      const hasPathSignal = parsed.pathname && parsed.pathname !== '/' && parsed.pathname.length > 1;
      const hasQuerySignal = parsed.search && parsed.search.length > 0;
      if (hasPathSignal || hasQuerySignal) {
        return parsed.toString();
      }
      return `https://${domain.replace(/^www\./i, '').toLowerCase()}/`;
    } catch {
      const domain = normalizeWebsiteDomain(candidate.handle) || candidate.handle;
      return domain ? `https://${domain.replace(/^www\./i, '').toLowerCase()}/` : normalizedUrl;
    }
  }
  const canonicalProfile = getProfileUrl(candidate.platform, normalizeHandle(candidate.handle));
  const preferred = normalizeEvidenceUrl(canonicalProfile || candidate.url);
  if (preferred.startsWith('http')) return preferred;
  const fallback = normalizeEvidenceUrl(candidate.url);
  return fallback || preferred;
}

function buildFingerprint(
  intakePayload: Record<string, unknown>,
  existingLinks: string[]
): {
  fingerprint: MarketFingerprint;
  selfDomains: Set<string>;
  selfHandles: Map<string, Set<string>>;
  existingKeys: Set<string>;
} {
  const selfDomains = buildSelfDomains(intakePayload);
  const selfHandles = buildSelfHandles(intakePayload);

  const website = normalizeHttpUrl(intakePayload.website) || '';
  const brandName =
    String(intakePayload.name || '').trim() ||
    inferBrandNameFromWebsite(website) ||
    'Brand';
  const niche =
    String(intakePayload.niche || intakePayload.businessType || intakePayload.industry || '').trim() ||
    'business';

  const evidenceContext = [
    String(intakePayload._websiteEvidence || intakePayload.websiteEvidence || '').trim(),
    String(intakePayload._ddgEvidence || intakePayload.ddgEvidence || '').trim(),
  ]
    .filter(Boolean)
    .join('\n');

  const corpus = [
    String(intakePayload.oneSentenceDescription || '').trim(),
    String(intakePayload.mainOffer || '').trim(),
    parseArrayish(intakePayload.servicesList).join(' '),
    String(intakePayload.idealAudience || '').trim(),
    String(intakePayload.targetAudience || '').trim(),
    parseArrayish(intakePayload.topProblems).join(' '),
    String(intakePayload.niche || '').trim(),
    String(intakePayload.businessType || '').trim(),
    evidenceContext,
  ].filter(Boolean);

  const brandTokens = new Set<string>(
    uniqueStrings(
      [
        ...tokenize(brandName),
        ...Array.from(selfDomains).flatMap((domain) => tokenize(domain.replace(/\./g, ' '))),
      ],
      30
    )
  );

  const categoryKeywords = uniqueStrings(
    topKeywords(corpus, 20).filter((token) => !brandTokens.has(token)),
    18
  );

  const topProblems = parseArrayish(intakePayload.topProblems);
  const problemKeywords = uniqueStrings(
    [...topProblems, ...topKeywords(topProblems, 10)].filter(Boolean),
    14
  );

  const audienceKeywords = uniqueStrings(
    [
      ...tokenize(String(intakePayload.idealAudience || '')),
      ...tokenize(String(intakePayload.targetAudience || '')),
    ],
    14
  );

  const offerTypes = uniqueStrings(
    [
      ...parseArrayish(intakePayload.servicesList),
      String(intakePayload.mainOffer || '').trim(),
      String(intakePayload.businessType || '').trim(),
    ].filter(Boolean),
    12
  );

  const geoMarkets = uniqueStrings(
    [
      String(intakePayload.operateWhere || '').trim(),
      String(intakePayload.wantClientsWhere || '').trim(),
      String(intakePayload.geoScope || '').trim(),
    ].filter(Boolean),
    8
  );

  const parsedExisting = parseCompetitorInspirationInputs(existingLinks);
  const existingKeys = new Set<string>();
  const seedCompetitors = parsedExisting
    .filter((row) => {
      if (row.inputType === 'website') {
        const domain = normalizeWebsiteDomain(row.domain) || row.domain;
        if (!domain) return false;
        const normalizedDomain = domain.toLowerCase();
        if (selfDomains.has(normalizedDomain)) return false;
        existingKeys.add(`web:${normalizedDomain}`);
        return true;
      }
      const platform = row.inputType === 'x' ? 'x' : row.inputType;
      const handle = normalizeHandle(row.handle);
      if (!handle) return false;
      if (selfHandles.get(platform)?.has(handle)) return false;
      existingKeys.add(`${platform}:${handle}`);
      return true;
    })
    .slice(0, 10)
    .map((row) =>
      row.inputType === 'website'
        ? { url: row.sourceUrl }
        : { handle: row.handle }
    );

  return {
    fingerprint: {
      brandName,
      niche,
      categoryKeywords: categoryKeywords.length ? categoryKeywords : [niche, `${niche} brand`],
      problemKeywords,
      audienceKeywords,
      geoMarkets,
      offerTypes,
      seedCompetitors,
    },
    selfDomains,
    selfHandles,
    existingKeys,
  };
}

function pickQueries(
  all: Array<{ lane: CompetitorDiscoveryLane; query: string; locale: string }>,
  fingerprint: MarketFingerprint,
  limit = 12
): LaneQuery[] {
  const byLane = new Map<SupportedLane, LaneQuery[]>();
  for (const entry of all) {
    if (entry.lane !== 'category' && entry.lane !== 'alternatives' && entry.lane !== 'directories' && entry.lane !== 'social' && entry.lane !== 'people') {
      continue;
    }
    const lane = entry.lane as SupportedLane;
    const bucket = byLane.get(lane) || [];
    bucket.push({ lane, query: entry.query, locale: entry.locale });
    byLane.set(lane, bucket);
  }

  const out: LaneQuery[] = [];
  const take = (lane: SupportedLane, count: number) => {
    const bucket = byLane.get(lane) || [];
    for (const entry of bucket) {
      if (out.length >= limit) break;
      if (out.some((existing) => existing.query === entry.query && existing.lane === entry.lane)) continue;
      out.push(entry);
      if (out.filter((row) => row.lane === lane).length >= count) break;
    }
  };

  // Always include social queries (helps find competitor brand accounts).
  take('social', 4);

  // Prefer alternatives queries that mention something other than the brand name if possible.
  const alternatives = (byLane.get('alternatives') || []).slice();
  const brandName = String(fingerprint.brandName || '').trim().toLowerCase();
  const scoredAlt = alternatives
    .map((entry) => {
      const lowered = entry.query.toLowerCase();
      const hasBrand = brandName ? lowered.includes(brandName) : false;
      const hasAlternatives = lowered.includes('alternatives');
      const hasCompetitors = lowered.includes('competitors');
      const score = (hasAlternatives ? 3 : 0) + (hasCompetitors ? 2 : 0) + (hasBrand ? 0 : 1);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score);
  for (const row of scoredAlt) {
    if (out.length >= limit) break;
    if (out.filter((q) => q.lane === 'alternatives').length >= 4) break;
    out.push(row.entry);
  }

  take('category', 2);
  take('directories', 2);
  take('people', out.length < limit ? 1 : 0);

  return out.slice(0, limit);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };

  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, () => runWorker()));
  return results;
}

export async function suggestCompetitorInspirationLinks(input: {
  intakePayload: Record<string, unknown>;
  existingLinks: string[];
  desiredCount?: number;
  search?: SearchFn;
}): Promise<{ links: string[]; warnings: string[] }> {
  const desiredCount = Number.isFinite(Number(input.desiredCount))
    ? Math.max(1, Math.min(5, Math.floor(Number(input.desiredCount))))
    : 5;
  const existingLinks = Array.isArray(input.existingLinks) ? input.existingLinks : [];
  const search = input.search || searchWeb;

  const warnings: string[] = [];
  const { fingerprint, selfDomains, selfHandles, existingKeys } = buildFingerprint(
    input.intakePayload || {},
    existingLinks
  );

  const keywords = uniqueStrings(
    [
      ...fingerprint.categoryKeywords,
      ...fingerprint.problemKeywords,
      ...fingerprint.audienceKeywords,
      ...tokenize(fingerprint.niche),
    ].filter(Boolean),
    30
  );

  const laneQueries = buildLaneQueries(fingerprint, {
    lanes: ['alternatives', 'category', 'directories', 'social', 'people'],
    locales: ['en-US'],
    includePeople: true,
  });
  const selectedQueries = pickQueries(laneQueries, fingerprint, 12);
  if (selectedQueries.length === 0) {
    return { links: existingLinks.slice(0, desiredCount), warnings: ['COMPETITOR_LINK_DISCOVERY_NO_QUERIES'] };
  }

  const hitsByQuery = await mapWithConcurrency(
    selectedQueries,
    3,
    async (entry): Promise<{ entry: LaneQuery; response: SearchResponse | null }> => {
      try {
        const response = await search({
          query: entry.query,
          count: 6,
          vertical: 'web',
          locale: entry.locale,
          provider: 'auto',
        });
        return { entry, response };
      } catch (error: any) {
        warnings.push(`COMPETITOR_LINK_DISCOVERY_QUERY_FAILED:${entry.lane}`);
        return { entry, response: null };
      }
    }
  );

  const allHits: SearchHit[] = [];
  for (const row of hitsByQuery) {
    const response = row.response;
    if (!response?.items?.length) continue;
    for (const item of response.items) {
      allHits.push({
        lane: row.entry.lane,
        query: row.entry.query,
        locale: row.entry.locale,
        provider: response.provider,
        item,
      });
    }
  }

  type Candidate = {
    platform: 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'web';
    handle: string;
    url: string;
    score: number;
    laneHits: SupportedLane[];
  };

  const grouped = new Map<string, SearchHit[]>();
  for (const hit of allHits) {
    const url = normalizeEvidenceUrl(hit.item.url);
    const platform = detectPlatform(url);
    const handle = inferHandle(url, platform);
    if (!handle) continue;
    const keyPlatform = platform === 'web' ? 'web' : platform;
    const groupKey = `${keyPlatform}:${handle}`;
    const group = grouped.get(groupKey) || [];
    group.push({ ...hit, item: { ...hit.item, url } });
    grouped.set(groupKey, group);
  }

  const candidates: Candidate[] = [];
  for (const [key, group] of grouped.entries()) {
    const [platformRaw, handleRaw] = key.split(':');
    const platform = platformRaw as Candidate['platform'];
    const handle = handleRaw || '';
    const firstUrl = normalizeEvidenceUrl(group[0]?.item?.url || '');
    if (!firstUrl) continue;
    const rawCandidate = { platform, handle, url: firstUrl };
    if (isSelfCandidate(rawCandidate, selfDomains, selfHandles)) continue;
    if (platform === 'web') {
      const domain = normalizeWebsiteDomain(handle) || handle;
      if (domain && existingKeys.has(`web:${domain.toLowerCase()}`)) continue;
    } else if (existingKeys.has(`${platform}:${normalizeHandle(handle)}`)) {
      continue;
    }
    const laneHits = uniqueStrings(group.map((entry) => entry.lane), 6) as SupportedLane[];
    const score = scoreCandidate(group, keywords);
    candidates.push({
      platform,
      handle,
      url: firstUrl,
      score,
      laneHits,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const existingNormalized = parseCompetitorInspirationInputs(existingLinks)
    .filter((row) => {
      if (row.inputType === 'website') {
        const domain = normalizeWebsiteDomain(row.domain) || row.domain;
        return domain ? !selfDomains.has(domain.toLowerCase()) : false;
      }
      const platform = row.inputType === 'x' ? 'x' : row.inputType;
      const handle = normalizeHandle(row.handle);
      return handle ? !(selfHandles.get(platform)?.has(handle)) : false;
    })
    .map((row) => {
      if (row.inputType === 'website') return normalizeEvidenceUrl(row.sourceUrl);
      return normalizeEvidenceUrl(getProfileUrl(row.inputType, row.handle) || row.sourceUrl);
    })
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  const pushLink = (link: string) => {
    const normalized = normalizeEvidenceUrl(link);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };

  for (const link of existingNormalized) {
    pushLink(link);
    if (out.length >= desiredCount) return { links: out.slice(0, desiredCount), warnings: uniqueStrings(warnings, 12) };
  }

  const hasSocialCandidate = candidates.some((c) => c.platform !== 'web');
  const currentHasSocial = out.some((link) => detectPlatform(link) !== 'web');

  if (!currentHasSocial && hasSocialCandidate) {
    const bestSocial = candidates.find((c) => c.platform !== 'web');
    if (bestSocial) {
      pushLink(toCanonicalLink(bestSocial));
    }
  }

  let webCount = out.filter((link) => detectPlatform(link) === 'web').length;
  let remainingSocialCandidates = candidates.filter((c) => c.platform !== 'web').length;

  for (const candidate of candidates) {
    if (out.length >= desiredCount) break;
    const canonical = toCanonicalLink(candidate);
    if (!canonical) continue;
    const platform = detectPlatform(canonical);
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;

    const isWeb = platform === 'web';
    if (isWeb) {
      const enforceSoftCap = out.length < desiredCount - 1 && remainingSocialCandidates > 0;
      if (enforceSoftCap && webCount >= 3) {
        continue;
      }
      webCount += 1;
    } else {
      remainingSocialCandidates = Math.max(0, remainingSocialCandidates - 1);
    }

    seen.add(key);
    out.push(canonical);
  }

  return {
    links: out.slice(0, desiredCount),
    warnings: uniqueStrings(warnings, 12),
  };
}
