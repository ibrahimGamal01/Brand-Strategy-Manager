import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { SocialScraperService } from '../services/scrapers/social-scraper';
import { tiktokService } from '../services/scraper/tiktok-service';

const router = Router();
const prisma = new PrismaClient();
const scraperService = new SocialScraperService();

/**
 * DELETE /api/tiktok/profile/:profileId
 * Delete all posts and data for a specific TikTok profile
 */
router.delete('/profile/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params;

    // Validate profileId
    const profile = await prisma.socialProfile.findUnique({
      where: { id: profileId },
      include: { posts: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Delete all posts (cascades via Prisma schema)
    const deletedCount = await prisma.socialPost.deleteMany({
      where: { socialProfileId: profileId }
    });

    // Update profile to reset metrics
    await prisma.socialProfile.update({
      where: { id: profileId },
      data: {
        lastScrapedAt: null,
        followers: 0,
        following: 0,
        postsCount: 0, // Reset post count
      }
    });

    console.log(`[TikTok] Deleted ${deletedCount.count} posts for profile ${profile.handle}`);

    res.json({
      success: true,
      deletedCount: deletedCount.count,
      message: `Successfully deleted ${deletedCount.count} posts for @${profile.handle}`
    });
  } catch (error: any) {
    console.error('[TikTok] Delete error:', error);
    res.status(500).json({ 
      error: 'Failed to delete profile data', 
      details: error.message 
    });
  }
});

/**
 * POST /api/tiktok/scrape/:profileId
 * Trigger re-scrape for a specific TikTok profile
 */
// POST /api/tiktok/scrape/:profileId
router.post('/scrape/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params;
    
    // Validate profileId and get profile
    const profile = await prisma.socialProfile.findUnique({
      where: { id: profileId },
      include: { researchJob: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (!profile.handle) {
      return res.status(400).json({ error: 'Profile has no handle' });
    }

    console.log(`[TikTok] Re-scraping @${profile.handle} for job ${profile.researchJobId}`);

    // Trigger scraping
    await tiktokService.scrapeAndSave(
      profile.researchJobId,
      profile.handle,
      30 // Default limit
    );

    res.json({
      success: true,
      message: `Successfully triggered scrape for @${profile.handle}`
    });

  } catch (error: any) {
    console.error('[TikTok] Re-scrape error:', error);
    res.status(500).json({ 
      error: 'Failed to re-scrape profile', 
      details: error.message 
    });
  }
});

export default router;
