/**
 * TikTok Service
 * 
 * TypeScript wrapper for tiktok_scraper.py
 * Handles profile scraping, video metadata, and content download.
 */

import { PrismaClient } from '@prisma/client';
import { createScraperProxyPool, runScriptJsonWithRetries } from './script-runner';

const prisma = new PrismaClient();

const tiktokScraperProxyPool = createScraperProxyPool('tiktok-scraper', [
  'TIKTOK_SCRAPER_PROXY_URLS',
  'SCRAPER_PROXY_URLS',
  'PROXY_URLS',
  'PROXY_URL',
]);

const tiktokDownloaderProxyPool = createScraperProxyPool('tiktok-downloader', [
  'TIKTOK_DOWNLOADER_PROXY_URLS',
  'TIKTOK_SCRAPER_PROXY_URLS',
  'SCRAPER_PROXY_URLS',
  'PROXY_URLS',
  'PROXY_URL',
]);

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
 * Primary: Camoufox | Fallback: tiktok_scraper.py (yt-dlp)
 */
export async function scrapeTikTokProfile(
  handle: string,
  maxVideos: number = 30
): Promise<TikTokScrapeResult> {
  const cleanHandle = handle.replace('@', '');
  console.log(`[TikTok] Scraping @${cleanHandle}...`);

  try {
    console.log('[TikTok] Trying Camoufox scraper...');
    const camoufox = await runScriptJsonWithRetries<TikTokScrapeResult>({
      label: 'tiktok-camoufox-scrape',
      executable: 'python3',
      scriptFileName: 'camoufox_tiktok_scraper.py',
      args: ['profile', cleanHandle, String(maxVideos)],
      timeoutMs: 180_000,
      maxBufferBytes: 50 * 1024 * 1024,
      maxAttempts: Number(process.env.TIKTOK_CAMOUFOX_SCRAPE_ATTEMPTS || 2),
      proxyPool: tiktokScraperProxyPool,
    });
    const result = camoufox.parsed;
    if (result.success && (result.videos?.length || result.profile)) {
      console.log(`[TikTok] Camoufox found ${result.total_videos || 0} videos`);
      return result;
    }
  } catch (e: any) {
    console.log(`[TikTok] Camoufox failed: ${e.message}, falling back to yt-dlp...`);
  }

  try {
    const fallback = await runScriptJsonWithRetries<TikTokScrapeResult>({
      label: 'tiktok-ytdlp-scrape',
      executable: 'python3',
      scriptFileName: 'tiktok_scraper.py',
      args: ['profile', cleanHandle, String(maxVideos)],
      timeoutMs: 180_000,
      maxBufferBytes: 50 * 1024 * 1024,
      maxAttempts: Number(process.env.TIKTOK_YTDLP_SCRAPE_ATTEMPTS || 3),
      proxyPool: tiktokScraperProxyPool,
    });
    const result = fallback.parsed;
    if ((result as any).error) {
      return { success: false, error: (result as any).error };
    }
    console.log(`[TikTok] Found ${result.total_videos || 0} videos for @${cleanHandle}`);
    return result;
  } catch (error: any) {
    console.error('[TikTok] Scrape failed:', error.message);
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

  try {
    const camoufox = await runScriptJsonWithRetries<{ success: boolean; path?: string; error?: string }>({
      label: 'tiktok-camoufox-download',
      executable: 'python3',
      scriptFileName: 'camoufox_tiktok_downloader.py',
      args: [videoUrl, outputPath],
      timeoutMs: 300_000,
      maxAttempts: Number(process.env.TIKTOK_CAMOUFOX_DOWNLOAD_ATTEMPTS || 2),
      proxyPool: tiktokDownloaderProxyPool,
    });
    if (camoufox.parsed.success) return camoufox.parsed;
  } catch (e: any) {
    console.log(`[TikTok] Camoufox download failed: ${e.message}, falling back to Puppeteer...`);
  }

  try {
    const puppeteer = await runScriptJsonWithRetries<{ success: boolean; path?: string; error?: string }>({
      label: 'tiktok-puppeteer-download',
      executable: 'npx',
      scriptArgsPrefix: ['tsx'],
      scriptFileName: 'tiktok_downloader.ts',
      args: [videoUrl, outputPath],
      timeoutMs: 300_000,
      maxAttempts: Number(process.env.TIKTOK_PUPPETEER_DOWNLOAD_ATTEMPTS || 2),
      proxyPool: tiktokDownloaderProxyPool,
    });
    return puppeteer.parsed;
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
