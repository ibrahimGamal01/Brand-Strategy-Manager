/**
 * YouTube Service
 * 
 * TypeScript wrapper for youtube_downloader.py
 * Handles video info extraction and download.
 */

import crypto from 'crypto';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { createScraperProxyPool, runScriptJsonWithRetries } from './script-runner';

const prisma = new PrismaClient();
const youtubeProxyPool = createScraperProxyPool('youtube-scraper', [
  'YOUTUBE_SCRAPER_PROXY_URLS',
  'SCRAPER_PROXY_URLS',
  'PROXY_URLS',
  'PROXY_URL',
]);

export interface YouTubeVideoInfo {
  video_id: string;
  title: string;
  description: string;
  duration: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  channel: string;
  channel_id: string;
  channel_url: string;
  upload_date: string;
  thumbnail: string;
  categories: string[];
  tags: string[];
}

/**
 * Get video info without downloading
 */
export async function getYouTubeVideoInfo(url: string): Promise<YouTubeVideoInfo | null> {
  console.log(`[YouTube] Getting info for: ${url}`);
  
  try {
    const result = await runScriptJsonWithRetries<YouTubeVideoInfo & { success?: boolean; error?: string }>({
      label: 'youtube-info',
      executable: 'python3',
      scriptFileName: 'youtube_downloader.py',
      args: ['info', url],
      timeoutMs: 60_000,
      maxAttempts: Number(process.env.YOUTUBE_INFO_ATTEMPTS || 2),
      proxyPool: youtubeProxyPool,
    });

    const parsed = result.parsed;
    if ((parsed as any).error) {
      console.error(`[YouTube] Error: ${(parsed as any).error}`);
      return null;
    }
    
    return parsed;
    
  } catch (error: any) {
    console.error(`[YouTube] Info extraction failed:`, error.message);
    return null;
  }
}

/**
 * Download a YouTube video
 */
export async function downloadYouTubeVideo(
  url: string,
  outputPath: string,
  audioOnly: boolean = false
): Promise<{ success: boolean; path?: string; size_bytes?: number; error?: string }> {
  console.log(`[YouTube] Downloading ${audioOnly ? 'audio' : 'video'}: ${url}`);
  
  try {
    const action = audioOnly ? 'audio' : 'download';
    const result = await runScriptJsonWithRetries<{
      success: boolean;
      path?: string;
      size_bytes?: number;
      error?: string;
    }>({
      label: 'youtube-download',
      executable: 'python3',
      scriptFileName: 'youtube_downloader.py',
      args: [action, url, outputPath],
      timeoutMs: 300_000,
      maxAttempts: Number(process.env.YOUTUBE_DOWNLOAD_ATTEMPTS || 3),
      proxyPool: youtubeProxyPool,
    });

    return result.parsed;
    
  } catch (error: any) {
    console.error(`[YouTube] Download failed:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Download YouTube video from DDG result and save to MediaAsset
 */
export async function downloadDdgYouTubeVideo(
  ddgVideoResultId: string,
  researchJobId: string
): Promise<string | null> {
  const ddgResult = await prisma.ddgVideoResult.findUnique({
    where: { id: ddgVideoResultId },
  });
  
  if (!ddgResult || !ddgResult.url) {
    console.error(`[YouTube] DDG result not found: ${ddgVideoResultId}`);
    return null;
  }
  
  // Skip non-YouTube URLs
  if (!ddgResult.url.includes('youtube.com') && !ddgResult.url.includes('youtu.be')) {
    console.log(`[YouTube] Not a YouTube URL, skipping: ${ddgResult.url}`);
    return null;
  }
  
  // Generate output path
  const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.mp4`;
  const outputPath = path.join(process.cwd(), 'storage', 'youtube', researchJobId, filename);
  
  const result = await downloadYouTubeVideo(ddgResult.url, outputPath);
  
  if (!result.success) {
    console.error(`[YouTube] Download failed for ${ddgResult.url}: ${result.error}`);
    return null;
  }
  
  // Create MediaAsset
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      mediaType: 'VIDEO',
      originalUrl: ddgResult.url,
      blobStoragePath: result.path || outputPath,
      fileSizeBytes: result.size_bytes || 0,
      isDownloaded: true,
      downloadedAt: new Date(),
      ddgVideoResultId,
    },
  });
  
  // Mark DDG result as downloaded
  await prisma.ddgVideoResult.update({
    where: { id: ddgVideoResultId },
    data: { isDownloaded: true },
  });
  
  console.log(`[YouTube] Saved MediaAsset: ${mediaAsset.id}`);
  return mediaAsset.id;
}

export const youtubeService = {
  getInfo: getYouTubeVideoInfo,
  download: downloadYouTubeVideo,
  downloadFromDdg: downloadDdgYouTubeVideo,
};
