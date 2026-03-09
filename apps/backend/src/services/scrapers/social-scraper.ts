/**
 * Social Media Scraper Service
 * 
 * Compatibility layer for legacy /api/scrapers routes.
 * Delegates to policy-managed scraper services to avoid bypassing proxy policy.
 */

import { PrismaClient } from '@prisma/client';
import { scrapeInstagramProfile } from '../scraper/instagram-service';
import { tiktokService } from '../scraper/tiktok-service';

const prisma = new PrismaClient();

// Configuration
const DEFAULT_MAX_POSTS = 20;

export interface ScrapeResult {
  success: boolean;
  platform: 'INSTAGRAM' | 'TIKTOK';
  postsScraped: number;
  error?: string;
  data?: any;
}

export class SocialScraperService {
  
  /**
   * Scrape a competitor's social media profile
   */
  async scrapeCompetitor(competitorId: string, platform: 'INSTAGRAM' | 'TIKTOK'): Promise<ScrapeResult> {
    console.log(`[Scraper] Starting ${platform} scrape for competitor ${competitorId}...`);

    try {
      // 1. Get competitor handle
      const competitor = await prisma.competitor.findUnique({
        where: { id: competitorId }
      });

      if (!competitor) {
        throw new Error(`Competitor ${competitorId} not found`);
      }

      // Check if handle exists for platform
      // Note: Assuming handle is stored in 'handle' field or needs extraction
      const rawHandle = competitor.handle || competitor.name || '';
      const handle = this.extractHandle(rawHandle, platform);
      
      console.log(`[Scraper] Target handle: @${handle}`);

      // 2. Execute scraping
      const rawData = await this.runPythonScraper(platform, handle);

      if (!rawData || !rawData.success) {
        throw new Error(rawData?.error || 'Scraping failed with no error message');
      }

      // 3. Save to database
      const savedCount = await this.savePostData(competitorId, platform, rawData.posts);

      // 4. Update competitor metadata
      await this.updateCompetitorStats(competitorId, platform, rawData);

      console.log(`[Scraper] Success! Saved ${savedCount} posts.`);

      return {
        success: true,
        platform,
        postsScraped: savedCount,
        data: rawData
      };

    } catch (error) {
      console.error(`[Scraper] Error:`, error);
      return {
        success: false,
        platform,
        postsScraped: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run platform scraping via policy-managed services.
   */
  private async runPythonScraper(platform: 'INSTAGRAM' | 'TIKTOK', handle: string): Promise<any> {
    if (platform === 'INSTAGRAM') {
      const result = await scrapeInstagramProfile(handle, DEFAULT_MAX_POSTS);
      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error || 'Instagram scraping failed',
          scraper_used: result.scraper_used || 'instagram-service',
        };
      }

      return {
        success: true,
        profile: {
          handle: result.data.handle,
          followers: result.data.follower_count,
          following: result.data.following_count,
          bio: result.data.bio,
          posts_count: result.data.total_posts,
        },
        posts: result.data.posts.map((post) => ({
          id: post.external_post_id,
          url: post.post_url,
          caption: post.caption || '',
          likes: post.likes || 0,
          comments: post.comments || 0,
          views: 0,
          shares: 0,
          type: post.is_video ? 'VIDEO' : 'IMAGE',
          date: post.timestamp || '',
          media_url: post.media_url || '',
        })),
        scraper_used: result.scraper_used || 'instagram-service',
      };
    }

    const result = await tiktokService.scrapeProfile(handle, DEFAULT_MAX_POSTS);
    if (!result.success || !result.profile) {
      return {
        success: false,
        error: result.error || 'TikTok scraping failed',
        scraper_used: 'tiktok-service',
      };
    }

    return {
      success: true,
      profile: {
        handle: result.profile.handle,
        followers: result.profile.follower_count || 0,
        following: 0,
        bio: result.profile.bio || '',
        posts_count: result.total_videos || 0,
      },
      posts: (result.videos || []).map((video) => ({
        id: video.video_id,
        url: video.url,
        caption: video.description || video.title || '',
        description: video.description || video.title || '',
        likes: video.like_count || 0,
        comments: video.comment_count || 0,
        shares: video.share_count || 0,
        views: video.view_count || 0,
        type: 'VIDEO',
        date: video.upload_date || '',
        duration: video.duration || 0,
        thumbnail: video.thumbnail || '',
      })),
      scraper_used: 'tiktok-service',
    };
  }

  /**
   * Save scraped posts to database
   */
  private async savePostData(competitorId: string, platform: 'INSTAGRAM' | 'TIKTOK', posts: any[]) {
    if (!posts || !Array.isArray(posts)) return 0;

    let count = 0;
    for (const post of posts) {
      try {
        await prisma.socialPost.create({
          data: {
            // Note: This function needs socialProfileId to work properly
            // competitorId and platform fields don't exist in SocialPost schema
            url: post.url || '',
            caption: post.caption || post.description || '',
            externalId: post.id || `post_${Date.now()}`,
            socialProfileId: 'PLACEHOLDER', // TODO: Pass socialProfileId from parent
            metadata: {
              likes: post.likes || 0,
              comments: post.comments || 0,
              views: post.views || 0,
              shares: post.shares || 0,
              engagementRate: post.engagement_rate || 0,
              format: post.type || (platform === 'TIKTOK' ? 'VIDEO' : 'UNKNOWN')
            },
            postedAt: post.date ? new Date(post.date) : new Date()
          }
        });
        count++;
      } catch (e) {
        // Ignore duplicates or errors
        // console.warn('Duplicate post skipped');
      }
    }
    return count;
  }

  /**
   * Update competitor profile stats
   */
  private async updateCompetitorStats(competitorId: string, platform: 'INSTAGRAM' | 'TIKTOK', data: any) {
    // metadata field in Competitor model
    const stats = platform === 'INSTAGRAM' ? data.profile : { 
      followers: 0, // TikTok generic extraction doesn't give follower count reliably
      following: 0 
    };

    if (stats) {
      // Merge into competitor metadata
      // Implementation depends on schema structure
    }
  }

  private extractHandle(input: string, platform: 'INSTAGRAM' | 'TIKTOK'): string {
    // Remove URL parts, @ symbol, etc.
    let handle = input.replace('https://www.instagram.com/', '')
                      .replace('https://www.tiktok.com/@', '')
                      .replace('https://www.tiktok.com/', '')
                      .replace('@', '')
                      .split('/')[0]
                      .split('?')[0];
    return handle;
  }
}
