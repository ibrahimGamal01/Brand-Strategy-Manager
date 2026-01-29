/**
 * Automatic CLIENT Social Scraping Orchestrator
 * 
 * Automatically scrapes client social profiles (Instagram, TikTok) when a research job is created.
 * Competitors are NOT scraped automatically - they must be triggered manually.
 * 
 * Features:
 * - Local blob storage for all media
 * - Rate limiting (1 profile per 15 minutes)
 * - Hallucination detection for client data
 * - Only scrapes platforms: Instagram, TikTok
 */

import { PrismaClient } from '@prisma/client';
import { scrapeProfileSafe } from './scraper';
import { mediaDownloader } from '../media/downloader';

const prisma = new PrismaClient();

// Rate Limiter: Track last scrape time per profile
class ScrapeRateLimiter {
  private lastScrapeTime: Map<string, number> = new Map();
  private readonly RATE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

  /**
   * Check if scraping is allowed for this profile
   */
  canScrape(platform: string, handle: string): boolean {
    const key = `${platform}:${handle}`;
    const lastTime = this.lastScrapeTime.get(key);
    
    if (!lastTime) return true;
    
    const elapsed = Date.now() - lastTime;
    return elapsed >= this.RATE_LIMIT_MS;
  }

  /**
   * Record that we just scraped this profile
   */
  recordScrape(platform: string, handle: string): void {
    const key = `${platform}:${handle}`;
    this.lastScrapeTime.set(key, Date.now());
  }

  /**
   * Get time remaining until next scrape is allowed
   */
  getTimeUntilNextScrape(platform: string, handle: string): number {
    const key = `${platform}:${handle}`;
    const lastTime = this.lastScrapeTime.get(key);
    
    if (!lastTime) return 0;
    
    const elapsed = Date.now() - lastTime;
    const remaining = this.RATE_LIMIT_MS - elapsed;
    return Math.max(0, remaining);
  }
}

export const scrapeRateLimiter = new ScrapeRateLimiter();

/**
 * Main function: Auto-scrape all client profiles when job is created
 */
export async function autoScrapeClientProfiles(researchJobId: string): Promise<{
  success: boolean;
  scraped: string[];
  skipped: string[];
  errors: string[];
}> {
  console.log(`[AutoScraper] Starting auto-scrape for job: ${researchJobId}`);
  
  const scraped: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  try {
    // 1. Get research job and client data
    const job = await prisma.researchJob.findUnique({
      where: { id: researchJobId },
      include: {
        client: {
          include: {
            clientAccounts: true
          }
        }
      }
    });

    if (!job) {
      throw new Error(`Research job ${researchJobId} not found`);
    }

    // 2. Get all client handles (Instagram, TikTok only)
    const platformHandles = extractClientHandles(job);
    
    if (platformHandles.length === 0) {
      console.log(`[AutoScraper] No Instagram/TikTok handles found for job ${researchJobId}`);
      return { success: true, scraped: [], skipped: [], errors: [] };
    }

    console.log(`[AutoScraper] Found ${platformHandles.length} client profiles to scrape`);

    // 3. Scrape each platform with rate limiting
    for (const { platform, handle } of platformHandles) {
      // Check rate limit
      if (!scrapeRateLimiter.canScrape(platform, handle)) {
        const remainingMs = scrapeRateLimiter.getTimeUntilNextScrape(platform, handle);
        const remainingMin = Math.ceil(remainingMs / 60000);
        console.log(`[AutoScraper] Rate limited: ${platform}:@${handle} (${remainingMin} min remaining)`);
        skipped.push(`${platform}:@${handle} (rate limited)`);
        continue;
      }

      // Scrape profile
      console.log(`[AutoScraper] Scraping ${platform}:@${handle}...`);
      const result = await scrapeProfileSafe(researchJobId, platform, handle);

      if (result.success) {
        scraped.push(`${platform}:@${handle}`);
        scrapeRateLimiter.recordScrape(platform, handle);
        console.log(`[AutoScraper] ✅ Scraped ${platform}:@${handle}`);
      } else {
        errors.push(`${platform}:@${handle}: ${result.error}`);
        console.error(`[AutoScraper] ❌ Failed ${platform}:@${handle}: ${result.error}`);
      }
    }

    // 4. Download all client media to local blob storage
    if (scraped.length > 0) {
      console.log(`[AutoScraper] Downloading media for ${scraped.length} profiles...`);
      await downloadAllClientMedia(researchJobId);
    }

    // 5. Validate client data quality
    console.log(`[AutoScraper] Validating client data quality...`);
    await validateClientData(researchJobId);

    console.log(`[AutoScraper] Complete: ${scraped.length} scraped, ${skipped.length} skipped, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      scraped,
      skipped,
      errors
    };

  } catch (error: any) {
    console.error(`[AutoScraper] Critical error:`, error);
    errors.push(error.message);
    return { success: false, scraped, skipped, errors };
  }
}

/**
 * Extract Instagram + TikTok handles from job input data
 */
function extractClientHandles(job: any): Array<{ platform: string; handle: string }> {
  const handles: Array<{ platform: string; handle: string }> = [];
  const inputData = job.inputData || {};

  // Method 1: Check inputData.handles (new multi-platform format)
  if (inputData.handles && typeof inputData.handles === 'object') {
    for (const [platform, handle] of Object.entries(inputData.handles)) {
      if ((platform === 'instagram' || platform === 'tiktok') && typeof handle === 'string' && handle) {
        handles.push({ platform, handle: handle.toLowerCase().trim() });
      }
    }
  }

  // Method 2: Check single handle from inputData (legacy format)
  if (handles.length === 0 && inputData.handle) {
    const platform = inputData.platform || 'instagram';
    if (platform === 'instagram' || platform === 'tiktok') {
      handles.push({ platform, handle: inputData.handle.toLowerCase().trim() });
    }
  }

  // Method 3: Check clientAccounts (already saved to DB)
  if (job.client?.clientAccounts) {
    for (const account of job.client.clientAccounts) {
      if ((account.platform === 'instagram' || account.platform === 'tiktok') && account.handle) {
        const key = `${account.platform}:${account.handle}`;
        const exists = handles.some(h => `${h.platform}:${h.handle}` === key);
        if (!exists) {
          handles.push({ platform: account.platform, handle: account.handle });
        }
      }
    }
  }

  return handles;
}

/**
 * Download all client media to local blob storage
 */
async function downloadAllClientMedia(researchJobId: string): Promise<void> {
  try {
    // Get all social profiles for this research job
    const profiles = await prisma.socialProfile.findMany({
      where: { researchJobId },
      include: {
        posts: {
          include: {
            mediaAssets: true
          }
        }
      }
    });

    console.log(`[AutoScraper] Found ${profiles.length} profiles with posts to download`);

    // Download media for each profile
    for (const profile of profiles) {
      console.log(`[AutoScraper] Downloading media for ${profile.platform}:@${profile.handle}...`);
      await mediaDownloader.downloadSocialProfileMedia(profile.id);
    }

    console.log(`[AutoScraper] Media download complete`);
  } catch (error: any) {
    console.error(`[AutoScraper] Media download failed:`, error);
    // Don't throw - media download is not critical
  }
}

/**
 * Validate client data quality (hallucination detection)
 */
async function validateClientData(researchJobId: string): Promise<void> {
  try {
    const profiles = await prisma.socialProfile.findMany({
      where: { researchJobId },
      include: {
        posts: true
      }
    });

    for (const profile of profiles) {
      const issues: string[] = [];

      // Check 1: Follower count sanity
      if (profile.followers !== null && profile.followers < 0) {
        issues.push('Negative follower count');
      }

      // Check 2: Posts count vs actual posts
      if (profile.postsCount && profile.posts.length === 0) {
        issues.push(`Claims ${profile.postsCount} posts but has 0 scraped`);
      }

      // Check 3: Missing media URLs
      const postsWithoutMedia = profile.posts.filter(p => !p.thumbnailUrl).length;
      if (postsWithoutMedia > profile.posts.length * 0.5) {
        issues.push(`${postsWithoutMedia}/${profile.posts.length} posts missing media URLs`);
      }

      // Log validation results
      if (issues.length > 0) {
        console.warn(`[AutoScraper] Validation issues for ${profile.platform}:@${profile.handle}:`, issues);
      } else {
        console.log(`[AutoScraper] ✅ Validation passed for ${profile.platform}:@${profile.handle}`);
      }
    }
  } catch (error: any) {
    console.error(`[AutoScraper] Validation failed:`, error);
    // Don't throw - validation is not critical
  }
}
