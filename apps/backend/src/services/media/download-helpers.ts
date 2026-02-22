import sharp from 'sharp';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function extractImageMetadata(imagePath: string) {
  try {
    const metadata = await sharp(imagePath).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  } catch (error) {
    console.error('[Downloader] Error extracting image metadata:', error);
    return { width: 0, height: 0 };
  }
}

export async function generateVideoThumbnail(videoPath: string): Promise<string> {
  try {
    const thumbnailFilename = path.basename(videoPath, path.extname(videoPath)) + '_thumb.jpg';
    const thumbnailPath = path.join(path.dirname(videoPath), thumbnailFilename);
    const command = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,0)" -vframes 1 -y "${thumbnailPath}"`;

    await new Promise((resolve, reject) => {
      exec(command, (error: any, stdout: any, stderr: any) => {
        if (error) {
          console.error('[Downloader] ffmpeg error:', stderr);
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });

    console.log(`[Downloader] Generated thumbnail: ${thumbnailPath}`);
    return thumbnailPath;
  } catch (error: any) {
    console.error('[Downloader] Failed to generate video thumbnail:', error.message);
    return '';
  }
}

/**
 * Extract video duration in seconds using ffprobe.
 * Returns undefined if ffprobe is not available or the call fails.
 */
export async function extractVideoDuration(videoPath: string): Promise<number | undefined> {
  if (!videoPath || videoPath.startsWith('media/') || videoPath.startsWith('http')) {
    // R2 keys and remote URLs are not local paths - skip
    return undefined;
  }
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { timeout: 15_000 }
    );
    const seconds = parseFloat(stdout.trim());
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 100) / 100;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function extractMediaUrls(rawApiResponse: any): string[] {
  if (!rawApiResponse) return [];

  const urls: string[] = [];

  if (rawApiResponse.media_url) urls.push(rawApiResponse.media_url);
  if (rawApiResponse.video_url) urls.push(rawApiResponse.video_url);
  if (Array.isArray(rawApiResponse.media_urls)) urls.push(...rawApiResponse.media_urls);
  if (Array.isArray(rawApiResponse.images)) urls.push(...rawApiResponse.images);
  if (Array.isArray(rawApiResponse.childPosts)) {
    rawApiResponse.childPosts.forEach((c: any) => {
      if (c.displayUrl) urls.push(c.displayUrl);
      if (c.videoUrl) urls.push(c.videoUrl);
      if (Array.isArray(c.images)) urls.push(...c.images);
    });
  }
  if (rawApiResponse.media_urls && Array.isArray(rawApiResponse.media_urls)) {
    urls.push(...rawApiResponse.media_urls);
  }

  return urls.filter(Boolean);
}
