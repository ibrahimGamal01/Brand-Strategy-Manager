/**
 * Social Scraper Service (Incremental & Meta-Rich)
 * 
 * Capability:
 * 1. Scrapes social profiles (Instagram, TikTok, etc.)
 * 2. INCREMENTAL: Checks lastPostId and only scrapes new posts
 * 3. META-RICH: Captures likes, views, shares, engagement rate
 * 4. TRENDS: Extracts hashtags and trends from posts
 */

import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { mediaDownloader } from '../media/downloader';
import { calculatePostRankings } from '../scrapers/post-ranking-service';

const prisma = new PrismaClient();
const execAsync = promisify(exec);

export interface ScrapedPost {
  externalId: string;
  url: string;
  type: string; // image, video, carousel
  caption: string;
  hashtags: string[];
  mentions: string[];
  thumbnailUrl?: string;
  
  // Metrics
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  playsCount: number;
  duration: number; // seconds
  
  postedAt: string; // ISO date string
}

export interface ScrapedProfile {
  handle: string;
  platform: string;
  url: string;
  followers: number;
  following: number;
  postsCount: number;
  bio: string;
  website: string;
  isVerified: boolean;
  posts: ScrapedPost[];
}

// Concurrency Control
class ScraperLockManager {
  private locks: Set<string> = new Set();

  getLockId(platform: string, handle: string): string {
    return `${platform}:${handle}`;
  }

  tryAcquire(platform: string, handle: string): boolean {
    const id = this.getLockId(platform, handle);
    if (this.locks.has(id)) return false;
    this.locks.add(id);
    return true;
  }

  release(platform: string, handle: string): void {
    const id = this.getLockId(platform, handle);
    this.locks.delete(id);
  }
  
  isLocked(platform: string, handle: string): boolean {
      return this.locks.has(this.getLockId(platform, handle));
  }
}

export const scraperLock = new ScraperLockManager();

/**
 * Robust wrapper for scraping that handles errors and concurrency
 */
export async function scrapeProfileSafe(
    researchJobId: string, 
    platform: string, 
    handle: string
) {
    // 1. Concurrency Check
    if (!scraperLock.tryAcquire(platform, handle)) {
        console.warn(`[SocialScraper] Skipped: ${platform} @${handle} is already being scraped.`);
        return { success: false, error: 'Scrape already in progress for this profile' };
    }

    const start = Date.now();
    try {
        console.log(`[SocialScraper] Starting safe scrape: ${platform} @${handle}`);
        
        // 2. Execute Core Logic
        const result = await scrapeProfileIncrementally(researchJobId, platform, handle);
        
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[SocialScraper] Completed ${platform} @${handle} in ${duration}s`);
        
        return { success: true, data: result };

    } catch (error: any) {
        console.error(`[SocialScraper] CRITICAL FAILURE for ${platform} @${handle}:`, error);
        return { success: false, error: error.message || 'Unknown critical error' };
    } finally {
        // 3. Always Release Lock
        scraperLock.release(platform, handle);
    }
}

/**
 * Scrape a social profile incrementally
 * Checks DB for last scraped post and stops when reached
 */
export async function scrapeProfileIncrementally(
  researchJobId: string,
  platform: string,
  handle: string
): Promise<ScrapedProfile | null> {
  console.log(`[SocialScraper] Starting incremental scrape for @${handle} on ${platform}`);
  
  // 1. Get existing profile state to find checkpoint
  const existingProfile = await prisma.socialProfile.findUnique({
    where: {
      researchJobId_platform_handle: {
        researchJobId,
        platform,
        handle,
      },
    },
  });
  
  const lastPostId = existingProfile?.lastPostId;
  console.log(`[SocialScraper] Checkpoint: ${lastPostId ? `Last post ${lastPostId}` : 'None (Full scrape)'}`);
  
  // 2. Run platform-specific scraper
  try {
    let scrapedData: ScrapedProfile | null = null;
    
    if (platform === 'instagram') {
      // Use the instagram-service which calls the Python scraper
      const { scrapeInstagramProfile } = await import('../scraper/instagram-service');
      const result = await scrapeInstagramProfile(handle, 30);
      
      if (result.success && result.data) {
        scrapedData = {
          handle: result.data.handle,
          platform: 'instagram',
          url: `https://instagram.com/${result.data.handle}`,
          followers: result.data.follower_count,
          following: result.data.following_count,
          postsCount: result.data.total_posts,
          bio: result.data.bio,
          website: '',
          isVerified: result.data.is_verified,
          posts: result.data.posts.map(p => ({
            externalId: p.external_post_id,
            url: p.post_url,
            type: p.is_video ? 'video' : 'image',
            caption: p.caption,
            hashtags: extractHashtags(p.caption),
            mentions: extractMentions(p.caption),
            thumbnailUrl: p.media_url || p.video_url || undefined,
            likesCount: p.likes,
            commentsCount: p.comments,
            sharesCount: 0,
            viewsCount: 0,
            playsCount: 0,
            duration: 0,
            postedAt: p.timestamp,
          })),
        };
        console.log(`[SocialScraper] Instagram scraper used: ${result.scraper_used}`);
      } else {
        console.warn(`[SocialScraper] Instagram scrape failed: ${result.error}`);
        return null;
      }
    } else if (platform === 'tiktok') {
      // Use the tiktok-service
      const { tiktokService } = await import('../scraper/tiktok-service');
      const result = await tiktokService.scrapeProfile(handle, 30);
      
      if (result.success && result.profile) {
        scrapedData = {
          handle: result.profile.handle,
          platform: 'tiktok',
          url: result.profile.profile_url,
          followers: result.profile.follower_count || 0,
          following: 0,
          postsCount: result.total_videos || 0,
          bio: '',
          website: '',
          isVerified: false,
          posts: (result.videos || []).map(v => ({
            externalId: v.video_id,
            url: v.url,
            type: 'video',
            caption: v.description || v.title,
            hashtags: extractHashtags(v.description || ''),
            mentions: [],
            // Fix: correctly map (v as any).thumbnail which is provided by yt-dlp logic
            thumbnailUrl: (v as any).thumbnail || (v as any).cover || (v as any).origin_cover || undefined,
            likesCount: v.like_count || 0,
            commentsCount: v.comment_count || 0,
            sharesCount: v.share_count || 0,
            viewsCount: v.view_count || 0,
            playsCount: v.view_count || 0,
            duration: v.duration || 0,
            postedAt: v.upload_date || new Date().toISOString(),
          })),
        };
      } else {
        console.warn(`[SocialScraper] TikTok scrape failed: ${result.error}`);
        return null;
      }
    } else {
      console.warn(`[SocialScraper] Unsupported platform: ${platform}`);
      return null;
    }
    
    if (!scrapedData) return null;
    
    // Filter out posts we've already seen (if we have a checkpoint)
    if (lastPostId && scrapedData.posts.length > 0) {
      const lastIdx = scrapedData.posts.findIndex(p => p.externalId === lastPostId);
      if (lastIdx > 0) {
        scrapedData.posts = scrapedData.posts.slice(0, lastIdx);
        console.log(`[SocialScraper] Filtered to ${scrapedData.posts.length} new posts (checkpoint hit)`);
      }
    }
    
    console.log(`[SocialScraper] Scraped ${scrapedData.posts.length} posts for @${handle}`);
    
    // 3. Save Profile & Posts to DB (Transactional)
    const savedProfile = await saveScrapedData(researchJobId, scrapedData);

    // 4. Trigger Media Download (Robust/Grep mode)
    if (savedProfile) {
        await mediaDownloader.downloadSocialProfileMedia(savedProfile.id);
    }
    
    return scrapedData;
    
  } catch (error: any) {
    console.error(`[SocialScraper] Failed to scrape @${handle}:`, error.message);
    // Don't throw - return null so pipeline can continue
    return null;
  }
}

/**
 * Extract hashtags from caption
 */
function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w]+/g) || [];
  return matches.map(h => h.replace('#', '').toLowerCase());
}

/**
 * Extract mentions from caption
 */
function extractMentions(text: string): string[] {
  const matches = text.match(/@[\w.]+/g) || [];
  return matches.map(m => m.replace('@', '').toLowerCase());
}

/**
 * Save scraped data to DB using transaction
 * Updates profile stats and inserts/updates posts
 */
async function saveScrapedData(researchJobId: string, data: ScrapedProfile) {
  return prisma.$transaction(async (tx) => {
    // 1. Upsert Profile
    const profile = await tx.socialProfile.upsert({
      where: {
        researchJobId_platform_handle: {
          researchJobId,
          platform: data.platform,
          handle: data.handle,
        },
      },
      update: {
        followers: data.followers,
        following: data.following,
        postsCount: data.postsCount,
        bio: data.bio,
        website: data.website,
        isVerified: data.isVerified,
        lastScrapedAt: new Date(),
        // Update cursor if we got new posts
        lastPostId: data.posts.length > 0 ? data.posts[0].externalId : undefined,
      },
      create: {
        researchJobId,
        platform: data.platform,
        handle: data.handle,
        url: data.url,
        followers: data.followers,
        following: data.following,
        postsCount: data.postsCount,
        bio: data.bio,
        website: data.website,
        isVerified: data.isVerified,
        lastScrapedAt: new Date(),
        lastPostId: data.posts.length > 0 ? data.posts[0].externalId : null,
      },
    });
    
    // 2. Calculate post rankings
    const rankingsMap = calculatePostRankings(
      data.posts,
      data.followers,
      data.platform
    );
    
    // 3. Process Posts & Trends
    let newPosts = 0;
    
    for (const post of data.posts) {
      const metadata = rankingsMap.get(post.externalId);
      
      // Save Post
      const savedPost = await tx.socialPost.upsert({
        where: {
          socialProfileId_externalId: {
            socialProfileId: profile.id,
            externalId: post.externalId,
          },
        },
        update: {
          // Update volatile metrics
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          sharesCount: post.sharesCount,
          viewsCount: post.viewsCount,
          playsCount: post.playsCount,
          thumbnailUrl: post.thumbnailUrl,
          metadata: metadata as any, // Performance rankings
          scrapedAt: new Date(),
        },
        create: {
          socialProfileId: profile.id,
          externalId: post.externalId,
          url: post.url,
          type: post.type,
          caption: post.caption,
          hashtags: post.hashtags,
          mentions: post.mentions,
          thumbnailUrl: post.thumbnailUrl,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          sharesCount: post.sharesCount,
          viewsCount: post.viewsCount,
          duration: post.duration,
          postedAt: safeDate(post.postedAt),
          metadata: metadata as any, // Performance rankings
          scrapedAt: new Date(),
        },
      });
      
      newPosts++;
      
      // 3. Extract & Save Trends (Hashtags)
      if (post.hashtags && post.hashtags.length > 0) {
        for (const tag of post.hashtags) {
          await tx.socialTrend.create({
            data: {
              researchJobId, // Link to job for broad analysis
              socialPostId: savedPost.id, // Link to specific post source
              name: tag.toLowerCase(),
              platform: data.platform,
              type: 'hashtag',
              volume: post.viewsCount || post.likesCount || 0, // Proxy volume
              firstSeenAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        }
      }
    }
    
    console.log(`[SocialScraper] Saved profile @${data.handle} and ${newPosts} posts`);
    return profile;
  });
}

// Helper to safely parse dates
function safeDate(dateStr: string | undefined): Date {
  if (!dateStr) return new Date();
  
  // Handle YYYYMMDD format (common in some scrapers)
  if (/^\d{8}$/.test(dateStr)) {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return new Date(`${year}-${month}-${day}`);
  }

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    console.warn(`[SocialScraper] Invalid date encountered: ${dateStr}. Fallback to now.`);
    return new Date();
  }
  return d;
}
