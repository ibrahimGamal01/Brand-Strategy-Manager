import type {
  CompetitorDiscoveryLane,
  DiscoverCompetitorsV3Input,
  LaneQuery,
  MarketFingerprint,
} from './types';
import {
  isAcceptableQuery,
  isBadQueryToken,
  resolveQuerySanitizerMode,
  sanitizeAudienceHints,
  sanitizeKeywordList,
  type QuerySanitizerMode,
} from './query-quality';

const DEFAULT_LANES: CompetitorDiscoveryLane[] = [
  'category',
  'alternatives',
  'directories',
  'social',
  'community',
  'people',
];

function uniqueStrings(items: string[], max = 100): string[] {
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

function laneEnabledSet(input: DiscoverCompetitorsV3Input): Set<CompetitorDiscoveryLane> {
  const requested = Array.isArray(input.lanes)
    ? input.lanes
        .map((lane) => String(lane || '').trim().toLowerCase())
        .filter((lane): lane is CompetitorDiscoveryLane =>
          lane === 'category' ||
          lane === 'alternatives' ||
          lane === 'directories' ||
          lane === 'social' ||
          lane === 'community' ||
          lane === 'people'
        )
    : [];

  if (requested.length > 0) return new Set(requested);
  if (input.includePeople === false) {
    return new Set(DEFAULT_LANES.filter((lane) => lane !== 'people'));
  }
  return new Set(DEFAULT_LANES);
}

function seedTerms(fingerprint: MarketFingerprint): string[] {
  const terms = [
    fingerprint.brandName,
    ...fingerprint.seedCompetitors.map((seed) => seed.name || seed.handle || seed.url || ''),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return uniqueStrings(terms, 20);
}

type LaneQueryBuildOutput = {
  queries: LaneQuery[];
  diagnostics: {
    sanitizerMode: QuerySanitizerMode;
    droppedKeywordCount: number;
    droppedQueryCount: number;
    finalQueryCount: number;
  };
};

function sanitizeSeedTerms(rawSeeds: string[], mode: QuerySanitizerMode): string[] {
  const sanitized: string[] = [];
  for (const seedRaw of rawSeeds) {
    const normalized = String(seedRaw || '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalized) continue;
    const words = normalized
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean)
      .filter((word) => !isBadQueryToken(word));
    if (!words.length) continue;
    const phrase = words.join(' ').trim();
    if (phrase.length < 3 || phrase.length > 52) continue;
    if (mode === 'strict' && words.length > 4) continue;
    if (words.length > 6) continue;
    sanitized.push(phrase);
  }
  return uniqueStrings(sanitized, 10);
}

function buildLaneQueriesInternal(
  fingerprint: MarketFingerprint,
  input: DiscoverCompetitorsV3Input
): LaneQueryBuildOutput {
  const sanitizerMode = resolveQuerySanitizerMode(process.env.COMPETITOR_QUERY_SANITIZER_MODE);
  const locales = Array.isArray(input.locales) && input.locales.length
    ? input.locales.map((locale) => String(locale || '').trim()).filter(Boolean)
    : ['en-US'];
  const lanes = laneEnabledSet(input);

  const rawPrimaryKeywords = uniqueStrings([
    ...fingerprint.categoryKeywords.slice(0, 6),
    ...fingerprint.offerTypes.slice(0, 3),
    fingerprint.niche,
  ], 10);
  const rawAudienceKeywords = uniqueStrings(fingerprint.audienceKeywords.slice(0, 6), 6);
  const rawSeedTerms = seedTerms(fingerprint).slice(0, 10);
  const nicheTokens = uniqueStrings([fingerprint.niche, ...fingerprint.offerTypes], 12);
  const primaryKeywords = sanitizeKeywordList({
    rawKeywords: rawPrimaryKeywords,
    brandTokens: [fingerprint.brandName],
    nicheTokens,
    mode: sanitizerMode,
    maxItems: 6,
  });
  if (!primaryKeywords.length) {
    const primaryFallback = sanitizeKeywordList({
      rawKeywords: [fingerprint.niche],
      brandTokens: [fingerprint.brandName],
      nicheTokens,
      mode: sanitizerMode,
      maxItems: 1,
    });
    primaryKeywords.push(...(primaryFallback.length ? primaryFallback : [fingerprint.niche]));
  }
  const audienceKeywords = sanitizeAudienceHints(rawAudienceKeywords);
  const seeds = sanitizeSeedTerms(rawSeedTerms, sanitizerMode);
  const nicheAnchor = sanitizeKeywordList({
    rawKeywords: [fingerprint.niche, ...fingerprint.offerTypes],
    brandTokens: [fingerprint.brandName],
    nicheTokens,
    mode: sanitizerMode,
    maxItems: 2,
  })[0] || 'market';

  const entries: LaneQuery[] = [];
  const addLane = (lane: CompetitorDiscoveryLane, queries: string[]) => {
    if (!lanes.has(lane)) return;
    const deduped = uniqueStrings(queries, 18);
    for (const locale of locales) {
      for (const query of deduped) {
        entries.push({ lane, query, locale });
      }
    }
  };

  addLane(
    'category',
    primaryKeywords.flatMap((keyword) => {
      const audienceHint = audienceKeywords[0] || '';
      const categoryQueries = [
        `${keyword} alternatives ${nicheAnchor}`,
      ];
      if (audienceHint) {
        categoryQueries.push(`${keyword} ${audienceHint} competitors`);
      }
      if (!isBadQueryToken(keyword)) {
        categoryQueries.push(`best ${keyword} companies`);
        categoryQueries.push(`top ${keyword} brands`);
      }
      return categoryQueries;
    })
  );

  addLane(
    'alternatives',
    seeds.flatMap((seed) => [
      `${seed} competitors`,
      `${seed} direct competitors`,
      `${seed} alternatives`,
      `brands similar to ${seed}`,
    ])
  );

  addLane(
    'directories',
    primaryKeywords.flatMap((keyword) => [
      `${keyword} alternatives list`,
      `${keyword} directory`,
      `top ${keyword} platforms`,
      `${keyword} comparison list`,
    ])
  );

  addLane(
    'social',
    primaryKeywords.flatMap((keyword) => [
      `site:instagram.com "${keyword}"`,
      `site:tiktok.com "${keyword}"`,
      `site:youtube.com "${keyword}"`,
      `site:linkedin.com/company "${keyword}"`,
    ])
  );

  addLane(
    'community',
    primaryKeywords.flatMap((keyword) => [
      `site:reddit.com "${keyword}" alternatives`,
      `"${keyword}" recommendations`,
      `site:quora.com "${keyword}"`,
    ])
  );

  addLane(
    'people',
    primaryKeywords.flatMap((keyword) => [
      `${keyword} creator`,
      `${keyword} personal brand`,
      `${keyword} coach`,
      `top ${keyword} influencers`,
    ])
  );

  const deduped = uniqueStrings(entries.map((entry) => `${entry.lane}|${entry.locale}|${entry.query}`), 220).map((raw) => {
    const [lane, locale, ...queryParts] = raw.split('|');
    return {
      lane: lane as CompetitorDiscoveryLane,
      locale,
      query: queryParts.join('|'),
    };
  });

  const accepted: LaneQuery[] = [];
  let droppedQueryCount = 0;
  for (const entry of deduped) {
    if (!isAcceptableQuery(entry.query, { mode: sanitizerMode, minLength: 16, maxLength: 100 })) {
      droppedQueryCount += 1;
      continue;
    }
    accepted.push(entry);
  }

  const rawKeywordTotal = uniqueStrings([...rawPrimaryKeywords, ...rawAudienceKeywords, ...rawSeedTerms], 50).length;
  const sanitizedKeywordTotal = uniqueStrings([...primaryKeywords, ...audienceKeywords, ...seeds], 50).length;
  const droppedKeywordCount = Math.max(0, rawKeywordTotal - sanitizedKeywordTotal);

  return {
    queries: accepted,
    diagnostics: {
      sanitizerMode,
      droppedKeywordCount,
      droppedQueryCount,
      finalQueryCount: accepted.length,
    },
  };
}

export function buildLaneQueries(
  fingerprint: MarketFingerprint,
  input: DiscoverCompetitorsV3Input
): LaneQuery[] {
  return buildLaneQueriesInternal(fingerprint, input).queries;
}

export function buildLaneQueriesWithDiagnostics(
  fingerprint: MarketFingerprint,
  input: DiscoverCompetitorsV3Input
): LaneQueryBuildOutput {
  return buildLaneQueriesInternal(fingerprint, input);
}
