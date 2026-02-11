import path from 'path';
import { prisma } from '../../lib/prisma';
import { fileManager } from '../storage/file-manager';
import { extractImageMetadata, generateVideoThumbnail } from './download-helpers';

export async function downloadGenericMedia(
  url: string,
  referenceId: string,
  type: 'DDG_VIDEO' | 'DDG_IMAGE',
  researchJobId: string
): Promise<string | null> {
  try {
    console.log(`[Downloader] Downloading generic media (${type}): ${url}`);

    const isVideo = type === 'DDG_VIDEO';
    const mediaType = isVideo ? 'VIDEO' : 'IMAGE';
    const extension = fileManager.getExtension(url) || (isVideo ? 'mp4' : 'jpg');
    const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;

    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
    let storagePath = '';

    if (isYoutube) {
      storagePath = path.join(process.cwd(), 'storage', 'research', researchJobId, `youtube_${Date.now()}.txt`);
      console.log(`[Downloader] YouTube link detected, skipping file download: ${url}`);
    } else {
      storagePath = path.join(process.cwd(), 'storage', 'research', researchJobId, filename);
      await fileManager.downloadAndSave(url, storagePath);
    }

    const stats = fileManager.getStats(storagePath);
    const fileSizeBytes = stats?.size || 0;

    let width, height, durationSeconds, thumbnailPath;

    if (mediaType === 'IMAGE') {
      const metadata = await extractImageMetadata(storagePath);
      width = metadata.width;
      height = metadata.height;
    } else {
      if (isYoutube) {
        try {
          let videoId = '';
          if (url.includes('v=')) videoId = url.split('v=')[1]?.split('&')[0];
          else if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1]?.split('?')[0];
          if (videoId) {
            thumbnailPath = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
            width = 1280;
            height = 720;
          }
        } catch {
          console.log('[Downloader] Could not extract YouTube ID');
        }
      } else {
        thumbnailPath = await generateVideoThumbnail(storagePath);
      }
    }

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
        ddgVideoResultId: type === 'DDG_VIDEO' ? referenceId : undefined,
        ddgImageResultId: type === 'DDG_IMAGE' ? referenceId : undefined,
      },
    });

    if (type === 'DDG_VIDEO') {
      await prisma.ddgVideoResult.update({
        where: { id: referenceId },
        data: { isDownloaded: true, mediaAssets: { connect: { id: mediaAsset.id } } },
      });
    } else {
      await prisma.ddgImageResult.update({
        where: { id: referenceId },
        data: { isDownloaded: true, mediaAssets: { connect: { id: mediaAsset.id } } },
      });
    }

    return mediaAsset.id;
  } catch (error: any) {
    console.error(`[Downloader] Failed to download generic media ${url}:`, error.message);
    return null;
  }
}
