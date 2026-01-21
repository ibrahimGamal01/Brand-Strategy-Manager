/**
 * TikTok Service
 * 
 * TypeScript wrapper for tiktok_scraper.py
 * Handles profile scraping, video metadata, and content download.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

export interface TikTokVideo {
  video_id: string;
  url: string;
  title: string;
  description: string;
  duration: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  upload_date: string;  // YYYYMMDD format
  timestamp?: number;   // Unix timestamp
  thumbnail: string;
  thumbnails?: Array<{ id: string; url: string; preference: number }>;
}

export interface TikTokProfile {
  handle: string;
  display_name: string;
  profile_url: string;
  follower_count: number;
  bio?: string;
}

export interface TikTokScrapeResult {
  success: boolean;
  profile?: TikTokProfile;
  videos?: TikTokVideo[];
  total_videos?: number;
  error?: string;
}

/**
 * Scrape TikTok profile and recent videos
 */
export async function scrapeTikTokProfile(
  handle: string,
  maxVideos: number = 30
): Promise<TikTokScrapeResult> {
  const cleanHandle = handle.replace('@', '');
  console.log(`[TikTok] Scraping @${cleanHandle}...`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/tiktok_scraper.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} profile "${cleanHandle}" ${maxVideos}`,
      {
        cwd: process.cwd(),
        timeout: 180000, // 3 min timeout
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    
    if (stderr) {
      console.log(`[TikTok] ${stderr}`);
    }
    
    const result = JSON.parse(stdout);
    
    if (result.error) {
      console.error(`[TikTok] Error: ${result.error}`);
      return { success: false, error: result.error };
    }
    
    console.log(`[TikTok] Found ${result.total_videos || 0} videos for @${cleanHandle}`);
    
    return {
      success: true,
      profile: result.profile,
      videos: result.videos,
      total_videos: result.total_videos,
    };
    
  } catch (error: any) {
    console.error(`[TikTok] Scrape failed:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Download a TikTok video
 */
export async function downloadTikTokVideo(
  videoUrl: string,
  outputPath: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  console.log(`[TikTok] Downloading (Puppeteer): ${videoUrl}`);
  
  try {
    // USE PUPPETEER SCRIPT INSTEAD OF PYTHON
    const scriptPath = path.join(process.cwd(), 'scripts/tiktok_downloader.ts');
    
    // Using npx tsx to execute the typescript file directly
    const { stdout, stderr } = await execAsync(
      `npx tsx ${scriptPath} "${videoUrl}" "${outputPath}"`,
      {
        cwd: process.cwd(),
        timeout: 300000, // 5 min timeout for headless browser
      }
    );
    
    // Puppeteer output might be noisy, look for the JSON line
    // The script prints JSON at the end
    const lines = stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    
    try {
        const result = JSON.parse(lastLine);
        return result;
    } catch (e) {
        console.error(`[TikTok] Failed to parse output: ${lastLine}`);
        // If stderr has content, it might be an error from tsx or puppeteer
        if (stderr) console.error(`[TikTok] Stderr: ${stderr}`);
        return { success: false, error: 'Failed to parse downloader output' };
    }
    
  } catch (error: any) {
    console.error(`[TikTok] Download failed:`, error.message);
    return { success: false, error: error.message };
  }
}


/**
 * Scrape TikTok and save to database
 */
export async function scrapeTikTokAndSave(
  researchJobId: string,
  handle: string,
  maxVideos: number = 30
): Promise<void> {
  const result = await scrapeTikTokProfile(handle, maxVideos);
  
  if (!result.success || !result.profile) {
    console.log(`[TikTok] Could not scrape @${handle} - may not have TikTok`);
    return;
  }
  
  // Save/Update Social Profile
  const profile = await prisma.socialProfile.upsert({
    where: {
      researchJobId_platform_handle: {
        researchJobId,
        platform: 'tiktok',
        handle: result.profile.handle,
      },
    },
    update: {
      followers: result.profile.follower_count,
      lastScrapedAt: new Date(),
    },
    create: {
      researchJobId,
      platform: 'tiktok',
      handle: result.profile.handle,
      url: result.profile.profile_url,
      followers: result.profile.follower_count,
      lastScrapedAt: new Date(),
    },
  });
  
  // Save Videos as Posts
  if (result.videos && result.videos.length > 0) {
    for (const video of result.videos) {
      try {
        await prisma.socialPost.upsert({
          where: {
            socialProfileId_externalId: {
              socialProfileId: profile.id,
              externalId: video.video_id,
            },
          },
          update: {
            likesCount: video.like_count,
            commentsCount: video.comment_count,
            sharesCount: video.share_count,
            viewsCount: video.view_count,
            scrapedAt: new Date(),
          },
          create: {
            socialProfileId: profile.id,
            externalId: video.video_id,
            url: video.url,
            type: 'video',
            caption: video.description || video.title,
            likesCount: video.like_count,
            commentsCount: video.comment_count,
            sharesCount: video.share_count,
            viewsCount: video.view_count,
            duration: video.duration,
            postedAt: video.upload_date ? new Date(video.upload_date) : undefined,
            scrapedAt: new Date(),
          },
        });
      } catch (e: any) {
        console.error(`[TikTok] Failed to save video ${video.video_id}:`, e.message);
      }
    }
    
    console.log(`[TikTok] Saved ${result.videos.length} videos for @${handle}`);
  }
}

export const tiktokService = {
  scrapeProfile: scrapeTikTokProfile,
  downloadVideo: downloadTikTokVideo,
  scrapeAndSave: scrapeTikTokAndSave,
};
