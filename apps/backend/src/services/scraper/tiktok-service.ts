/**
 * TikTok Service
 * 
 * TypeScript wrapper for tiktok_scraper.py
 * Handles profile scraping, video metadata, and content download.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
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

function resolveScriptPath(name: string, candidates: string[]): string | null {
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Scrape TikTok profile and recent videos
 * Primary: Camoufox | Fallback: tiktok_scraper.py (yt-dlp)
 */
export async function scrapeTikTokProfile(
  handle: string,
  maxVideos: number = 30
): Promise<TikTokScrapeResult> {
  const cleanHandle = handle.replace('@', '');
  console.log(`[TikTok] Scraping @${cleanHandle}...`);

  const cwd = process.cwd();
  const camoufoxCandidates = [
    path.join(cwd, 'scripts/camoufox_tiktok_scraper.py'),
    path.join(cwd, 'apps/backend/scripts/camoufox_tiktok_scraper.py'),
  ];
  const camoufoxPath = resolveScriptPath('camoufox_tiktok_scraper', camoufoxCandidates);

  if (camoufoxPath) {
    try {
      console.log(`[TikTok] Trying Camoufox scraper...`);
      const { stdout, stderr } = await execAsync(
        `python3 "${camoufoxPath}" profile "${cleanHandle}" ${maxVideos}`,
        { cwd, timeout: 180000, maxBuffer: 50 * 1024 * 1024 }
      );
      if (stderr) console.log(`[TikTok] ${stderr}`);
      const result = JSON.parse(stdout);
      if (result.success && (result.videos?.length > 0 || result.profile)) {
        console.log(`[TikTok] Camoufox found ${result.total_videos || 0} videos`);
        return {
          success: true,
          profile: result.profile,
          videos: result.videos,
          total_videos: result.total_videos,
        };
      }
    } catch (e: any) {
      console.log(`[TikTok] Camoufox failed: ${e.message}, falling back to yt-dlp...`);
    }
  }

  const ytdlpCandidates = [
    path.join(cwd, 'scripts/tiktok_scraper.py'),
    path.join(cwd, 'apps/backend/scripts/tiktok_scraper.py'),
  ];
  const scriptPath = resolveScriptPath('tiktok_scraper', ytdlpCandidates);
  if (!scriptPath) {
    return { success: false, error: 'tiktok_scraper.py not found' };
  }

  try {
    const { stdout, stderr } = await execAsync(
      `python3 "${scriptPath}" profile "${cleanHandle}" ${maxVideos}`,
      { cwd, timeout: 180000, maxBuffer: 50 * 1024 * 1024 }
    );
    if (stderr) console.log(`[TikTok] ${stderr}`);
    const result = JSON.parse(stdout);
    if (result.error) {
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
 * Primary: Camoufox | Fallback: tiktok_downloader.ts (Puppeteer)
 */
export async function downloadTikTokVideo(
  videoUrl: string,
  outputPath: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  console.log(`[TikTok] Downloading: ${videoUrl}`);

  const cwd = process.cwd();
  const camoufoxCandidates = [
    path.join(cwd, 'scripts/camoufox_tiktok_downloader.py'),
    path.join(cwd, 'apps/backend/scripts/camoufox_tiktok_downloader.py'),
  ];
  const camoufoxPath = resolveScriptPath('camoufox_tiktok_downloader', camoufoxCandidates);

  if (camoufoxPath) {
    try {
      const { stdout } = await execAsync(
        `python3 "${camoufoxPath}" "${videoUrl}" "${outputPath}"`,
        { cwd, timeout: 300000 }
      );
      const result = JSON.parse(stdout.trim());
      if (result.success) return result;
    } catch (e: any) {
      console.log(`[TikTok] Camoufox download failed: ${e.message}, falling back to Puppeteer...`);
    }
  }

  const puppeteerCandidates = [
    path.join(cwd, 'scripts/tiktok_downloader.ts'),
    path.join(cwd, 'apps/backend/scripts/tiktok_downloader.ts'),
  ];
  const scriptPath = resolveScriptPath('tiktok_downloader', puppeteerCandidates);
  if (!scriptPath) {
    return { success: false, error: 'tiktok_downloader.ts not found' };
  }

  try {
    const { stdout, stderr } = await execAsync(
      `npx tsx "${scriptPath}" "${videoUrl}" "${outputPath}"`,
      { cwd, timeout: 300000 }
    );
    const lines = stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    try {
      return JSON.parse(lastLine);
    } catch (e) {
      if (stderr) console.error(`[TikTok] Stderr: ${stderr}`);
      return { success: false, error: 'Failed to parse downloader output' };
    }
  } catch (error: any) {
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
