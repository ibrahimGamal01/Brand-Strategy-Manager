import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

/**
 * GET /api/analytics/client/:clientId
 * Get aggregated analytics for client content
 */
router.get('/client/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { startDate, endDate, format } = req.query;

    // Build query filters
    const where: any = {
      clientAccount: { clientId },
    };

    if (startDate || endDate) {
      where.postedAt = {};
      if (startDate) where.postedAt.gte = new Date(startDate as string);
      if (endDate) where.postedAt.lte = new Date(endDate as string);
    }

    if (format) {
      where.format = format;
    }

    // Fetch posts
    const posts = await prisma.clientPost.findMany({
      where,
      include: { aiAnalyses: true },
    });

    // Calculate analytics
    const analytics = {
      totalPosts: posts.length,
      avgLikes: calculateAverage(posts, 'likes'),
      avgComments: calculateAverage(posts, 'comments'),
      avgEngagement: calculateAverage(posts, 'engagementRate'),
      formatDistribution: calculateDistribution(posts, 'format'),
      pillarDistribution: calculatePillarDistribution(posts),
      topPosts: posts
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 5)
        .map(p => ({
          id: p.id,
          caption: p.caption?.slice(0, 100),
          likes: p.likes,
          comments: p.comments,
          engagementRate: p.engagementRate,
        })),
    };

    res.json(analytics);
  } catch (error: any) {
    console.error('[Analytics API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics', details: error.message });
  }
});

/**
 * GET /api/analytics/client/:clientId/top-posts
 * Get top performing posts
 */
router.get('/client/:clientId/top-posts', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { metric = 'likes', limit = 10 } = req.query;

    const posts = await prisma.clientPost.findMany({
      where: { clientAccount: { clientId } },
      orderBy: { [metric as string]: 'desc' },
      take: Number(limit),
      include: {
        mediaAssets: true,
        aiAnalyses: true,
      },
    });

    res.json(posts);
  } catch (error: any) {
    console.error('[Analytics API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch top posts', details: error.message });
  }
});

/**
 * Helper functions
 */
function calculateAverage(posts: any[], field: string): number {
  if (posts.length === 0) return 0;
  const sum = posts.reduce((acc, post) => acc + (post[field] || 0), 0);
  return Math.round(sum / posts.length);
}

function calculateDistribution(posts: any[], field: string): Record<string, number> {
  const distribution: Record<string, number> = {};
  posts.forEach(post => {
    const value = post[field] || 'unknown';
    distribution[value] = (distribution[value] || 0) + 1;
  });
  return distribution;
}

function calculatePillarDistribution(posts: any[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  posts.forEach(post => {
    post.aiAnalyses?.forEach((analysis: any) => {
      const pillar = analysis.contentPillarDetected;
      if (pillar) {
        distribution[pillar] = (distribution[pillar] || 0) + 1;
      }
    });
  });
  return distribution;
}

export default router;
