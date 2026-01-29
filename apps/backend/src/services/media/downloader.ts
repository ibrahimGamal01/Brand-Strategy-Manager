import axios from 'axios';
import path from 'path';
import { fileManager, STORAGE_PATHS } from '../storage/file-manager';
import { prisma } from '../../lib/prisma';
import sharp from 'sharp';
import fs from 'fs'; 
import { tiktokService } from '../scraper/tiktok-service';
import { exec } from 'child_process';

/**
 * Download media assets for a post and save to storage
 */
export async function downloadPostMedia(
  postId: string,
  mediaUrls: string[],
  entityType: 'CLIENT' | 'COMPETITOR' | 'SOCIAL',
  entityId: string
): Promise<string[]> {
  const mediaAssetIds: string[] = [];

  for (const url of mediaUrls) {
    if (!url) continue;

    try {
      console.log(`[Downloader] Downloading: ${url}`);

      // Determine media type
      const isVideo = url.includes('.mp4') || url.includes('video') || url.includes('tiktok.com');
      const mediaType = isVideo ? 'VIDEO' : 'IMAGE';

      // Generate storage path
      // Generate storage path
      let extension = fileManager.getExtension(url);
      
      // Fix: Ensure video platforms get mp4 extension even if getExtension defaults to jpg
      if (isVideo) {
          extension = 'mp4';
      }
      
      if (!extension) extension = 'jpg';

      const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
      
      // Logic for path construction
      let storagePath = '';
      if (entityType === 'CLIENT') {
          storagePath = path.join(STORAGE_PATHS.clientMedia(entityId, postId), filename);
      } else if (entityType === 'COMPETITOR') {
          storagePath = path.join(STORAGE_PATHS.competitorMedia(entityId, postId), filename);
      } else {
          // SOCIAL
          // Use competitor path logic for now as it groups by profileId
          storagePath = path.join(STORAGE_PATHS.competitorMedia(entityId, postId), filename);
      }

      // Download file with specific headers or specialized downlaoders
      if (url.includes('tiktok.com')) {
          // Use TikTok Python Downloader
          const result = await tiktokService.downloadVideo(url, storagePath);
          if (!result.success) {
              throw new Error(`TikTok download failed: ${result.error}`);
          }
      } else if (url.includes('instagram.com')) {
          // Instagram downloads often expire or need auth. 
          // For now, try standard download with headers, if fails, we might need a python fallback.
          await fileManager.downloadAndSave(url, storagePath, {
            'Referer': 'https://www.instagram.com/',
            'Origin': 'https://www.instagram.com'
         });
      } else {
          // Standard download
          await fileManager.downloadAndSave(url, storagePath, {
            'Referer': 'https://www.instagram.com/',
            'Origin': 'https://www.instagram.com'
        });
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
        // Correctly set thumbnail path for images (same as source) so frontend picks it up preferentially
        thumbnailPath = fileManager.toUrl(storagePath); 
      } else {
        // For videos, extract first frame as thumbnail
        thumbnailPath = await generateVideoThumbnail(storagePath);
      }

      // Create MEDIA_ASSET record
      const mediaAssetData: any = {
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
      };

      if (entityType === 'CLIENT') {
          mediaAssetData.clientPostId = postId;
      } else if (entityType === 'COMPETITOR') {
          mediaAssetData.cleanedPostId = postId;
      } else if (entityType === 'SOCIAL') {
          mediaAssetData.socialPostId = postId;
      }

      const mediaAsset = await prisma.mediaAsset.create({
        data: mediaAssetData,
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
  try {
    const thumbnailFilename = path.basename(videoPath, path.extname(videoPath)) + '_thumb.jpg';
    const thumbnailPath = path.join(path.dirname(videoPath), thumbnailFilename);
    
    // Use ffmpeg to extract first frame
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
        await downloadPostMedia(post.id, mediaUrls, 'CLIENT', clientId);
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
 * Download all media for a specific Social Profile (Research)
 */
export async function downloadSocialProfileMedia(profileId: string) {
    console.log(`[Downloader] Downloading media for profile ${profileId}`);

    // Get posts that don't have media assets yet
    const posts = await prisma.socialPost.findMany({
        where: {
            socialProfileId: profileId,
            mediaAssets: {
                none: {}
            }
        }
    });

    console.log(`[Downloader] Found ${posts.length} posts without media assets`);

    let downloadedCount = 0;
    const processedUrls = new Set<string>(); // Track URLs to prevent duplicates

    for (const post of posts) {
        try {
            const urlsToDownload: string[] = [];
            
            // Prefer explicit URL from fields if available, otherwise heuristics
            // For now, SocialPost URL is often the post URL itself (e.g. tiktok video link)
            // or we might have a specific media URL in `thumbnailUrl` (which is often just a static image).
            
            if (post.url && post.url.includes('tiktok.com')) {
                // Skip if we already processed this URL
                if (!processedUrls.has(post.url)) {
                    urlsToDownload.push(post.url);
                    processedUrls.add(post.url);
                    console.log(`[Downloader] Queued TikTok video: ${post.url}`);
                } else {
                    console.log(`[Downloader] Skipping duplicate URL: ${post.url}`);
                }
            } else if (post.thumbnailUrl) { // Often holds the media URL for Instagram
                if (!processedUrls.has(post.thumbnailUrl)) {
                    urlsToDownload.push(post.thumbnailUrl);
                    processedUrls.add(post.thumbnailUrl);
                    console.log(`[Downloader] Queued Instagram media: ${post.thumbnailUrl}`);
                }
            }

            if (urlsToDownload.length > 0) {
                 await downloadPostMedia(post.id, urlsToDownload, 'SOCIAL', profileId);
                 downloadedCount++;
                 console.log(`[Downloader] Downloaded media for post ${post.externalId} (${downloadedCount}/${posts.length})`);
            } else {
                 console.log(`[Downloader] No media URL found for post ${post.externalId}`);
            }
            
        } catch (error: any) {
             console.error(`[Downloader] Error downloading media for social post ${post.id}:`, error.message);
        }
    }
    
    console.log(`[Downloader] Downloaded ${downloadedCount} new assets for profile ${profileId}`);
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
    const extension = fileManager.getExtension(url) || (isVideo ? 'mp4' : 'jpg');
    const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    
    // Check if it's a YouTube link
    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
    
    // Use absolute path for reliability
    let storagePath = '';
    
    if (isYoutube) {
       storagePath = path.join(process.cwd(), 'storage', 'research', researchJobId, `youtube_${Date.now()}.txt`);
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
         try {
             let videoId = '';
             if (url.includes('v=')) {
                 videoId = url.split('v=')[1]?.split('&')[0];
             } else if (url.includes('youtu.be/')) {
                 videoId = url.split('youtu.be/')[1]?.split('?')[0];
             }
             
             if (videoId) {
                 thumbnailPath = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
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
  downloadSocialProfileMedia,
  downloadGenericMedia,
  extractMediaUrls,
};
