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

const prisma = new PrismaClient();
const execAsync = promisify(exec);

export interface ScrapedPost {
  externalId: string;
  url: string;
  type: string; // image, video, carousel
  caption: string;
  hashtags: string[];
  mentions: string[];
  
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
  
  // 2. Run Python scraper (simulated for now, would call real script)
  // In real implementation, we pass lastPostId to Python script to stop early
  try {
    // TODO: Replace with actual Python script call
    // const scriptPath = path.join(process.cwd(), 'scripts/social_scraper.py');
    // const { stdout } = await execAsync(`python3 ${scriptPath} scrape ${platform} ${handle} ${lastPostId || ''}`);
    // const scrapedData: ScrapedProfile = JSON.parse(stdout);
    
    // MOCK DATA for logic verification
    const scrapedData: ScrapedProfile = await mockScrape(handle, platform, lastPostId);
    
    if (!scrapedData) return null;
    
    console.log(`[SocialScraper] Scraped ${scrapedData.posts.length} new posts`);
    
    // 3. Save Profile & Posts to DB (Transactional)
    await saveScrapedData(researchJobId, scrapedData);
    
    return scrapedData;
    
  } catch (error: any) {
    console.error(`[SocialScraper] Failed to scrape @${handle}:`, error.message);
    throw error;
  }
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
    
    // 2. Process Posts & Trends
    let newPosts = 0;
    
    for (const post of data.posts) {
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
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          sharesCount: post.sharesCount,
          viewsCount: post.viewsCount,
          playsCount: post.playsCount,
          duration: post.duration,
          postedAt: new Date(post.postedAt),
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
  });
}

// Mock function for testing logic
async function mockScrape(handle: string, platform: string, lastId?: string | null): Promise<ScrapedProfile> {
  // Simulate delay
  await new Promise(r => setTimeout(r, 1000));
  
  return {
    handle,
    platform,
    url: `https://${platform}.com/${handle}`,
    followers: 15200,
    following: 340,
    postsCount: 1250,
    bio: 'Helping you be productive in this life and the next.',
    website: 'productivemuslim.com',
    isVerified: true,
    posts: [
      {
        externalId: 'post_101', // Newest
        url: `https://${platform}.com/p/101`,
        type: 'video',
        caption: '5 Tips for Fajr #productivity #islam',
        hashtags: ['productivity', 'islam', 'fajr'],
        mentions: [],
        likesCount: 1200,
        commentsCount: 45,
        sharesCount: 300,
        viewsCount: 15000,
        playsCount: 15000,
        duration: 60,
        postedAt: new Date().toISOString(),
      },
      {
        externalId: 'post_100', // Older
        url: `https://${platform}.com/p/100`,
        type: 'image',
        caption: 'Ramadan prep starts now! #ramadan',
        hashtags: ['ramadan', 'prep'],
        mentions: [],
        likesCount: 900,
        commentsCount: 30,
        sharesCount: 150,
        viewsCount: 0,
        playsCount: 0,
        duration: 0,
        postedAt: new Date(Date.now() - 86400000).toISOString(),
      }
    ].filter(p => !lastId || p.externalId > lastId), // Simple mock filter
  };
}
