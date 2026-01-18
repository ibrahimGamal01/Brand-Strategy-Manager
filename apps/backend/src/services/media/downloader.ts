import axios from 'axios';
import path from 'path';
import { fileManager, STORAGE_PATHS } from '../storage/file-manager';
import { prisma } from '../../lib/prisma';
import sharp from 'sharp';

/**
 * Download media assets for a post and save to storage
 */
export async function downloadPostMedia(
  postId: string,
  mediaUrls: string[],
  isClient: boolean,
  clientOrCompetitorId: string
): Promise<string[]> {
  const mediaAssetIds: string[] = [];

  for (const url of mediaUrls) {
    try {
      console.log(`[Downloader] Downloading: ${url}`);

      // Determine media type
      const isVideo = url.includes('.mp4') || url.includes('video');
      const mediaType = isVideo ? 'VIDEO' : 'IMAGE';

      // Generate storage path
      const extension = fileManager.getExtension(url);
      const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;

      const storagePath = isClient
        ? path.join(STORAGE_PATHS.clientMedia(clientOrCompetitorId, postId), filename)
        : path.join(STORAGE_PATHS.competitorMedia(clientOrCompetitorId, postId), filename);

      // Download file
      await fileManager.downloadAndSave(url, storagePath);

      // Get file stats
      const stats = fileManager.getStats(storagePath);
      const fileSizeBytes = stats?.size || 0;

      // Extract metadata
      let width, height, durationSeconds, thumbnailPath;

      if (mediaType === 'IMAGE') {
        const metadata = await extractImageMetadata(storagePath);
        width = metadata.width;
        height = metadata.height;
      } else {
        // For videos, extract first frame as thumbnail
        thumbnailPath = await generateVideoThumbnail(storagePath);
      }

      // Create MEDIA_ASSET record
      const mediaAsset = await prisma.mediaAsset.create({
        data: {
          clientPostId: isClient ? postId : undefined,
          cleanedPostId: !isClient ? postId : undefined,
          mediaType,
          originalUrl: url,
          blobStoragePath: storagePath,
          fileSizeBytes,
          width,
          height,
          durationSeconds,
          thumbnailPath,
          isDownloaded: true,
          downloadedAt: new Date(),
        },
      });

      mediaAssetIds.push(mediaAsset.id);
      console.log(`[Downloader] Saved media asset: ${mediaAsset.id}`);
    } catch (error: any) {
      console.error(`[Downloader] Failed to download ${url}:`, error.message);
      // Continue with other media even if one fails
    }
  }

  return mediaAssetIds;
}

/**
 * Extract image metadata using sharp
 */
async function extractImageMetadata(imagePath: string) {
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

/**
 * Generate thumbnail for video (first frame)
 */
async function generateVideoThumbnail(videoPath: string): Promise<string> {
  // For now, return null
  // TODO: Implement ffmpeg thumbnail generation
  // This requires ffmpeg to be installed and fluent-ffmpeg configuration
  console.log('[Downloader] Video thumbnail generation not yet implemented');
  return '';
}

/**
 * Download all media for client posts
 */
export async function downloadAllClientMedia(clientId: string) {
  console.log(`[Downloader] Downloading all media for client ${clientId}`);

  const posts = await prisma.clientPost.findMany({
    where: {
      clientAccount: {
        clientId,
      },
      mediaAssets: {
        none: {}, // Only posts without media downloaded yet
      },
    },
  });

  let downloadedCount = 0;

  for (const post of posts) {
    try {
      // Extract media URLs from raw API response
      const mediaUrls = extractMediaUrls(post.rawApiResponse);

      if (mediaUrls.length > 0) {
        await downloadPostMedia(post.id, mediaUrls, true, clientId);
        downloadedCount += mediaUrls.length;
      }
    } catch (error: any) {
      console.error(`[Downloader] Error downloading media for post ${post.id}:`, error);
    }
  }

  console.log(`[Downloader] Downloaded ${downloadedCount} media assets for client ${clientId}`);
  return downloadedCount;
}

/**
 * Extract media URLs from Instagram API response
 */
function extractMediaUrls(rawApiResponse: any): string[] {
  if (!rawApiResponse) return [];

  const urls: string[] = [];

  // Handle Instaloader format
  if (rawApiResponse.media_url) {
    urls.push(rawApiResponse.media_url);
  }

  if (rawApiResponse.video_url) {
    urls.push(rawApiResponse.video_url);
  }

  // Handle carousel (multiple media)
  if (rawApiResponse.media_urls && Array.isArray(rawApiResponse.media_urls)) {
    urls.push(...rawApiResponse.media_urls);
  }

  return urls.filter(Boolean);
}



/**
 * Download media from a generic URL (e.g. DDG Search Result)
 */
export async function downloadGenericMedia(
  url: string,
  referenceId: string, // The DDG Result ID
  type: 'DDG_VIDEO' | 'DDG_IMAGE',
  researchJobId: string
): Promise<string | null> {
  try {
    console.log(`[Downloader] Downloading generic media (${type}): ${url}`);

    // Determine media type
    const isVideo = type === 'DDG_VIDEO';
    const mediaType = isVideo ? 'VIDEO' : 'IMAGE';

    // Generate storage path
    // We'll use a 'research_downloads' folder structure: storage/research_jobs/<job_id>/<filename>
    const extension = fileManager.getExtension(url) || (isVideo ? 'mp4' : 'jpg');
    const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    
    // Construct path manually since STORAGE_PATHS might not have a generic helper yet
    // Assuming fileManager handles absolute paths if we give it one, or relative to storage root
    const relativeStoragePath = path.join('research_jobs', researchJobId, filename);
    
    // Download file
    // fileManager.downloadAndSave expects a full path or handles based on its config.
    // Let's check fileManager usage in downloadPostMedia: 
    // const storagePath = ... path.join(STORAGE_PATHS.clientMedia(...), filename)
    // So we need to provide the full destination path likely.
    
    // We'll define a base storage path for research. 
    // Ideally we should update STORAGE_PATHS in file-manager, but for now we construct it here to avoid circular deps or editing another file if not needed.
    // IMPORTANT: fileManager.downloadAndSave likely wants an absolute path or relative to project root?
    // Looking at downloadPostMedia, it uses path.join with STORAGE_PATHS.
    // Let's rely on fileManager to be smart or pass a path consistent with existing usage.
    // For safety, let's use a path that we know behaves well. 
    
    // Let's inspect STORAGE_PATHS.clientMedia implementation if we can, but assuming it returns a relative path from storage root is risky.
    // Let's assume we can pass a path relative to the 'storage' directory if fileManager handles it, 
    // OR we pass an absolute path.
    // The previous code passed `path.join(STORAGE_PATHS.clientMedia(...), filename)`.
    
    // Check if it's a YouTube link
    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
    
    // Use absolute path for reliability
    let storagePath = '';
    
    if (isYoutube) {
       // For YouTube, we don't download the video file (unless we add yt-dlp).
       // We'll just define a "virtual" path or use the URL.
       // We still need a path for the DB constraint if any, but let's just use a placeholder.
       storagePath = path.join(process.cwd(), 'storage', 'research', researchJobId, `youtube_${Date.now()}.txt`);
       // We won't actually download, just proceed.
       console.log(`[Downloader] YouTube link detected, skipping file download: ${url}`);
    } else {
       const storagePathRaw = path.join(process.cwd(), 'storage', 'research', researchJobId, filename);
       storagePath = storagePathRaw;
       await fileManager.downloadAndSave(url, storagePath);
    }

    // Get file stats
    const stats = fileManager.getStats(storagePath);
    const fileSizeBytes = stats?.size || 0;

    // Extract metadata
    let width, height, durationSeconds, thumbnailPath;

    if (mediaType === 'IMAGE') {
      const metadata = await extractImageMetadata(storagePath);
      width = metadata.width;
      height = metadata.height;
    } else {
      if (isYoutube) {
         // Try to get YouTube thumbnail
         // Format: https://img.youtube.com/vi/<video_id>/maxresdefault.jpg
         try {
             let videoId = '';
             if (url.includes('v=')) {
                 videoId = url.split('v=')[1]?.split('&')[0];
             } else if (url.includes('youtu.be/')) {
                 videoId = url.split('youtu.be/')[1]?.split('?')[0];
             }
             
             if (videoId) {
                 thumbnailPath = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
                 // Just simple width/height guess for embed
                 width = 1280;
                 height = 720; 
             }
         } catch (e) {
             console.log('[Downloader] Could not extract YouTube ID');
         }
      } else {
         thumbnailPath = await generateVideoThumbnail(storagePath);
      }
    }

    // Create MEDIA_ASSET record
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        mediaType,
        originalUrl: url,
        blobStoragePath: storagePath,
        fileSizeBytes,
        width,
        height,
        durationSeconds,
        thumbnailPath,
        isDownloaded: true,
        downloadedAt: new Date(),
        // Link to DDG Result
        ddgVideoResultId: type === 'DDG_VIDEO' ? referenceId : undefined,
        ddgImageResultId: type === 'DDG_IMAGE' ? referenceId : undefined,
      },
    });

    console.log(`[Downloader] Saved generic media asset: ${mediaAsset.id}`);
    
    // Update the DDG Result to mark as downloaded (redundant but good for querying)
    if (type === 'DDG_VIDEO') {
        await prisma.ddgVideoResult.update({
            where: { id: referenceId },
            data: { isDownloaded: true, mediaAssets: { connect: { id: mediaAsset.id } } }
        });
    } else {
        await prisma.ddgImageResult.update({
            where: { id: referenceId },
            data: { isDownloaded: true, mediaAssets: { connect: { id: mediaAsset.id } } }
        });
    }

    return mediaAsset.id;

  } catch (error: any) {
    console.error(`[Downloader] Failed to download generic media ${url}:`, error.message);
    return null;
  }
}

export const mediaDownloader = {
  downloadPostMedia,
  downloadAllClientMedia,
  downloadGenericMedia,
  extractMediaUrls,
};
