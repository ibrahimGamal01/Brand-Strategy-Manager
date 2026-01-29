
import { PrismaClient } from '@prisma/client';
import { mediaDownloader } from '../media/downloader';

const prisma = new PrismaClient();

export interface VisualAsset {
  id: string; // MediaAsset ID
  postId: string;
  url: string; // Storage path or URL
  thumbnailUrl: string | null;
  postUrl: string | null;
  platform: string;
  handle: string;
  type: 'image' | 'video';
  
  // Metrics
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagementScore: number;
}

/**
 * Service to aggregate visual assets for comparison
 * Focuses on Top 4 performing posts based on engagement
 */
export class VisualAggregationService {
  
  /**
   * Get the Top N performing visual assets for a research job
   * Formula: (likes) + (comments * 2) + (shares * 3) + (views * 0.05)
   */
  async getTopPerformingAssets(researchJobId: string, limit: number = 4): Promise<VisualAsset[]> {
    console.log(`[VisualAggregation] Fetching top ${limit} assets for job ${researchJobId}`);

    // 1. Fetch all posts for this job that HAVE downloaded media
    // We go: ResearchJob -> SocialProfile -> SocialPost -> MediaAsset
    const profiles = await prisma.socialProfile.findMany({
      where: { researchJobId },
      include: {
        posts: {
          where: {
            mediaAssets: {
                some: { isDownloaded: true } // Must have downloaded media
            }
          },
          include: {
            mediaAssets: true
          }
        }
      }
    });

    // 2. Flatten and Calculate Scores
    let allPosts: VisualAsset[] = [];

    for (const profile of profiles) {
      for (const post of profile.posts) {
        // Calculate Score
        const likes = post.likesCount || 0;
        const comments = post.commentsCount || 0;
        const shares = post.sharesCount || 0;
        const views = post.viewsCount || post.playsCount || 0;

        // Weighted engagement score
        // Comments/Shares are higher intent than likes
        const engagementScore = likes + (comments * 2) + (shares * 3) + (views * 0.05);

        // Get the best media asset (prefer video if video post, else image)
        // For simplicity, take the first valid one
        const asset = post.mediaAssets.find(m => m.isDownloaded);

        if (asset) {
          allPosts.push({
            id: asset.id,
            postId: post.id,
            url: asset.blobStoragePath ? `file://${asset.blobStoragePath}` : asset.originalUrl || '', // crude for now
            thumbnailUrl: asset.thumbnailPath || asset.originalUrl,
            postUrl: post.url,
            platform: profile.platform,
            handle: profile.handle,
            type: asset.mediaType === 'VIDEO' ? 'video' : 'image',
            likes,
            comments,
            shares,
            views,
            engagementScore
          });
        }
      }
    }

    // 3. Sort by Score Descending
    allPosts.sort((a, b) => b.engagementScore - a.engagementScore);

    // 4. Take Top N
    const topAssets = allPosts.slice(0, limit);
    
    console.log(`[VisualAggregation] Found ${allPosts.length} candidates, returning top ${topAssets.length}`);
    return topAssets;
  }
}

export const visualAggregationService = new VisualAggregationService();
