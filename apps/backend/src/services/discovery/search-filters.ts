/**
 * Search Filters - Pattern-based noise detection
 * 
 * No AI - purely algorithmic filtering for search results
 */

export interface NoisePattern {
  pattern: RegExp;
  reason: string;
  severity: 'spam' | 'low_quality' | 'irrelevant';
}

// No hardcoded filtering patterns
// Filtering is based purely on:
// 1. Brand mention requirement (must mention brand)
// 2. Niche keyword matching (optional, for scoring)
export const NOISE_PATTERNS: NoisePattern[] = [];

/**
 * Detect if content is noise/spam
 */
export function detectNoise(title: string, snippet: string, url: string): {
  isNoise: boolean;
  reason: string;
  severity: string;
} {
  const text = `${title} ${snippet} ${url}`.toLowerCase();
  
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.pattern.test(text)) {
      return {
        isNoise: true,
        reason: pattern.reason,
        severity: pattern.severity,
      };
    }
  }
  
  return { isNoise: false, reason: '', severity: '' };
}

/**
 * Check if result mentions the brand (STRICT requirement)
 * 
 * @param text - Combined title + snippet
 * @param brandTerms - Array of brand variations: [brandName, handle, domain, etc.]
 * @returns true if ANY brand term is mentioned
 */
export function mentionsBrand(text: string, brandTerms: string[]): boolean {
  const lowerText = text.toLowerCase();
  
  return brandTerms.some(term => {
    const cleanTerm = term.toLowerCase().replace('@', '').trim();
    if (cleanTerm.length < 2) return false;
    
    // Check for whole word match (avoid partial matches like "um" in "ummah")
    const regex = new RegExp(`\\b${cleanTerm}\\b`, 'i');
    return regex.test(lowerText);
  });
}

/**
 * Check if result is relevant to niche
 */
export function mentionsNiche(text: string, nicheTerms: string[]): boolean {
  const lowerText = text.toLowerCase();
  
  return nicheTerms.some(term => {
    const cleanTerm = term.toLowerCase().trim();
    if (cleanTerm.length < 3) return false; // Skip very short terms
    
    return lowerText.includes(cleanTerm);
  });
}

/**
 * Calculate relevance score based on keyword matches
 * 
 * @returns Score 0-1 where higher = more relevant
 */
export function calculateRelevanceScore(
  result: { title: string; snippet: string; url: string },
  keywords: {
    brand: string[]; // Required: brand name, handle, variations
    niche: string[]; // Niche keywords
  }
): number {
  let score = 0;
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const url = result.url.toLowerCase();
  
  // Brand mentions (HIGH value - 0.5 points)
  const brandMentions = keywords.brand.filter(term =>
    text.includes(term.toLowerCase().replace('@', ''))
  ).length;
  score += Math.min(brandMentions * 0.25, 0.5);
  
  // Niche keywords (MEDIUM value - 0.3 points total)
  const nicheMentions = keywords.niche.filter(term =>
    term.length > 2 && text.includes(term.toLowerCase())
  ).length;
  score += Math.min(nicheMentions * 0.1, 0.3);
  
  // Quality source bonus (0.2 points)
  if (url.includes('reddit.com/r/')) score += 0.15;
  else if (url.includes('medium.com')) score += 0.1;
  else if (url.includes('linkedin.com')) score += 0.1;
  else if (url.includes('quora.com')) score += 0.05;
  
  // Recency bonus (0.05 points)
  if (/2024|2025|2026/i.test(result.title)) {
    score += 0.05;
  }
  
  return Math.min(score, 1.0);
}

/**
 * Categorize search result
 */
export enum ResultCategory {
  BRAND_MENTION = 'brand_mention',
  COMPETITOR = 'competitor',
  PAIN_POINT = 'pain_point',
  SOCIAL_MEDIA = 'social_media',
  NEWS = 'news',
  COMMUNITY = 'community',
  NICHE_CONTEXT = 'niche_context', // 1-2 results about niche only
  NOISE = 'noise',
}

export function categorizeResult(
  result: { title: string; snippet: string; url: string },
  brandTerms: string[],
  nicheTerms: string[]
): ResultCategory {
  const text = (result.title + result.snippet).toLowerCase();
  const url = result.url.toLowerCase();
  
  // Check for noise first
  const noiseCheck = detectNoise(result.title, result.snippet, result.url);
  if (noiseCheck.isNoise) {
    return ResultCategory.NOISE;
  }
  
  // Check brand mention
  const hasBrand = mentionsBrand(text, brandTerms);
  const hasNiche = mentionsNiche(text, nicheTerms);
  
  // If no brand mention and has niche, mark as niche context (limit to 1-2)
  if (!hasBrand && hasNiche) {
    return ResultCategory.NICHE_CONTEXT;
  }
  
  // If no brand and no niche, it's noise
  if (!hasBrand && !hasNiche) {
    return ResultCategory.NOISE;
  }
  
  // Categorize brand-mentioning results
  if (url.includes('reddit.com') || url.includes('quora.com')) {
    return ResultCategory.COMMUNITY;
  }
  
  if (url.includes('instagram.com') || url.includes('tiktok.com') || url.includes('twitter.com')) {
    return ResultCategory.SOCIAL_MEDIA;
  }
  
  if (/frustrated|annoyed|hate|problem|issue|complaint|sucks|terrible/i.test(text)) {
    return ResultCategory.PAIN_POINT;
  }
  
  if (/competitor|alternative|vs\.|versus|compared to|better than/i.test(text)) {
    return ResultCategory.COMPETITOR;
  }
  
  if (/news|announces|launches|reports|press release/i.test(text)) {
    return ResultCategory.NEWS;
  }
  
  return ResultCategory.BRAND_MENTION;
}

/**
 * Filter and score search results
 * 
 * STRICT RULES:
 * - All results must mention brand EXCEPT 1-2 niche-only for context
 * - Noise is filtered out
 * - Results are scored for relevance
 */
export function filterAndScoreResults(
  results: Array<{ title: string; snippet: string; url: string; query: string }>,
  config: {
    brandTerms: string[]; // [brandName, handle, domain, etc.]
    nicheTerms: string[]; // Keywords for the niche
    maxNicheOnly: number; // Max niche-only results (default 2)
  }
): Array<{
  title: string;
  snippet: string;
  url: string;
  query: string;
  relevanceScore: number;
  category: ResultCategory;
  isNoise: boolean;
  filterReason?: string;
}> {
  const maxNicheOnly = config.maxNicheOnly || 2;
  let nicheOnlyCount = 0;
  
  return results.map(result => {
    const text = `${result.title} ${result.snippet}`;
    
    // Check noise
    const noiseCheck = detectNoise(result.title, result.snippet, result.url);
    
    // Check brand mention
    const hasBrand = mentionsBrand(text, config.brandTerms);
    
    // Categorize
    const category = categorizeResult(result, config.brandTerms, config.nicheTerms);
    
    // Calculate score
    const relevanceScore = calculateRelevanceScore(result, {
      brand: config.brandTerms,
      niche: config.nicheTerms,
    });
    
    // Determine if should be filtered
    let isNoise = noiseCheck.isNoise;
    let filterReason = noiseCheck.reason;
    
    // STRICT: If no brand mention and not niche context, mark as noise
    if (!hasBrand && category !== ResultCategory.NICHE_CONTEXT) {
      isNoise = true;
      filterReason = 'No brand mention';
    }
    
    // Limit niche-only results
    if (category === ResultCategory.NICHE_CONTEXT) {
      if (nicheOnlyCount >= maxNicheOnly) {
        isNoise = true;
        filterReason = `Exceeded max niche-only results (${maxNicheOnly})`;
      } else {
        nicheOnlyCount++;
      }
    }
    
    return {
      ...result,
      relevanceScore,
      category,
      isNoise,
      filterReason,
    };
  });
}
