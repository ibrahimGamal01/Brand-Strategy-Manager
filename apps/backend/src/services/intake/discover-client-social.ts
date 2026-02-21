/**
 * Discover client social handles from website (domain-first search).
 * Used by the suggestion layer when the user provides website but no Instagram/TikTok.
 * Never derives handles from brand name alone – only from search results.
 */

import { searchSocialHandlesForWebsite } from '../discovery/duckduckgo-search.js';

function extractDomain(website: string): string {
  const s = String(website || '').trim();
  if (!s) return '';
  try {
    const url = s.startsWith('http') ? s : `https://${s}`;
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return s.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '') || '';
  }
}

/**
 * Discover Instagram and/or TikTok handles for a business from its website.
 * Runs a domain-first search (e.g. "eluumis.com instagram") so we get the real account (e.g. @eluumis_official).
 * Does NOT suggest a handle by inferring from brand name (e.g. "ELUUMIS" → "eluumis").
 */
export async function discoverClientSocialFromWebsite(
  website: string,
  _brandName?: string
): Promise<{ instagram?: string; tiktok?: string }> {
  const domain = extractDomain(website);
  if (!domain) return {};

  const result = await searchSocialHandlesForWebsite(domain, { timeoutMs: 25_000 });
  return result;
}
