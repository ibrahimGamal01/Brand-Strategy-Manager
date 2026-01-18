
import { prisma } from '../../lib/prisma';
import { mediaDownloader } from './downloader';

/**
 * Service to process pending DuckDuckGo search results and download their media.
 */
export class DdgDoownloaderService {
  
  /**
   * Process all pending downloads for a specific research job or all jobs.
   * @param researchJobId Optional: Limit to specific job
   * @param limit Max items to download in this batch (default 50)
   */
  async processPendingDownloads(researchJobId?: string, limit: number = 50) {
    console.log(`[DdgDownloader] Checking for pending downloads...`);

    // 1. Process Pending Images
    const pendingImages = await prisma.ddgImageResult.findMany({
      where: {
        isDownloaded: false,
        researchJobId: researchJobId,
      },
      take: limit,
    });

    console.log(`[DdgDownloader] Found ${pendingImages.length} pending images.`);
    
    for (const img of pendingImages) {
        if (!img.imageUrl) continue;
        await mediaDownloader.downloadGenericMedia(
            img.imageUrl,
            img.id,
            'DDG_IMAGE',
            img.researchJobId
        );
    }

    // 2. Process Pending Videos
    // Note: DDG videos might point to YouTube/embeds which are harder to "download" as files.
    // For now we attempt it, but simple file download might fail for YouTube.
    // We should filter for likely downloadable URLs (mp4, webm) or implement yt-dlp later.
    const pendingVideos = await prisma.ddgVideoResult.findMany({
      where: {
        isDownloaded: false,
        researchJobId: researchJobId,
        // Simple filter for direct files for now to avoid errors on YouTube links
        // OR we just try and fail gracefully.
        // url: { contains: '.mp4' } 
      },
      take: limit,
    });

    console.log(`[DdgDownloader] Found ${pendingVideos.length} pending videos.`);

    for (const vid of pendingVideos) {
        if (!vid.url) continue;
        
        // Skip videos longer than 10 minutes (duration format: "MM:SS" or "H:MM:SS")
        if (vid.duration) {
            const parts = vid.duration.split(':').map(p => parseInt(p, 10));
            let totalSeconds = 0;
            if (parts.length === 2) {
                totalSeconds = parts[0] * 60 + parts[1]; // MM:SS
            } else if (parts.length >= 3) {
                totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]; // H:MM:SS
            }
            if (totalSeconds > 600) { // 10 minutes = 600 seconds
                console.log(`[DdgDownloader] Skipping video (too long: ${vid.duration}): ${vid.title?.slice(0, 50)}`);
                // Mark as downloaded to skip in future runs
                await prisma.ddgVideoResult.update({
                    where: { id: vid.id },
                    data: { isDownloaded: true }
                });
                continue;
            }
        }
        
        // Check for YouTube links to log them, but allow them to proceed
        if (vid.url.includes('youtube.com') || vid.url.includes('youtu.be')) {
            console.log(`[DdgDownloader] Processing YouTube link: ${vid.url}`);
            // Let it fall through to downloadGenericMedia which now handles it
        }

        await mediaDownloader.downloadGenericMedia(
            vid.url,
            vid.id,
            'DDG_VIDEO',
            vid.researchJobId
        );
    }
  }
}

export const ddgDownloaderService = new DdgDoownloaderService();
