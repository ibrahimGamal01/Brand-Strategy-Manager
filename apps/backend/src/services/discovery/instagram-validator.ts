/**
 * Instagram Validator Service
 * 
 * Validates discovered Instagram handles to filter out:
 * - Non-existent accounts
 * - Inactive accounts (no recent posts)
 * - Irrelevant accounts (celebrities, unrelated niches)
 * - Invalid handles (yahoo.com, brand itself, etc.)
 */

import { searchBrandContextDDG, validateHandleDDG } from './duckduckgo-search.js';

export interface ValidationResult {
  handle: string;
  isValid: boolean;
  exists: boolean;
  isActive: boolean;
  isRelevant: boolean;
  followerEstimate: string;  // "10K-50K", "100K-500K", "unknown"
  niche: string | null;
  confidenceScore: number;  // 0-1
  reason: string;  // Explanation of validation result
  bio?: string;
}

/**
 * Validate if a handle is a proper Instagram username format
 */
function isValidHandleFormat(handle: string): boolean {
  // Instagram handles: 1-30 chars, letters, numbers, periods, underscores
  const handleRegex = /^[a-zA-Z0-9._]{1,30}$/;
  
  if (!handleRegex.test(handle)) return false;
  
  // Filter out common false positives
  const invalidHandles = [
    'instagram', 'explore', 'p', 'reel', 'reels', 'stories', 'tv',
    'accounts', 'account', 'login', 'signup', 'help', 'about',
    'competitors', 'competitor', 'similar', 'like', 'follow',
    'yahoo.com', 'google.com', 'facebook.com', '.com', 'www',
  ];
  
  if (invalidHandles.includes(handle.toLowerCase())) return false;
  
  // Filter handles that are obviously URLs or domains
  if (handle.includes('.com') || handle.includes('.org') || handle.includes('.net')) {
    return false;
  }
  
  return true;
}

/**
 * Check if handle is a mega-celebrity (irrelevant for most brand discovery)
 */
function isMegaCelebrity(handle: string): boolean {
  const celebrities = [
    'leomessi', 'cristiano', 'therock', 'kyliejenner', 'selenagomez',
    'arianagrande', 'beyonce', 'kimkardashian', 'justinbieber', 'taylorswift',
    'neymarjr', 'khloekardashian', 'kendalljenner', 'jlo', 'nickiminaj',
    'mileycyrus', 'katyperry', 'kevinhart4real', 'theellenshow', 'ddlovato',
    'badgalriri', 'zendaya', 'shakira', 'brunomars', 'champagnepapi'
  ];
  
  return celebrities.includes(handle.toLowerCase());
}

/**
 * Extract follower count estimate from search result text
 */
function extractFollowerEstimate(text: string): string {
  const lowerText = text.toLowerCase();
  
  // Look for patterns like "500K followers", "1.2M followers", etc.
  const patterns = [
    /(\d+\.?\d*)\s*m(?:illion)?\s+followers/i,
    /(\d+\.?\d*)\s*k\s+followers/i,
    /followers.*?(\d+\.?\d*)\s*m/i,
    /followers.*?(\d+\.?\d*)\s*k/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseFloat(match[1]);
      if (lowerText.includes('m')) {
        if (num < 0.1) return '10K-100K';
        if (num < 0.5) return '100K-500K';
        if (num < 1) return '500K-1M';
        if (num < 5) return '1M-5M';
        return '5M+';
      } else {
        if (num < 10) return '1K-10K';
        if (num < 50) return '10K-50K';
        if (num < 100) return '50K-100K';
        return '100K-500K';
      }
    }
  }
  
  return 'unknown';
}

/**
 * Check if account appears active based on search results
 */
function isActiveFromSearchResults(results: string[]): boolean {
  const combinedText = results.join(' ').toLowerCase();
  
  // Look for recent activity indicators
  const activeIndicators = [
    'hours ago', 'day ago', 'days ago', 'week ago', 'weeks ago',
    '2024', '2025', '2026', 'recent', 'latest', 'new post',
  ];
  
  const inactiveIndicators = [
    'no longer active', 'inactive', 'deleted', 'suspended', 
    'account not found', 'page not found',
  ];
  
  const hasActiveSignals = activeIndicators.some(term => combinedText.includes(term));
  const hasInactiveSignals = inactiveIndicators.some(term => combinedText.includes(term));
  
  if (hasInactiveSignals) return false;
  if (hasActiveSignals) return true;
  
  // If no clear signals, assume active (benefit of doubt)
  return true;
}

/**
 * Validate Instagram handle using search-based verification
 */
export async function validateInstagramHandle(
  handle: string,
  targetNiche: string,
  targetHandle?: string
): Promise<ValidationResult> {
  console.log(`[Validator] Validating @${handle} for niche: ${targetNiche}`);
  
  // Step 1: Format validation
  if (!isValidHandleFormat(handle)) {
    return {
      handle,
      isValid: false,
      exists: false,
      isActive: false,
      isRelevant: false,
      followerEstimate: 'unknown',
      niche: null,
      confidenceScore: 0,
      reason: 'Invalid handle format',
    };
  }
  
  // Step 2: Check if it's the target handle itself
  if (targetHandle && handle.toLowerCase() === targetHandle.toLowerCase()) {
    return {
      handle,
      isValid: false,
      exists: true,
      isActive: true,
      isRelevant: false,
      followerEstimate: 'unknown',
      niche: null,
      confidenceScore: 0,
      reason: 'Same as target brand',
    };
  }
  
  // Step 3: Filter mega-celebrities (usually irrelevant)
  if (isMegaCelebrity(handle)) {
    return {
      handle,
      isValid: false,
      exists: true,
      isActive: true,
      isRelevant: false,
      followerEstimate: '5M+',
      niche: 'celebrity',
      confidenceScore: 0.1,
      reason: 'Mega-celebrity - likely irrelevant',
    };
  }
  
  // Step 4: Use DDG search to validate existence and extract data
  try {
    const searchResult = await searchBrandContextDDG(handle);
    
    if (!searchResult.instagram_handle && !searchResult.context_summary) {
      return {
        handle,
        isValid: false,
        exists: false,
        isActive: false,
        isRelevant: false,
        followerEstimate: 'unknown',
        niche: null,
        confidenceScore: 0,
        reason: 'No Instagram presence found in search',
      };
    }
    
    const searchTexts = searchResult.raw_results?.map(r => `${r.title} ${r.body}`) || [];
    const combinedText = searchTexts.join(' ');
    
    // Extract metadata
    const followerEstimate = extractFollowerEstimate(combinedText);
    const isActive = isActiveFromSearchResults(searchTexts);
    
    // Check if niche is mentioned or related - EXTREMELY STRICT MATCHING
    const nicheWords = targetNiche.toLowerCase().split(' ').filter(w => w.length > 3);
    
    // For multi-word niches, require ALL words to appear (not just ANY)
    const hasNicheMatch = nicheWords.length > 0 && nicheWords.every(word => 
      combinedText.toLowerCase().includes(word)
    );
    
    // EXPANDED Blacklist - filter out irrelevant categories AGGRESSIVELY
    const blacklistedTerms = [
      // Government & Official
      'bank indonesia', 'government official', 'prime minister', 'president of',
      'ministry of', 'official account', 'government of', 'public service',
      
      // Generic Entrepreneurship (NOT Islamic-specific)
      'boss babe', 'bossbabe', 'girl boss', 'girlboss', 'lady boss',
      'mompreneur', 'wife boss', 'side hustle', 'hustle culture',
      'generic business', 'business tips', 'entrepreneur tips',
      
      // Celebrities & Influencers
      'celebrity', 'bollywood', 'hollywood', 'actor', 'actress',
      'model', 'fashion model', 'lifestyle blog', 'personal blog',
      'influencer marketing', 'brand ambassador', 'sponsored content',
      
      // Personal/Non-Business
      'personal account', 'personal page', 'my journey', 'lifestyle vlog',
      'daily vlog', 'vlog life', 'travel blog', 'food blog',
      
      // Non-Islamic Finance
      'crypto only', 'cryptocurrency trading', 'forex trading',
      'day trading', 'stock tips', 'investment memes',
      
      // Random/Unrelated
      'fashion studio', 'beauty salon', 'makeup artist', 'hair stylist',
      'fitness coach', 'yoga instructor', 'life coach', 'motivation quotes'
    ];
    
    const hasBlacklistedTerms = blacklistedTerms.some(term => 
      combinedText.toLowerCase().includes(term)
    );
    
    // Penalty for generic business terms without Islamic context
    const genericBusinessTerms = ['entrepreneur', 'business', 'startup', 'finance'];
    const hasGenericOnly = genericBusinessTerms.some(term => 
      combinedText.toLowerCase().includes(term)
    ) && !combinedText.toLowerCase().includes('islam') 
      && !combinedText.toLowerCase().includes('halal')
      && !combinedText.toLowerCase().includes('sharia');
    
    // Calculate confidence score - MUCH STRICTER
    let confidenceScore = 0.2; // Very low base score (was 0.3)
    if (isActive) confidenceScore += 0.15;
    if (followerEstimate !== 'unknown') confidenceScore += 0.10;
    if (hasNicheMatch) confidenceScore += 0.45; // Strong boost for niche match
    if (hasBlacklistedTerms) confidenceScore -= 0.6; // MASSIVE penalty
    if (hasGenericOnly) confidenceScore -= 0.3; // Penalty for generic business without Islamic context
    
    // MUST have niche match AND high score AND no blacklist to be relevant
    const isRelevant = hasNicheMatch && confidenceScore >= 0.70 && !hasBlacklistedTerms;
    
    return {
      handle,
      isValid: true,
      exists: true,
      isActive,
      isRelevant,
      followerEstimate,
      niche: hasNicheMatch ? targetNiche : null,
      confidenceScore: Math.min(confidenceScore, 1.0),
      reason: isActive ? 'Active Instagram account found' : 'Account found but activity unclear',
      bio: searchResult.context_summary?.substring(0, 200),
    };
    
  } catch (error: any) {
    console.error(`[Validator] Search validation failed for @${handle}:`, error.message);
    
    // Fallback: If search fails, at least check format
    return {
      handle,
      isValid: true,  // Format is valid
      exists: false,  // Can't confirm existence
      isActive: false,
      isRelevant: false,
      followerEstimate: 'unknown',
      niche: null,
      confidenceScore: 0.3,  // Low confidence due to failed validation
      reason: `Validation incomplete: ${error.message}`,
    };
  }
}

/**
 * Batch validate multiple handles
 */
export async function validateCompetitorBatch(
  competitors: Array<{ handle: string }>,
  targetNiche: string,
  targetHandle?: string
): Promise<Map<string, ValidationResult>> {
  const results = new Map<string, ValidationResult>();
  
  console.log(`[Validator] Batch validating ${competitors.length} competitors`);
  
  // Validate in parallel but with rate limiting
  const batchSize = 5;  // Process 5 at a time to avoid overwhelming search
  
  for (let i = 0; i < competitors.length; i += batchSize) {
    const batch = competitors.slice(i, i + batchSize);
    const promises = batch.map(comp => 
      validateInstagramHandle(comp.handle, targetNiche, targetHandle)
    );
    
    const batchResults = await Promise.all(promises);
    batchResults.forEach(result => {
      results.set(result.handle, result);
    });
    
    // Small delay between batches
    if (i + batchSize < competitors.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`[Validator] Validated ${results.size} competitors, ${Array.from(results.values()).filter(r => r.isValid && r.isRelevant).length} are valid and relevant`);
  
  return results;
}

/**
 * Filter and score competitors based on validation results
 */
export function filterValidatedCompetitors<T extends { handle: string; relevanceScore?: number }>(
  competitors: T[],
  validationResults: Map<string, ValidationResult>,
  minConfidence: number = 0.7  // Raised from 0.5 for stricter filtering
): Array<T & { validationScore: number; followerEstimate?: string }> {
  return competitors
    .map(comp => {
      const validation = validationResults.get(comp.handle);
      if (!validation) return null;
      
      // Skip if below minimum confidence or invalid
      if (!validation.isValid || validation.confidenceScore < minConfidence) {
        return null;
      }
      
      // Calculate combined score
      const baseScore = comp.relevanceScore || 0.5;
      const validationScore = validation.confidenceScore;
      const combinedScore = (baseScore * 0.6) + (validationScore * 0.4);
      
      return {
        ...comp,
        validationScore: combinedScore,
        followerEstimate: validation.followerEstimate,
        relevanceScore: combinedScore, // Update relevance score
      };
    })
    .filter((comp): comp is NonNullable<typeof comp> => comp !== null)
    .sort((a, b) => b.validationScore - a.validationScore);
}
