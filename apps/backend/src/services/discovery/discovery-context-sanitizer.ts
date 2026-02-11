export interface SanitizedDiscoveryContext {
  businessOverview: string;
  audienceSummary: string;
  niche: string;
  removedTokens: string[];
  placeholderMatches: string[];
  contextQualityScore: number;
}

const PLACEHOLDER_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'temp', pattern: /\btemp(?:orary)?\b/i },
  { label: 'seed', pattern: /\bseed(?:ed)?\b/i },
  { label: 'smoke_test', pattern: /\bsmoke\s*test\b/i },
  { label: 'dummy', pattern: /\bdummy\b/i },
  { label: 'placeholder', pattern: /\bplaceholder\b/i },
  { label: 'lorem', pattern: /\blorem\s+ipsum\b/i },
  { label: 'test_data', pattern: /\btest\s*data\b/i },
  { label: 'sample', pattern: /\bsample\b/i },
  { label: 'fake', pattern: /\bfake\b/i },
  { label: 'todo', pattern: /\btodo\b/i },
  { label: 'n_a', pattern: /\bn\/?a\b/i },
];

const LOW_SIGNAL_STOPWORDS = new Set([
  'temp',
  'seed',
  'dummy',
  'placeholder',
  'smoke',
  'test',
  'sample',
  'business',
  'brand',
  'company',
  'overview',
  'description',
  'profile',
]);

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function isLikelyPlaceholderDiscoveryContext(value: string | null | undefined): boolean {
  const text = normalizeWhitespace(String(value || ''));
  if (!text) return false;

  const lowered = text.toLowerCase();
  const matched = PLACEHOLDER_PATTERNS.filter(({ pattern }) => pattern.test(lowered)).length;
  if (matched >= 1 && tokenize(text).length <= 8) {
    return true;
  }

  if (/^(temp|dummy|placeholder|test|sample)(\s|$)/i.test(text)) {
    return true;
  }

  if (/(^|\s)(temp|seed|smoke|dummy)(\s|$)/i.test(text) && tokenize(text).length <= 12) {
    return true;
  }

  return false;
}

function sanitizeText(value: string): { sanitized: string; removedTokens: string[]; placeholderMatches: string[] } {
  const original = normalizeWhitespace(value);
  if (!original) {
    return { sanitized: '', removedTokens: [], placeholderMatches: [] };
  }

  const placeholderMatches = PLACEHOLDER_PATTERNS.filter(({ pattern }) => pattern.test(original)).map(
    ({ label }) => label
  );

  if (isLikelyPlaceholderDiscoveryContext(original)) {
    return {
      sanitized: '',
      removedTokens: Array.from(new Set(tokenize(original))),
      placeholderMatches,
    };
  }

  const tokens = tokenize(original);
  const kept = tokens.filter((token) => !LOW_SIGNAL_STOPWORDS.has(token));
  const removedTokens = tokens.filter((token) => LOW_SIGNAL_STOPWORDS.has(token));

  return {
    sanitized: normalizeWhitespace(kept.join(' ')),
    removedTokens: Array.from(new Set(removedTokens)),
    placeholderMatches,
  };
}

function scoreContextQuality(parts: Array<{ value: string; placeholderMatches: string[] }>): number {
  const fullText = parts.map((item) => item.value).filter(Boolean).join(' ');
  const tokenCount = tokenize(fullText).length;
  const placeholderHits = parts.reduce((sum, item) => sum + item.placeholderMatches.length, 0);

  if (tokenCount === 0) {
    return placeholderHits > 0 ? 0.1 : 0;
  }

  const tokenScore = Math.min(1, tokenCount / 24);
  const penalty = Math.min(0.8, placeholderHits * 0.25);
  return Math.max(0, Math.min(1, tokenScore - penalty));
}

export function sanitizeDiscoveryContext(input: {
  businessOverview?: string | null;
  audienceSummary?: string | null;
  niche?: string | null;
}): SanitizedDiscoveryContext {
  const business = sanitizeText(String(input.businessOverview || ''));
  const audience = sanitizeText(String(input.audienceSummary || ''));
  const niche = sanitizeText(String(input.niche || ''));

  const businessOverview = business.sanitized;
  const audienceSummary = audience.sanitized;
  const nicheValue = niche.sanitized;

  return {
    businessOverview,
    audienceSummary,
    niche: nicheValue,
    removedTokens: Array.from(new Set([...business.removedTokens, ...audience.removedTokens, ...niche.removedTokens])),
    placeholderMatches: Array.from(
      new Set([...business.placeholderMatches, ...audience.placeholderMatches, ...niche.placeholderMatches])
    ),
    contextQualityScore: scoreContextQuality([
      { value: businessOverview, placeholderMatches: business.placeholderMatches },
      { value: audienceSummary, placeholderMatches: audience.placeholderMatches },
      { value: nicheValue, placeholderMatches: niche.placeholderMatches },
    ]),
  };
}
