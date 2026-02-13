/**
 * Competitor Availability Verifier
 * 
 * Platform-specific verification to check if handles actually exist before materialization.
 * This service focuses solely on existence verification, not relevance scoring.
 */

import { searchBrandContextDDG } from './duckduckgo-search.js';

const VERIFICATION_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.COMPETITOR_VERIFICATION_TIMEOUT_MS || 10000)
);

export interface AvailabilityResult {
  handle: string;
  platform: 'instagram' | 'tiktok';
  exists: boolean;
  confidence: number; // 0-1
  reason: string;
  profileUrl?: string;
  metadata?: {
    searchResults: number;
    exactUrlMatch: boolean;
    exactMentionMatch: boolean;
    hasRecentActivity: boolean;
  };
}

/**
 * Verify if an Instagram handle exists
 */
export async function verifyInstagramHandle(handle: string): Promise<AvailabilityResult> {
  console.log(`[Verifier] Checking Instagram handle: @${handle}`);

  try {
    const searchResult = await searchBrandContextDDG(handle, undefined, {
      timeoutMs: VERIFICATION_TIMEOUT_MS,
    });

    const rawRows = searchResult.raw_results || [];
    const handleLower = handle.toLowerCase();
    const exactUrlPattern = `instagram.com/${handleLower}`;
    
    // Check for exact URL match in search results
    const hasExactUrl = rawRows.some((row) =>
      String(row.href || '').toLowerCase().includes(exactUrlPattern)
    );

    // Check for exact mention in text
    const searchTexts = rawRows.map(r => `${r.title} ${r.body}`.trim()).filter(Boolean);
    const combinedText = searchTexts.join(' ').toLowerCase();
    const hasExactMention = combinedText.includes(`@${handleLower}`) || 
                           combinedText.includes(`instagram.com/${handleLower}`);

    // Check for recent activity indicators
    const hasRecentActivity = searchTexts.some(text => {
      const lower = text.toLowerCase();
      return lower.includes('hours ago') || 
             lower.includes('day ago') || 
             lower.includes('days ago') ||
             lower.includes('2024') || 
             lower.includes('2025') || 
             lower.includes('2026');
    });

    // Check for negative indicators
    const hasNegativeIndicators = combinedText.includes('account not found') ||
                                  combinedText.includes('page not found') ||
                                  combinedText.includes('user not found') ||
                                  combinedText.includes('no longer available');

    // Determine existence
    const exists = (hasExactUrl || hasExactMention || Boolean(searchResult.instagram_handle)) && 
                   !hasNegativeIndicators;

    // Calculate confidence
    let confidence = 0;
    if (hasExactUrl) confidence += 0.5;
    if (hasExactMention) confidence += 0.2;
    if (searchResult.instagram_handle) confidence += 0.2;
    if (hasRecentActivity) confidence += 0.1;
    if (rawRows.length > 0) confidence += 0.1;
    if (hasNegativeIndicators) confidence = 0;

    confidence = Math.max(0, Math.min(1, confidence));

    // Determine reason
    let reason: string;
    if (!exists) {
      if (hasNegativeIndicators) {
        reason = 'Account not found or no longer available';
      } else if (rawRows.length === 0) {
        reason = 'No search results found';
      } else {
        reason = 'No reliable evidence of account existence';
      }
    } else {
      const evidenceParts = [];
      if (hasExactUrl) evidenceParts.push('exact URL match');
      if (hasExactMention) evidenceParts.push('exact mention');
      if (hasRecentActivity) evidenceParts.push('recent activity');
      reason = `Account exists (${evidenceParts.join(', ')})`;
    }

    return {
      handle,
      platform: 'instagram',
      exists,
      confidence,
      reason,
      profileUrl: exists ? `https://instagram.com/${handle}` : undefined,
      metadata: {
        searchResults: rawRows.length,
        exactUrlMatch: hasExactUrl,
        exactMentionMatch: hasExactMention,
        hasRecentActivity,
      },
    };
  } catch (error: any) {
    console.error(`[Verifier] Instagram verification failed for @${handle}:`, error.message);
    
    return {
      handle,
      platform: 'instagram',
      exists: false,
      confidence: 0,
      reason: `Verification failed: ${error.message}`,
      metadata: {
        searchResults: 0,
        exactUrlMatch: false,
        exactMentionMatch: false,
        hasRecentActivity: false,
      },
    };
  }
}

/**
 * Verify if a TikTok handle exists
 */
export async function verifyTikTokHandle(handle: string): Promise<AvailabilityResult> {
  console.log(`[Verifier] Checking TikTok handle: @${handle}`);

  try {
    const searchResult = await searchBrandContextDDG(handle, undefined, {
      timeoutMs: VERIFICATION_TIMEOUT_MS,
    });

    const rawRows = searchResult.raw_results || [];
    const handleLower = handle.toLowerCase();
    const exactUrlPattern = `tiktok.com/@${handleLower}`;
    
    // Check for exact URL match in search results
    const hasExactUrl = rawRows.some((row) =>
      String(row.href || '').toLowerCase().includes(exactUrlPattern)
    );

    // Check for exact mention in text
    const searchTexts = rawRows.map(r => `${r.title} ${r.body}`.trim()).filter(Boolean);
    const combinedText = searchTexts.join(' ').toLowerCase();
    const hasExactMention = combinedText.includes(`@${handleLower}`) || 
                           combinedText.includes(`tiktok.com/@${handleLower}`);

    // Check for recent activity indicators
    const hasRecentActivity = searchTexts.some(text => {
      const lower = text.toLowerCase();
      return lower.includes('hours ago') || 
             lower.includes('day ago') || 
             lower.includes('days ago') ||
             lower.includes('2024') || 
             lower.includes('2025') || 
             lower.includes('2026');
    });

    // Check for negative indicators
    const hasNegativeIndicators = combinedText.includes('account not found') ||
                                  combinedText.includes('page not found') ||
                                  combinedText.includes('user not found') ||
                                  combinedText.includes('no longer available') ||
                                  combinedText.includes('couldn\'t find this account');

    // Determine existence
    const exists = (hasExactUrl || hasExactMention || Boolean(searchResult.tiktok_handle)) && 
                   !hasNegativeIndicators;

    // Calculate confidence
    let confidence = 0;
    if (hasExactUrl) confidence += 0.5;
    if (hasExactMention) confidence += 0.2;
    if (searchResult.tiktok_handle) confidence += 0.2;
    if (hasRecentActivity) confidence += 0.1;
    if (rawRows.length > 0) confidence += 0.1;
    if (hasNegativeIndicators) confidence = 0;

    confidence = Math.max(0, Math.min(1, confidence));

    // Determine reason
    let reason: string;
    if (!exists) {
      if (hasNegativeIndicators) {
        reason = 'Account not found or no longer available';
      } else if (rawRows.length === 0) {
        reason = 'No search results found';
      } else {
        reason = 'No reliable evidence of account existence';
      }
    } else {
      const evidenceParts = [];
      if (hasExactUrl) evidenceParts.push('exact URL match');
      if (hasExactMention) evidenceParts.push('exact mention');
      if (hasRecentActivity) evidenceParts.push('recent activity');
      reason = `Account exists (${evidenceParts.join(', ')})`;
    }

    return {
      handle,
      platform: 'tiktok',
      exists,
      confidence,
      reason,
      profileUrl: exists ? `https://tiktok.com/@${handle}` : undefined,
      metadata: {
        searchResults: rawRows.length,
        exactUrlMatch: hasExactUrl,
        exactMentionMatch: hasExactMention,
        hasRecentActivity,
      },
    };
  } catch (error: any) {
    console.error(`[Verifier] TikTok verification failed for @${handle}:`, error.message);
    
    return {
      handle,
      platform: 'tiktok',
      exists: false,
      confidence: 0,
      reason: `Verification failed: ${error.message}`,
      metadata: {
        searchResults: 0,
        exactUrlMatch: false,
        exactMentionMatch: false,
        hasRecentActivity: false,
      },
    };
  }
}

/**
 * Batch verify multiple handles with rate limiting
 */
export async function verifyHandleBatch(
  candidates: Array<{ platform: 'instagram' | 'tiktok'; handle: string }>
): Promise<Map<string, AvailabilityResult>> {
  const results = new Map<string, AvailabilityResult>();
  
  console.log(`[Verifier] Batch verifying ${candidates.length} handles`);
  
  // Process in batches to avoid overwhelming the search service
  const batchSize = 3;
  const delayBetweenBatches = 1500; // 1.5 seconds
  
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const promises = batch.map(async (candidate) => {
      const key = `${candidate.platform}:${candidate.handle}`;
      
      try {
        const result = candidate.platform === 'instagram'
          ? await verifyInstagramHandle(candidate.handle)
          : await verifyTikTokHandle(candidate.handle);
        
        results.set(key, result);
        return result;
      } catch (error: any) {
        console.error(`[Verifier] Failed to verify ${key}:`, error.message);
        const failedResult: AvailabilityResult = {
          handle: candidate.handle,
          platform: candidate.platform,
          exists: false,
          confidence: 0,
          reason: `Verification error: ${error.message}`,
        };
        results.set(key, failedResult);
        return failedResult;
      }
    });
    
    await Promise.all(promises);
    
    // Delay between batches (except for the last batch)
    if (i + batchSize < candidates.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  const existsCount = Array.from(results.values()).filter(r => r.exists).length;
  console.log(`[Verifier] Batch verification complete: ${existsCount}/${candidates.length} exist`);
  
  return results;
}
