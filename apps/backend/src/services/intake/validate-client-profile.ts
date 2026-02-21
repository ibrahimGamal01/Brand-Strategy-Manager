/**
 * Validate whether a suggested social profile is likely the client's (bio/website/name match).
 * Used by the suggestion layer to show "Likely your account" or "Please confirm."
 */

import { searchBrandContextDDG } from '../discovery/duckduckgo-search.js';

function extractDomain(website: string): string {
  const s = String(website || '').trim();
  if (!s) return '';
  try {
    const url = s.startsWith('http') ? s : `https://${s}`;
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '').toLowerCase();
  } catch {
    return s.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').toLowerCase() || '';
  }
}

function normalizeForMatch(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[@\s_\-]+/g, ' ')
    .trim();
}

export interface ValidateSuggestedProfileResult {
  isLikelyClient: boolean;
  confidence: number;
  reason: string;
}

/**
 * Check if the given profile (handle) is likely the client's by comparing profile context to client website/name.
 */
export async function validateSuggestedProfileIsClient(params: {
  handle: string;
  platform: 'instagram' | 'tiktok';
  clientWebsite?: string;
  clientName?: string;
}): Promise<ValidateSuggestedProfileResult> {
  const { handle, platform, clientWebsite, clientName } = params;
  const cleanHandle = String(handle || '').trim().replace(/^@+/, '');
  if (!cleanHandle) {
    return { isLikelyClient: false, confidence: 0, reason: 'Invalid handle' };
  }

  const clientDomain = clientWebsite ? extractDomain(clientWebsite) : '';
  const clientNameNorm = clientName ? normalizeForMatch(clientName) : '';

  try {
    const searchResult = await searchBrandContextDDG(cleanHandle, undefined, { timeoutMs: 15_000 });
    const raw = searchResult.raw_results || [];
    const combinedText = raw.map((r) => `${r.title || ''} ${r.body || ''} ${r.href || ''}`).join(' ').toLowerCase();
    const combinedHrefs = raw.map((r) => (r.href || '').toLowerCase()).join(' ');

    let confidence = 0;
    const reasons: string[] = [];

    if (clientDomain) {
      if (combinedHrefs.includes(clientDomain) || combinedText.includes(clientDomain)) {
        confidence += 0.6;
        reasons.push(`Profile links to ${clientDomain}`);
      }
    }

    if (clientNameNorm) {
      const words = clientNameNorm.split(/\s+/).filter((w) => w.length > 2);
      const matchCount = words.filter((w) => combinedText.includes(w)).length;
      if (matchCount > 0) {
        confidence += Math.min(0.3, matchCount * 0.15);
        reasons.push(`Name overlap with "${clientName}"`);
      }
    }

    if (searchResult.context_summary && searchResult.context_summary.length > 10) {
      const summary = searchResult.context_summary.toLowerCase();
      if (clientDomain && summary.includes(clientDomain)) {
        confidence += 0.2;
        if (!reasons.some((r) => r.includes(clientDomain))) reasons.push(`Summary mentions ${clientDomain}`);
      }
    }

    confidence = Math.min(1, confidence);
    const isLikelyClient = confidence >= 0.5;
    const reason =
      reasons.length > 0
        ? reasons.join('. ')
        : 'No website or name match found – please confirm this is your profile.';

    return {
      isLikelyClient,
      confidence,
      reason,
    };
  } catch (error: any) {
    console.warn(`[ValidateClientProfile] Validation failed for @${cleanHandle}:`, error?.message);
    return {
      isLikelyClient: false,
      confidence: 0,
      reason: 'Could not verify – please confirm this is your profile.',
    };
  }
}
