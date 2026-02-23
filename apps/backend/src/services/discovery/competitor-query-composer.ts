import { CompetitorSurface, PlatformMatrix } from './competitor-platform-detector';

export type DiscoveryPrecision = 'high' | 'balanced';

type BusinessArchetype =
  | 'agency'
  | 'creator'
  | 'ecommerce'
  | 'saas'
  | 'enterprise_brand'
  | 'local_business'
  | 'personal_brand'
  | 'nonprofit'
  | 'education'
  | 'general';

export interface CompetitorQueryPlan {
  precision: DiscoveryPrecision;
  negatives: string[];
  perSurface: Record<CompetitorSurface, string[]>;
  businessKeywords: string[];
  audienceKeywords: string[];
  businessType: string;
}

export interface CompetitorQueryComposerInput {
  brandName: string;
  niche: string;
  businessOverview: string;
  audienceSummary: string;
  platformMatrix: PlatformMatrix;
  precision: DiscoveryPrecision;
  extraNegativeTerms?: string[];
}

const STOPWORDS = new Set([
  'a',
  'an',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'from',
  'had',
  'has',
  'have',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'out',
  'should',
  'than',
  'the',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'too',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'and',
  'their',
  'that',
  'brand',
  'business',
  'social',
  'media',
  'official',
  'community',
  'creator',
  'creators',
  'platform',
  'service',
  'services',
  'solution',
  'solutions',
  'agency',
  'agencies',
  'coach',
  'coaching',
  'consulting',
  'consultant',
  'company',
  'companies',
  'founder',
  'founders',
  'member',
  'members',
  'team',
  'temp',
  'seed',
  'smoke',
  'demo',
  'test',
  'testing',
  'sample',
  'smoke',
  'placeholder',
  'dummy',
  'fake',
  'query',
  'search',
  'result',
  'results',
  'site',
  'http',
  'https',
  'www',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'twitter',
  'facebook',
  'profile',
]);

const NEGATIVE_TERMS_BASE = [
  'coupon',
  'deal',
  'deals',
  'discount',
  'giveaway',
  'meme',
  'quotes',
  'fanpage',
  'fan page',
  'fan account',
  'news',
  'celebrity',
  'viral',
  'motivation',
  'clip',
  'clips',
];

const ARCHETYPE_KEYWORDS: Record<BusinessArchetype, string[]> = {
  agency: ['agency', 'consulting', 'consultant', 'services', 'done-for-you'],
  creator: ['creator', 'content', 'influencer', 'media', 'community'],
  ecommerce: ['shop', 'store', 'ecommerce', 'product', 'brand'],
  saas: ['saas', 'software', 'platform', 'tool', 'app'],
  enterprise_brand: ['manufacturer', 'category leader', 'brand', 'product company', 'enterprise'],
  local_business: ['local business', 'near me', 'city', 'studio', 'clinic'],
  personal_brand: ['personal brand', 'coach', 'mentor', 'speaker', 'expert'],
  nonprofit: ['nonprofit', 'foundation', 'charity', 'community', 'mission'],
  education: ['academy', 'course', 'training', 'school', 'learning'],
  general: ['business', 'brand', 'company', 'services'],
};

function tokenize(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function topKeywords(values: string[], limit: number): string[] {
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

function toNegativeClause(terms: string[]): string {
  return terms.map((term) => `-"${term}"`).join(' ');
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeBrandName(value: string): string {
  const cleaned = String(value || '')
    .replace(/\b(temp|seed|demo|test|testing|sample|smoke|dummy|placeholder|fake)\b/gi, ' ')
    .replace(/\bsmoke\s*test\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(value || '').trim();
}

function sanitizeContextField(value: string): string {
  const cleaned = String(value || '')
    .replace(/\b(temp|seed|demo|test|testing|sample|smoke|dummy|placeholder|fake)\b/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\bsmoke\s*test\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 320);
}

function dedupeQueries(queries: string[]): string[] {
  return Array.from(new Set(queries.map((query) => normalizeQuery(query)).filter(Boolean)));
}

function inferBusinessArchetype(input: CompetitorQueryComposerInput): BusinessArchetype {
  const corpus = `${input.brandName} ${input.niche} ${input.businessOverview} ${input.audienceSummary}`.toLowerCase();
  const has = (re: RegExp) => re.test(corpus);

  if (has(/\b(agency|consulting|consultant|done[- ]for[- ]you|dfy)\b/)) return 'agency';
  if (has(/\b(ecom|ecommerce|shopify|store|d2c|product brand)\b/)) return 'ecommerce';
  if (
    has(/\b(saas|software|b2b software)\b/) ||
    (has(/\bplatform\b/) && has(/\b(tool|automation|software|api|workflow)\b/)) ||
    (has(/\bapp\b/) && has(/\b(subscription|pricing|trial|users)\b/))
  ) {
    return 'saas';
  }
  if (
    has(/\b(automotive|manufacturer|vehicle|consumer brand|enterprise brand|industrial|public company)\b/) ||
    (has(/\b(product)\b/) && has(/\b(category leader|market leader|enterprise)\b/))
  ) {
    return 'enterprise_brand';
  }
  if (has(/\b(personal brand|coach|mentor|speaker|thought leader)\b/)) return 'personal_brand';
  if (has(/\b(creator|influencer|content creator|ugc)\b/)) return 'creator';
  if (has(/\b(nonprofit|charity|foundation|mission-driven)\b/)) return 'nonprofit';
  if (has(/\b(course|academy|training|education|cohort|bootcamp)\b/)) return 'education';
  if (has(/\b(local|city|clinic|restaurant|salon|studio|near me)\b/)) return 'local_business';
  return 'general';
}

function computeNegativeTerms(
  input: CompetitorQueryComposerInput,
  archetype: BusinessArchetype
): string[] {
  const corpus = `${input.niche} ${input.businessOverview} ${input.audienceSummary}`.toLowerCase();
  const allowed = new Set<string>();

  if (/\b(news|media|journalism)\b/.test(corpus)) allowed.add('news');
  if (/\b(meme|humor|comedy)\b/.test(corpus)) allowed.add('meme');
  if (/\b(coupon|discount|deal)\b/.test(corpus)) {
    allowed.add('coupon');
    allowed.add('deal');
    allowed.add('deals');
    allowed.add('discount');
  }

  const base = NEGATIVE_TERMS_BASE.filter((term) => !allowed.has(term));
  const domainSpecific: string[] = [];
  const financeHeavyBusiness = /\b(finance|financial|investment|investor|trading|broker|stocks?)\b/.test(
    corpus
  );

  if (archetype === 'enterprise_brand' && !financeHeavyBusiness) {
    domainSpecific.push(
      'stock',
      'stocks',
      'share price',
      'earnings',
      'investor',
      'rumor',
      'owner club',
      'fan club',
      'review channel',
      'news'
    );
  }
  if (archetype === 'saas') {
    domainSpecific.push('job board', 'template download');
  }
  if (archetype === 'ecommerce') {
    domainSpecific.push('coupon code', 'deal alert');
  }
  const extra = Array.from(
    new Set(
      (input.extraNegativeTerms || [])
        .map((term) => String(term || '').trim().toLowerCase())
        .filter((term) => term.length >= 3)
    )
  );
  return Array.from(new Set([...base, ...domainSpecific, ...extra]));
}

function buildSurfaceQueries(
  surface: CompetitorSurface,
  brandName: string,
  businessAnchor: string,
  audienceAnchor: string,
  archetype: BusinessArchetype,
  negatives: string[],
  precision: DiscoveryPrecision
): string[] {
  const negativeClause = toNegativeClause(negatives);
  const strictPrefix = precision === 'high' ? '"similar account"' : '"related brands"';
  const archetypeTerms = ARCHETYPE_KEYWORDS[archetype].slice(0, 2).join('" OR "');
  const archetypeClause = `"${archetypeTerms}"`;
  const top = `${strictPrefix} "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`.trim();
  const enterpriseQueryAnchor =
    archetype === 'enterprise_brand'
      ? `"${businessAnchor}" competitors alternatives manufacturer ${negativeClause}`
      : null;

  switch (surface) {
    case 'instagram':
      return dedupeQueries([
        `site:instagram.com ${top}`,
        `site:instagram.com "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`,
        `site:instagram.com "${brandName}" competitors "${audienceAnchor}" ${negativeClause}`,
        ...(enterpriseQueryAnchor ? [`site:instagram.com ${enterpriseQueryAnchor}`] : []),
      ]);

    case 'tiktok':
      return dedupeQueries([
        `site:tiktok.com ${top}`,
        `site:tiktok.com "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`,
        `site:tiktok.com "${brandName}" competitors ${archetypeClause} ${negativeClause}`,
        ...(enterpriseQueryAnchor ? [`site:tiktok.com ${enterpriseQueryAnchor}`] : []),
      ]);

    case 'youtube':
      return dedupeQueries([
        `site:youtube.com "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} channel ${negativeClause}`,
        `site:youtube.com "${brandName}" alternatives ${archetypeClause} ${negativeClause}`,
      ]);

    case 'linkedin':
      return dedupeQueries([
        `site:linkedin.com/company "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`,
        `site:linkedin.com/company "${brandName}" competitors ${archetypeClause} ${negativeClause}`,
        `site:linkedin.com/in "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`,
      ]);

    case 'x':
      return dedupeQueries([
        `site:x.com "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`,
        `site:twitter.com "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`,
      ]);

    case 'facebook':
      return dedupeQueries([
        `site:facebook.com "${businessAnchor}" "${audienceAnchor}" ${archetypeClause} ${negativeClause}`,
      ]);

    case 'website':
      return dedupeQueries([
        `"${businessAnchor}" "${audienceAnchor}" competitors alternatives ${negativeClause}`,
        `"${brandName}" competitors alternatives ${archetypeClause} ${negativeClause}`,
        `best ${ARCHETYPE_KEYWORDS[archetype][0]} for "${audienceAnchor}" ${negativeClause}`,
        ...(archetype === 'enterprise_brand'
          ? [
              `"${brandName}" direct competitors in ${businessAnchor} category ${negativeClause}`,
              `"${businessAnchor}" category leaders alternatives ${negativeClause}`,
            ]
          : []),
      ]);

    default:
      return [];
  }
}

function compactAnchor(value: string, maxTokens: number): string {
  return String(value || '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, maxTokens)
    .join(' ');
}

export function buildPointyCompetitorQueryPlan(
  input: CompetitorQueryComposerInput
): CompetitorQueryPlan {
  const brandName = sanitizeBrandName(input.brandName);
  const niche = sanitizeContextField(input.niche);
  const businessOverview = sanitizeContextField(input.businessOverview);
  const audienceSummary = sanitizeContextField(input.audienceSummary);
  const sanitizedInput: CompetitorQueryComposerInput = {
    ...input,
    brandName,
    niche,
    businessOverview,
    audienceSummary,
  };
  const businessType = inferBusinessArchetype(sanitizedInput);
  const negatives = computeNegativeTerms(sanitizedInput, businessType);

  const businessKeywords = topKeywords(
    [brandName, niche, businessOverview],
    6
  );
  const audienceKeywords = topKeywords(
    [audienceSummary, niche, businessOverview],
    4
  );

  const nicheCorpus = `${brandName} ${niche} ${businessOverview} ${audienceSummary}`.toLowerCase();
  const businessHints: string[] = [];
  const audienceHints: string[] = [];
  if (/\b(islam|islamic|muslim|ummah|halal)\b/.test(nicheCorpus)) {
    businessHints.push('muslim', 'entrepreneur', 'halal');
    audienceHints.push('muslim', 'founders', 'faith');
  }
  if (/\b(agency|consulting|consultant|growth)\b/.test(nicheCorpus)) {
    businessHints.push('agency', 'consulting', 'growth');
    audienceHints.push('founders', 'services');
  }
  if (/\b(ecommerce|store|shopify|d2c)\b/.test(nicheCorpus)) {
    businessHints.push('ecommerce', 'd2c', 'brand');
    audienceHints.push('store', 'owners');
  }

  const businessAnchor = compactAnchor(
    [...businessHints, ...businessKeywords].slice(0, 6).join(' ') || niche || brandName || 'business',
    4
  );
  const audienceAnchor = compactAnchor(
    [...audienceHints, ...audienceKeywords].slice(0, 5).join(' ') || niche || 'audience',
    3
  );

  const perSurface = {
    instagram: [] as string[],
    tiktok: [] as string[],
    youtube: [] as string[],
    linkedin: [] as string[],
    x: [] as string[],
    facebook: [] as string[],
    website: [] as string[],
  };

  for (const surface of input.platformMatrix.selected) {
    perSurface[surface] = buildSurfaceQueries(
      surface,
      brandName,
      businessAnchor,
      audienceAnchor,
      businessType,
      negatives,
      input.precision
    );
  }

  return {
    precision: input.precision,
    negatives,
    perSurface,
    businessKeywords,
    audienceKeywords,
    businessType,
  };
}
