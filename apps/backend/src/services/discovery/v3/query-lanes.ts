import type {
  CompetitorDiscoveryLane,
  DiscoverCompetitorsV3Input,
  LaneQuery,
  MarketFingerprint,
} from './types';

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

export function buildLaneQueries(
  fingerprint: MarketFingerprint,
  input: DiscoverCompetitorsV3Input
): LaneQuery[] {
  const locales = Array.isArray(input.locales) && input.locales.length
    ? input.locales.map((locale) => String(locale || '').trim()).filter(Boolean)
    : ['en-US'];
  const lanes = laneEnabledSet(input);

  const primaryKeywords = uniqueStrings([
    ...fingerprint.categoryKeywords.slice(0, 5),
    fingerprint.niche,
  ], 6);
  const audienceKeywords = uniqueStrings(fingerprint.audienceKeywords.slice(0, 4), 4);
  const seeds = seedTerms(fingerprint).slice(0, 10);

  const entries: LaneQuery[] = [];
  const addLane = (lane: CompetitorDiscoveryLane, queries: string[]) => {
    if (!lanes.has(lane)) return;
    const deduped = uniqueStrings(queries, 16);
    for (const locale of locales) {
      for (const query of deduped) {
        entries.push({ lane, query, locale });
      }
    }
  };

  addLane(
    'category',
    primaryKeywords.flatMap((keyword) => [
      `best ${keyword} companies`,
      `top ${keyword} brands`,
      `${keyword} for ${audienceKeywords[0] || 'clients'}`,
    ])
  );

  addLane(
    'alternatives',
    seeds.flatMap((seed) => [
      `${seed} competitors`,
      `${seed} alternatives`,
      `${seed} vs`,
      `brands similar to ${seed}`,
    ])
  );

  addLane(
    'directories',
    primaryKeywords.flatMap((keyword) => [
      `${keyword} alternatives list`,
      `best ${keyword} tools`,
      `${keyword} directory`,
      `top ${keyword} platforms`,
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

  return uniqueStrings(entries.map((entry) => `${entry.lane}|${entry.locale}|${entry.query}`), 220).map((raw) => {
    const [lane, locale, ...queryParts] = raw.split('|');
    return {
      lane: lane as CompetitorDiscoveryLane,
      locale,
      query: queryParts.join('|'),
    };
  });
}
