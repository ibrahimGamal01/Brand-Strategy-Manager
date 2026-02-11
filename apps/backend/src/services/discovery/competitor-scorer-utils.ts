import { ResolvedCandidate } from './competitor-resolver';
import { WebsitePolicy } from './competitor-policy-engine';

export const SCORE_WEIGHTS = {
  offerOverlap: 30,
  audienceOverlap: 25,
  nicheSemanticMatch: 20,
  activityRecency: 10,
  sizeSimilarity: 10,
  sourceConfidence: 5,
} as const;

const GENERIC_HANDLE_BLOCKLIST = new Set([
  'google',
  'nike',
  'ibm',
  'netflix',
  'youtube',
  'linkedin',
  'facebook',
  'twitter',
  'x',
  'entrepreneur',
  'creators',
  'business',
  'marketing',
  'startup',
  'viral',
  'quotes',
  'motivation',
  'news',
]);

const LOW_SIGNAL_HANDLE_RE =
  /(coupon|deal|deals|giveaway|fan(page|account)?|meme|quotes|viral|clip|news|hunter|spam|freebies?|promo|discount|crypto|bitcoin|forex|airdrops?|lottery|casino)/i;

const SCORING_STOPWORDS = new Set([
  'followers',
  'following',
  'posts',
  'likes',
  'views',
  'comment',
  'comments',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'twitter',
  'facebook',
  'profile',
  'official',
  'community',
  'business',
  'brand',
  'company',
]);

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function toTokenSet(values: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const token of String(value || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4)) {
      tokens.add(token);
    }
  }
  return tokens;
}

export function toScoringTokens(value: string): Set<string> {
  return new Set(
    String(value || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !SCORING_STOPWORDS.has(token))
  );
}

export function overlapScore(target: Set<string>, candidateTokens: Set<string>): number {
  if (target.size === 0) return 0.4;
  const matches = Array.from(target.values()).filter((token) => candidateTokens.has(token)).length;
  const base = Math.max(2, Math.min(10, target.size));
  return clamp01(matches / base);
}

export function hasCorroboration(candidate: ResolvedCandidate, websitePolicy: WebsitePolicy): boolean {
  const sourceCount = candidate.sources.length;
  const urlEvidenceCount = candidate.evidence.filter((row) => Boolean(row.url)).length;

  if (candidate.platform === 'website') {
    const minSources = websitePolicy === 'peer_candidate' ? 2 : 2;
    const minUrlEvidence = websitePolicy === 'peer_candidate' ? 2 : 1;
    return sourceCount >= minSources && urlEvidenceCount >= minUrlEvidence;
  }

  const hasUrlEvidence = urlEvidenceCount > 0;
  if (sourceCount >= 2) return true;
  return hasUrlEvidence && candidate.resolverConfidence >= 0.45;
}

export function isBlockedHandle(normalizedHandle: string): boolean {
  const handle = String(normalizedHandle || '').trim().toLowerCase();
  if (!handle) return true;
  if (handle.length < 3) return true;
  if (GENERIC_HANDLE_BLOCKLIST.has(handle)) return true;
  if (LOW_SIGNAL_HANDLE_RE.test(handle)) return true;
  if (/^\d{5,}$/.test(handle)) return true;
  if (/^[0-9._-]+$/.test(handle)) return true;
  if (/^\d+[a-z]?$/i.test(handle)) return true;
  if (handle.split('.').length > 3) return true;
  return false;
}
