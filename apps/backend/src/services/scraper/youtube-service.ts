/**
 * YouTube Service
 * 
 * TypeScript wrapper for youtube_downloader.py
 * Handles video info extraction and download.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

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
    const scriptPath = path.join(process.cwd(), 'scripts/youtube_downloader.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} info "${url}"`,
      {
        cwd: process.cwd(),
        timeout: 60000,
      }
    );
    
    if (stderr) {
      console.log(`[YouTube] ${stderr}`);
    }
    
    const result = JSON.parse(stdout);
    
    if (result.error) {
      console.error(`[YouTube] Error: ${result.error}`);
      return null;
    }
    
    return result;
    
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
    const scriptPath = path.join(process.cwd(), 'scripts/youtube_downloader.py');
    const action = audioOnly ? 'audio' : 'download';
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} ${action} "${url}" "${outputPath}"`,
      {
        cwd: process.cwd(),
        timeout: 300000, // 5 min
      }
    );
    
    if (stderr) {
      console.log(`[YouTube] ${stderr}`);
    }
    
    const result = JSON.parse(stdout);
    return result;
    
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
  const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
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
