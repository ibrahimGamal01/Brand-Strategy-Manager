/**
 * User-Supplied Context Extractor
 *
 * Detects factual data the user is providing in a chat message
 * via pure regex + pattern matching - NO LLM call, always fast.
 *
 * Returns extracted items ready to be saved via upsertUserContext.
 */

import type { UscCategory } from './user-context-repository';

export interface ExtractedContextItem {
  category: UscCategory;
  key: string;
  value: string;
  label: string;
  confidence: 'high' | 'medium';
}

// Patterns that signal intent to provide a website or URL
const WEBSITE_INTENT_RE =
  /(?:my\s+(?:website|site|url|link|domain|store)\s+(?:is|:|=)?|add\s+(?:this\s+)?(?:website|url|site|domain|link)?|here(?:'s|\s+is)\s+(?:my\s+)?(?:website|url|site)?|also\s+(?:have|at))\s*(https?:\/\/[^\s,]+)/gi;

// Bare URLs (with no intent signal) - lower confidence
const BARE_URL_RE = /\b(https?:\/\/[^\s,'")\]]+)/gi;

// Social handle patterns with explicit intent
const HANDLE_INTENT_RE =
  /(?:my|our|the\s+brand(?:'s)?)\s+(?:(?:tiktok|instagram|twitter|x|linkedin|youtube|facebook)\s+)?(?:handle|account|profile)\s+(?:is|:)?\s*@?([a-z0-9._]{2,30})/gi;

// Bare @handle mentions - only if a platform name is near
const PLATFORM_HANDLE_RE =
  /\b(tiktok|instagram|twitter|linkedin|youtube|facebook|x)\b.{0,30}@([a-z0-9._]{2,30})/gi;

// Corrections: "actually", "the correct ...", "please update", "it should be"
const CORRECTION_RE =
  /(?:actually|correct(?:ly)?|please\s+update|it\s+should\s+be|fix(?:ing)?|change\s+it\s+to)[,:.]?\s+(.{5,200})/gi;

// Free text notes
const NOTE_RE =
  /(?:note:|fyi:|important:|remember:|keep\s+in\s+mind:)\s+(.{5,300})/gi;

function dedupe(items: ExtractedContextItem[]): ExtractedContextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.category}:${item.key}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyUrl(url: string): { category: UscCategory; key: string; label: string } {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/\.(pdf|doc|docx|txt|md)$/.test(url)) {
      return { category: 'document_url', key: host, label: `Document: ${host}` };
    }
    return { category: 'website', key: host, label: `Website: ${host}` };
  } catch {
    return { category: 'website', key: url, label: `Website: ${url}` };
  }
}

function classifyPlatform(platformRaw: string): string {
  const p = platformRaw.toLowerCase();
  if (p === 'x') return 'twitter';
  return p;
}

/**
 * Extract user-supplied context items from a chat message.
 * Returns an empty array if nothing relevant is found.
 */
export function extractUserContext(message: string): ExtractedContextItem[] {
  const results: ExtractedContextItem[] = [];

  // --- High-confidence URLs with intent signal ---
  let match: RegExpExecArray | null;
  WEBSITE_INTENT_RE.lastIndex = 0;
  while ((match = WEBSITE_INTENT_RE.exec(message)) !== null) {
    const url = match[1].replace(/[.,;!?)]+$/, '');
    const meta = classifyUrl(url);
    results.push({ ...meta, value: url, confidence: 'high' });
  }

  // --- Bare URLs (medium confidence) ---
  const intentUrls = new Set(results.map((r) => r.value));
  BARE_URL_RE.lastIndex = 0;
  while ((match = BARE_URL_RE.exec(message)) !== null) {
    const url = match[1].replace(/[.,;!?)]+$/, '');
    if (!intentUrls.has(url)) {
      const meta = classifyUrl(url);
      results.push({ ...meta, value: url, confidence: 'medium' });
    }
  }

  // --- Social handles with intent signal ---
  HANDLE_INTENT_RE.lastIndex = 0;
  while ((match = HANDLE_INTENT_RE.exec(message)) !== null) {
    const handle = match[1].replace(/^@/, '');
    results.push({
      category: 'social_profile',
      key: handle,
      value: `@${handle}`,
      label: `Handle: @${handle}`,
      confidence: 'high',
    });
  }

  // --- Platform + handle pairs ---
  PLATFORM_HANDLE_RE.lastIndex = 0;
  while ((match = PLATFORM_HANDLE_RE.exec(message)) !== null) {
    const platform = classifyPlatform(match[1]);
    const handle = match[2].replace(/^@/, '');
    results.push({
      category: 'social_profile',
      key: `${platform}_${handle}`,
      value: `@${handle}`,
      label: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Handle: @${handle}`,
      confidence: 'high',
    });
  }

  // --- Corrections ---
  CORRECTION_RE.lastIndex = 0;
  while ((match = CORRECTION_RE.exec(message)) !== null) {
    const text = match[1].trim().slice(0, 200);
    results.push({
      category: 'correction',
      key: `correction_${text.slice(0, 20).replace(/\s+/g, '_')}`,
      value: text,
      label: `Correction: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
      confidence: 'medium',
    });
  }

  // --- Explicit notes ---
  NOTE_RE.lastIndex = 0;
  while ((match = NOTE_RE.exec(message)) !== null) {
    const text = match[1].trim().slice(0, 300);
    results.push({
      category: 'free_text',
      key: `note_${text.slice(0, 20).replace(/\s+/g, '_')}`,
      value: text,
      label: `Note: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
      confidence: 'high',
    });
  }

  return dedupe(results);
}
