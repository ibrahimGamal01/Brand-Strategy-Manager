import sharp from 'sharp';
import path from 'path';
import { exec } from 'child_process';

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
