import OpenAI from 'openai';
import { isOpenAiConfiguredForRealMode } from '../../lib/runtime-preflight';

type SupportedPlatform = 'instagram' | 'tiktok';

export type DiscoverySeedCompetitor = {
  handle: string;
  platform: SupportedPlatform;
  confidence: number;
  reason: string;
};

export type CompetitorDiscoveryPlan = {
  planner: 'ai' | 'fallback';
  rationale: string;
  algorithmicNiches: string[];
  instagramQueries: string[];
  tiktokQueries: string[];
  seedCompetitors: DiscoverySeedCompetitor[];
};

export type CompetitorDiscoveryRagContext = {
  brandName: string;
  seedHandle: string;
  niche: string;
  description: string;
  businessSignals: string[];
  audienceSignals: string[];
  clientBios: string[];
  previousTopCompetitors: string[];
  recentSearchSnippets: string[];
};

const KEYWORD_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'their',
  'about',
  'business',
  'brand',
  'content',
  'strategy',
  'social',
  'media',
  'instagram',
  'tiktok',
  'community',
  'official',
  'www',
  'http',
  'https',
  'com',
]);

const DISCOVERY_ARCHETYPE_RULES: Array<{
  archetype: string;
  keywords: string[];
  instagramIntents: string[];
  tiktokIntents: string[];
}> = [
  {
    archetype: 'education',
    keywords: ['academy', 'course', 'mentor', 'mentorship', 'teach', 'learning', 'training', 'incubator'],
    instagramIntents: ['academy brands', 'education founders', 'learning community accounts'],
    tiktokIntents: ['education creators', 'teaching creators', 'learning creators'],
  },
  {
    archetype: 'consulting',
    keywords: ['consulting', 'consultant', 'coach', 'agency', 'strategist', 'advisor', 'service'],
    instagramIntents: ['consulting brands', 'coach businesses', 'agency founders'],
    tiktokIntents: ['coach creators', 'consulting creators', 'service business creators'],
  },
  {
    archetype: 'saas',
    keywords: ['saas', 'software', 'app', 'platform', 'tool', 'automation', 'crm'],
    instagramIntents: ['software brands', 'saas founders', 'product-led brands'],
    tiktokIntents: ['software creators', 'saas educators', 'tool review creators'],
  },
  {
    archetype: 'ecommerce',
    keywords: ['shop', 'store', 'ecommerce', 'd2c', 'product', 'brand', 'merch'],
    instagramIntents: ['d2c brands', 'ecommerce founders', 'product brands'],
    tiktokIntents: ['ecommerce creators', 'product business creators', 'd2c creators'],
  },
  {
    archetype: 'media',
    keywords: ['podcast', 'newsletter', 'media', 'creator', 'community', 'content', 'audience'],
    instagramIntents: ['media brands', 'community-led brands', 'creator businesses'],
    tiktokIntents: ['community creators', 'media creators', 'creator business accounts'],
  },
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeHandle(raw: string): string {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^@+/, '')
    .split('?')[0]
    .split('#')[0]
    .split('/')[0]
    .replace(/[^a-z0-9._]/g, '');
  return normalized;
}

function sanitizeQuery(query: string, platform: SupportedPlatform): string {
  const normalized = String(query || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
  if (!normalized) return '';
  const hardLimit = 260;
  let clipped = normalized.slice(0, hardLimit);
  if (platform === 'instagram' && !clipped.toLowerCase().includes('instagram')) {
    clipped = `${clipped} instagram`;
  }
  if (platform === 'tiktok' && !clipped.toLowerCase().includes('tiktok')) {
    clipped = `${clipped} tiktok`;
  }

  return clipped.slice(0, hardLimit);
}

function dedupeAdjacentWords(query: string): string {
  const words = String(query || '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (out.length > 0 && out[out.length - 1].toLowerCase() === lower) continue;
    out.push(word);
  }
  return out.join(' ');
}

function dedupeQueries(queries: string[], platform: SupportedPlatform, limit: number): string[] {
  const deduped = new Set<string>();
  for (const query of queries) {
    const cleaned = sanitizeQuery(dedupeAdjacentWords(query), platform);
    if (!cleaned) continue;
    deduped.add(cleaned);
    if (deduped.size >= limit) break;
  }
  return Array.from(deduped);
}

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !KEYWORD_STOPWORDS.has(token));
}

function extractTopKeywords(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const token of tokenize(value)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

function extractHistoricalHandles(previousTopCompetitors: string[], limit: number = 10): string[] {
  const handles = new Set<string>();
  for (const value of previousTopCompetitors || []) {
    const parts = String(value || '').split(':');
    const rawHandle = parts.length > 1 ? parts[1] : parts[0];
    const handle = normalizeHandle(rawHandle || '');
    if (!handle) continue;
    handles.add(handle);
    if (handles.size >= limit) break;
  }
  return Array.from(handles);
}

function inferDiscoveryArchetypes(
  context: CompetitorDiscoveryRagContext,
  keywords: string[],
  audienceKeywords: string[]
): string[] {
  const contextText = [
    context.niche,
    context.description,
    ...context.businessSignals,
    ...context.audienceSignals,
    ...keywords,
    ...audienceKeywords,
  ]
    .join(' ')
    .toLowerCase();

  const matched = new Set<string>();
  for (const rule of DISCOVERY_ARCHETYPE_RULES) {
    if (rule.keywords.some((keyword) => contextText.includes(keyword))) {
      matched.add(rule.archetype);
    }
  }

  if (matched.size === 0) {
    matched.add('media');
  }

  return Array.from(matched).slice(0, 3);
}

function buildArchetypeQueries(
  archetypes: string[],
  primaryKeyword: string,
  secondaryKeyword: string,
  audienceAnchor: string
): { instagram: string[]; tiktok: string[] } {
  const instagram: string[] = [];
  const tiktok: string[] = [];

  for (const archetype of archetypes) {
    const rule = DISCOVERY_ARCHETYPE_RULES.find((entry) => entry.archetype === archetype);
    if (!rule) continue;

    for (const intent of rule.instagramIntents) {
      instagram.push(`${primaryKeyword} ${intent}`);
      instagram.push(`${secondaryKeyword} ${audienceAnchor} ${intent}`);
    }
    for (const intent of rule.tiktokIntents) {
      tiktok.push(`${primaryKeyword} ${intent}`);
      tiktok.push(`${secondaryKeyword} ${audienceAnchor} ${intent}`);
    }
  }

  return { instagram, tiktok };
}

function buildFallbackPlan(
  context: CompetitorDiscoveryRagContext,
  platforms: SupportedPlatform[]
): CompetitorDiscoveryPlan {
  const keywords = extractTopKeywords(
    [
      context.niche,
      context.description,
      ...context.businessSignals,
      ...context.audienceSignals,
      ...context.clientBios,
      ...context.recentSearchSnippets,
    ],
    10
  );
  const audienceKeywords = extractTopKeywords(context.audienceSignals, 5);
  const historicalHandles = extractHistoricalHandles(context.previousTopCompetitors, 8);
  const primaryKeyword = keywords[0] || context.niche || 'business';
  const secondaryKeyword = keywords[1] || context.niche || 'creator';
  const tertiaryKeyword = keywords[2] || audienceKeywords[0] || secondaryKeyword;
  const baseName = context.brandName || context.seedHandle || context.niche;
  const audienceAnchor = audienceKeywords[0] || 'audience';
  const archetypes = inferDiscoveryArchetypes(context, keywords, audienceKeywords);
  const archetypeQueries = buildArchetypeQueries(
    archetypes,
    primaryKeyword,
    secondaryKeyword,
    audienceAnchor
  );

  const sharedIntentQueries = [
    `${baseName} direct competitors`,
    `${baseName} alternatives`,
    `${primaryKeyword} brands similar to ${baseName}`,
    `${primaryKeyword} ${audienceAnchor} businesses`,
    `${secondaryKeyword} ${tertiaryKeyword} founders`,
    `${context.seedHandle} similar accounts`,
  ];

  const historyAnchoredQueries = historicalHandles.flatMap((handle) => [
    `accounts like ${handle} ${primaryKeyword}`,
    `${handle} alternatives`,
  ]);

  const instagramQueries = dedupeQueries(
    [
      ...archetypeQueries.instagram.map((query) => `${query} instagram`),
      ...historyAnchoredQueries.map((query) => `${query} instagram`),
      ...sharedIntentQueries.map((query) => `${query} instagram`),
      `${primaryKeyword} ${secondaryKeyword} niche instagram brands`,
      `${primaryKeyword} ${audienceAnchor} instagram founders`,
      `${tertiaryKeyword} ${primaryKeyword} instagram community accounts`,
      `"${primaryKeyword}" "${audienceAnchor}" instagram accounts`,
    ],
    'instagram',
    12
  );

  const tiktokQueries = dedupeQueries(
    [
      ...archetypeQueries.tiktok.map((query) => `${query} tiktok`),
      ...historyAnchoredQueries.map((query) => `${query} tiktok`),
      ...sharedIntentQueries.map((query) => `${query} tiktok`),
      `${primaryKeyword} ${secondaryKeyword} niche tiktok creators`,
      `${primaryKeyword} ${audienceAnchor} tiktok educators`,
      `${tertiaryKeyword} ${primaryKeyword} tiktok community accounts`,
      `"${primaryKeyword}" "${audienceAnchor}" tiktok accounts`,
    ],
    'tiktok',
    12
  );

  const algorithmicNiches = Array.from(
    new Set([
      context.niche,
      primaryKeyword,
      secondaryKeyword,
      tertiaryKeyword,
      ...audienceKeywords,
      ...archetypes,
    ].filter(Boolean))
  ).slice(0, 6);

  return {
    planner: 'fallback',
    rationale:
      'Deterministic RAG-driven fallback plan from business, audience, historical peers, and inferred business archetypes.',
    algorithmicNiches,
    instagramQueries: platforms.includes('instagram') ? instagramQueries : [],
    tiktokQueries: platforms.includes('tiktok') ? tiktokQueries : [],
    seedCompetitors: [],
  };
}

function sanitizeSeedCompetitors(raw: any, platforms: SupportedPlatform[]): DiscoverySeedCompetitor[] {
  if (!Array.isArray(raw)) return [];
  const seeds: DiscoverySeedCompetitor[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const platformRaw = String(item?.platform || '').toLowerCase();
    const platform = platformRaw === 'tiktok' ? 'tiktok' : platformRaw === 'instagram' ? 'instagram' : null;
    if (!platform || !platforms.includes(platform)) continue;

    const handle = normalizeHandle(item?.handle || '');
    if (!handle || handle.length < 3) continue;
    const key = `${platform}:${handle}`;
    if (seen.has(key)) continue;
    seen.add(key);

    seeds.push({
      handle,
      platform,
      confidence: clamp01(Number(item?.confidence ?? item?.score ?? 0.7)),
      reason: String(item?.reason || item?.why || 'AI-planned seed competitor').slice(0, 240),
    });

    if (seeds.length >= 20) break;
  }

  return seeds;
}

export async function buildCompetitorDiscoveryPlan(
  context: CompetitorDiscoveryRagContext,
  options: {
    platforms: SupportedPlatform[];
    targetCount: number;
  }
): Promise<CompetitorDiscoveryPlan> {
  const platforms = Array.from(new Set(options.platforms)).filter(
    (platform): platform is SupportedPlatform => platform === 'instagram' || platform === 'tiktok'
  );
  const fallbackPlan = buildFallbackPlan(context, platforms);

  if (!isOpenAiConfiguredForRealMode()) {
    return fallbackPlan;
  }

  try {
    const model = process.env.OPENAI_COMPETITOR_PLANNER_MODEL || process.env.OPENAI_COMPETITOR_MODEL || 'gpt-4o-mini';
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `
You are an expert competitor discovery planner for social media research.
You must produce direct-peer discovery instructions, not generic influencer searches.

Target business context:
${JSON.stringify(
      {
        brandName: context.brandName,
        seedHandle: context.seedHandle,
        niche: context.niche,
        description: context.description,
        businessSignals: context.businessSignals.slice(0, 12),
        audienceSignals: context.audienceSignals.slice(0, 12),
        clientBios: context.clientBios.slice(0, 6),
        previousTopCompetitors: context.previousTopCompetitors.slice(0, 12),
        recentSearchSnippets: context.recentSearchSnippets.slice(0, 8),
      },
      null,
      2
    )}

Requested platforms: ${platforms.join(', ')}
Target competitors per run: ${Math.max(5, Math.min(12, options.targetCount))}

Requirements:
1. Generate platform-specific search queries that surface direct peers in this niche.
2. Avoid generic terms that produce global brands.
3. Use RAG hints (previousTopCompetitors + recentSearchSnippets) to produce specific search instructions.
4. Include only realistic seed handles (if uncertain, omit them).
5. Keep queries concise and high-signal and cover multiple business angles (offer, audience, content model).
6. Include negative intent filters to avoid coupon/giveaway/quotes/fan/meme accounts.
7. Return strict JSON object only.

JSON schema:
{
  "rationale": "short explanation",
  "algorithmicNiches": ["term1", "term2"],
  "instagramQueries": ["query1", "query2"],
  "tiktokQueries": ["query1", "query2"],
  "seedCompetitors": [
    {
      "handle": "candidate_handle",
      "platform": "instagram|tiktok",
      "confidence": 0.0,
      "reason": "why direct peer"
    }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return strict JSON only. No markdown.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1400,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return fallbackPlan;
    const parsed = JSON.parse(raw) as Record<string, any>;

    const aiPlan: CompetitorDiscoveryPlan = {
      planner: 'ai',
      rationale: String(parsed.rationale || 'AI-generated discovery plan').slice(0, 280),
      algorithmicNiches: Array.from(
        new Set(
          (Array.isArray(parsed.algorithmicNiches) ? parsed.algorithmicNiches : [])
            .map((item) => String(item || '').trim())
            .filter((item) => item.length >= 3)
        )
      ).slice(0, 6),
      instagramQueries: dedupeQueries(
        Array.isArray(parsed.instagramQueries) ? parsed.instagramQueries : [],
        'instagram',
        12
      ),
      tiktokQueries: dedupeQueries(
        Array.isArray(parsed.tiktokQueries) ? parsed.tiktokQueries : [],
        'tiktok',
        12
      ),
      seedCompetitors: sanitizeSeedCompetitors(parsed.seedCompetitors, platforms),
    };

    const mergedPlan: CompetitorDiscoveryPlan = {
      planner: aiPlan.planner,
      rationale: aiPlan.rationale,
      algorithmicNiches:
        aiPlan.algorithmicNiches.length > 0 ? aiPlan.algorithmicNiches : fallbackPlan.algorithmicNiches,
      instagramQueries:
        platforms.includes('instagram')
          ? dedupeQueries([...aiPlan.instagramQueries, ...fallbackPlan.instagramQueries], 'instagram', 12)
          : [],
      tiktokQueries:
        platforms.includes('tiktok')
          ? dedupeQueries([...aiPlan.tiktokQueries, ...fallbackPlan.tiktokQueries], 'tiktok', 12)
          : [],
      seedCompetitors: aiPlan.seedCompetitors,
    };

    return mergedPlan;
  } catch (error: any) {
    console.warn(`[CompetitorPlanner] AI plan failed, using fallback: ${error?.message || error}`);
    return fallbackPlan;
  }
}
