import { prisma } from '../../../lib/prisma';
import type { DiscoverCompetitorsV3Seed, MarketFingerprint } from './types';

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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function uniqueStrings(items: string[], max = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = String(item || '').trim();
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

function extractSeedCompetitors(inputData: Record<string, unknown>): DiscoverCompetitorsV3Seed[] {
  const seeds: DiscoverCompetitorsV3Seed[] = [];
  const rawLinks = parseArrayish(inputData.competitorInspirationLinks);
  for (const raw of rawLinks.slice(0, 16)) {
    const url = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const socialHandleMatch =
      url.match(/instagram\.com\/([a-z0-9._-]+)/i) ||
      url.match(/tiktok\.com\/@([a-z0-9._-]+)/i) ||
      url.match(/youtube\.com\/@([a-z0-9._-]+)/i) ||
      url.match(/x\.com\/([a-z0-9._-]+)/i) ||
      url.match(/twitter\.com\/([a-z0-9._-]+)/i);
    const handle = socialHandleMatch?.[1] ? String(socialHandleMatch[1]).trim() : undefined;
    seeds.push({
      url,
      ...(handle ? { handle } : {}),
    });
  }
  return seeds;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => String(entry || '')).join(' ');
  return '';
}

export async function buildMarketFingerprint(
  researchJobId: string,
  seedCompetitorsFromArgs: DiscoverCompetitorsV3Seed[] = []
): Promise<MarketFingerprint> {
  const [job, webSources, snapshots, discoveredCompetitors] = await Promise.all([
    prisma.researchJob.findUnique({
      where: { id: researchJobId },
      select: {
        client: { select: { name: true } },
        inputData: true,
      },
    }),
    prisma.webSource.findMany({
      where: { researchJobId, isActive: true },
      select: { url: true, domain: true },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.webPageSnapshot.findMany({
      where: { researchJobId, isActive: true },
      select: { cleanText: true, finalUrl: true, metadata: true, createdAt: true },
      take: 40,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.discoveredCompetitor.findMany({
      where: { researchJobId, isActive: true },
      select: { handle: true, profileUrl: true },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const inputData = asRecord(job?.inputData);
  const brandName =
    String(inputData.name || job?.client?.name || 'Brand').trim() || 'Brand';
  const niche = String(inputData.niche || inputData.businessType || inputData.industry || 'business').trim() || 'business';

  const textCorpus = [
    toText(inputData.oneSentenceDescription),
    toText(inputData.mainOffer),
    toText(inputData.idealAudience),
    toText(inputData.targetAudience),
    toText(inputData.servicesList),
    toText(inputData.topProblems),
    toText(inputData.resultsIn90Days),
    ...snapshots.map((row) => String(row.cleanText || '')),
  ].filter(Boolean);

  const categoryKeywords = uniqueStrings([
    ...topKeywords(textCorpus, 16),
    ...parseArrayish(inputData.servicesList),
    ...parseArrayish(inputData.offerTypes),
  ], 18);

  const problemKeywords = uniqueStrings([
    ...parseArrayish(inputData.topProblems),
    ...topKeywords(parseArrayish(inputData.topProblems), 10),
    ...topKeywords(textCorpus.slice(0, 12), 10),
  ], 14);

  const audienceKeywords = uniqueStrings([
    ...parseArrayish(inputData.idealAudience),
    ...parseArrayish(inputData.targetAudience),
    ...parseArrayish(inputData.wantClientsWhere),
    ...topKeywords([toText(inputData.idealAudience), toText(inputData.targetAudience)], 10),
  ], 14);

  const geoMarkets = uniqueStrings([
    ...parseArrayish(inputData.operateWhere),
    ...parseArrayish(inputData.wantClientsWhere),
    ...parseArrayish(inputData.geoScope),
  ], 8);

  const offerTypes = uniqueStrings([
    ...parseArrayish(inputData.servicesList),
    ...parseArrayish(inputData.mainOffer),
    ...parseArrayish(inputData.businessType),
    ...parseArrayish(inputData.offerTypes),
  ], 12);

  const seedsFromWorkspace: DiscoverCompetitorsV3Seed[] = [
    ...extractSeedCompetitors(inputData),
    ...discoveredCompetitors.map((row) => ({
      ...(row.handle ? { handle: row.handle } : {}),
      ...(row.profileUrl ? { url: row.profileUrl } : {}),
    })),
    ...webSources.map((row) => ({
      url: row.url,
    })),
  ];

  const dedupedSeedTokens = uniqueStrings(
    [...seedCompetitorsFromArgs, ...seedsFromWorkspace].map((seed) => {
      if (seed.url) return `url:${seed.url}`;
      if (seed.handle) return `handle:${seed.handle}`;
      if (seed.name) return `name:${seed.name}`;
      return '';
    }),
    30
  );
  const dedupedSeeds: DiscoverCompetitorsV3Seed[] = [];
  for (const raw of dedupedSeedTokens) {
    const [kind, ...rest] = raw.split(':');
    const value = rest.join(':');
    if (!value) continue;
    if (kind === 'url') {
      dedupedSeeds.push({ url: value });
      continue;
    }
    if (kind === 'handle') {
      dedupedSeeds.push({ handle: value });
      continue;
    }
    if (kind === 'name') {
      dedupedSeeds.push({ name: value });
    }
  }

  return {
    brandName,
    niche,
    categoryKeywords: categoryKeywords.length ? categoryKeywords : [niche, `${niche} brand`],
    problemKeywords,
    audienceKeywords,
    geoMarkets,
    offerTypes,
    seedCompetitors: dedupedSeeds,
  };
}
