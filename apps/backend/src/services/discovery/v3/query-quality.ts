export type QuerySanitizerMode = 'balanced' | 'strict';

type SanitizeKeywordInput = {
  rawKeywords: string[];
  brandTokens?: string[];
  nicheTokens?: string[];
  mode?: QuerySanitizerMode;
  maxItems?: number;
};

type QueryAcceptableOptions = {
  mode?: QuerySanitizerMode;
  minLength?: number;
  maxLength?: number;
};

const CONNECTIVE_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const BAD_QUERY_TOKENS = new Set([
  'best',
  'top',
  'free',
  'pass',
  'official',
  'company',
  'companies',
  'brand',
  'brands',
  'services',
  'service',
  'program',
  'programs',
  'platform',
  'platforms',
  'tool',
  'tools',
  'site',
  'website',
  'app',
]);

const NAVIGATION_TOKENS = new Set([
  'about',
  'account',
  'checkout',
  'contact',
  'dashboard',
  'event',
  'events',
  'faq',
  'help',
  'home',
  'login',
  'media',
  'policy',
  'press',
  'pricing',
  'refund',
  'register',
  'schedule',
  'speaker',
  'speakers',
  'support',
  'terms',
  'ticket',
  'tickets',
  'volunteer',
]);

function normalizeSpaces(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function toTokenSet(values: string[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) {
    for (const raw of String(value || '').toLowerCase().split(/[^a-z0-9]+/g)) {
      const token = raw.trim();
      if (!token) continue;
      out.add(token);
    }
  }
  return out;
}

function uniqueStrings(values: string[], maxItems: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSpaces(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function compactQueryString(value: string): string {
  return normalizeSpaces(value)
    .replace(/[|/]{2,}/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[“”"'`]+/g, '')
    .trim();
}

export function resolveQuerySanitizerMode(raw?: string | null): QuerySanitizerMode {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  if (normalized === 'strict') return 'strict';
  return 'balanced';
}

export function isBadQueryToken(token: string): boolean {
  const normalized = normalizeToken(token);
  if (!normalized) return true;
  if (BAD_QUERY_TOKENS.has(normalized)) return true;
  if (NAVIGATION_TOKENS.has(normalized)) return true;
  return false;
}

export function sanitizeAudienceHints(rawAudience: string[]): string[] {
  const parts = rawAudience.flatMap((value) =>
    String(value || '')
      .split(/[|/;\n]+/g)
      .map((entry) => normalizeSpaces(entry))
      .filter(Boolean)
  );

  const sanitized = parts
    .map((entry) => entry.replace(/\b(who|that|which)\b.*$/i, '').trim())
    .map((entry) => compactQueryString(entry))
    .filter((entry) => !/https?:\/\//i.test(entry))
    .filter((entry) => !/\b(looking for|want to|wants to|how to)\b/i.test(entry))
    .filter((entry) => entry.length >= 4 && entry.length <= 40)
    .filter((entry) => entry.split(/\s+/).length <= 4)
    .map((entry) => entry.toLowerCase());

  return uniqueStrings(sanitized, 12);
}

export function sanitizeKeywordList(input: SanitizeKeywordInput): string[] {
  const mode = input.mode || 'balanced';
  const maxItems = Number.isFinite(Number(input.maxItems)) ? Math.max(1, Math.floor(Number(input.maxItems))) : 24;
  const brandTokenSet = toTokenSet(input.brandTokens || []);
  const nicheTokenSet = toTokenSet(input.nicheTokens || []);
  const phraseWordLimit = mode === 'strict' ? 4 : 6;

  const cleaned = (input.rawKeywords || [])
    .map((entry) => compactQueryString(String(entry || '').toLowerCase()))
    .filter(Boolean)
    .filter((entry) => !/https?:\/\//i.test(entry))
    .filter((entry) => entry.length >= 3 && entry.length <= 54)
    .filter((entry) => entry.split(/\s+/).length <= phraseWordLimit)
    .map((entry) => {
      const words = entry
        .split(/\s+/)
        .map((word) => word.trim())
        .filter(Boolean)
        .map((word) => normalizeToken(word))
        .filter(Boolean)
        .filter((word) => !CONNECTIVE_WORDS.has(word))
        .filter((word) => !isBadQueryToken(word));
      return words.join(' ').trim();
    })
    .filter(Boolean)
    .filter((entry) => entry.length >= 3)
    .filter((entry) => {
      const words = entry.split(/\s+/).filter(Boolean);
      if (!words.length) return false;
      const hasNicheSignal = words.some((word) => nicheTokenSet.has(word));
      const hasBrandToken = words.some((word) => brandTokenSet.has(word));
      if (hasBrandToken && !hasNicheSignal) return false;
      const navOnly = words.every((word) => NAVIGATION_TOKENS.has(word));
      if (navOnly) return false;
      const lowInfoOnly = words.every((word) => word.length < 4);
      if (lowInfoOnly) return false;
      return true;
    });

  return uniqueStrings(cleaned, maxItems);
}

export function isAcceptableQuery(query: string, opts: QueryAcceptableOptions = {}): boolean {
  const mode = opts.mode || 'balanced';
  const minLength = Number.isFinite(Number(opts.minLength)) ? Math.max(8, Math.floor(Number(opts.minLength))) : 16;
  const maxLength = Number.isFinite(Number(opts.maxLength)) ? Math.max(minLength, Math.floor(Number(opts.maxLength))) : 100;
  const normalized = compactQueryString(query);
  if (!normalized) return false;
  if (normalized.length < minLength || normalized.length > maxLength) return false;
  if (/https?:\/\//i.test(normalized)) return false;
  if ((normalized.match(/[|/]/g) || []).length > 2) return false;
  if (/\b(best|top)\s+(free|pass)\b/i.test(normalized)) return false;
  if (/\bfree\s+for\b/i.test(normalized)) return false;
  if (/\bwho\s+want\b|\blooking\s+for\b|\bwants?\s+to\b/i.test(normalized)) return false;
  if (/[,;].*[,;]/.test(normalized)) return false;

  const words = normalized
    .toLowerCase()
    .split(/\s+/)
    .map((word) => normalizeToken(word))
    .filter(Boolean);
  if (!words.length) return false;
  if (words.length > (mode === 'strict' ? 12 : 14)) return false;
  const badTokenRatio =
    words.length > 0 ? words.filter((word) => isBadQueryToken(word) || CONNECTIVE_WORDS.has(word)).length / words.length : 1;
  if (badTokenRatio > (mode === 'strict' ? 0.35 : 0.5)) return false;

  return true;
}
