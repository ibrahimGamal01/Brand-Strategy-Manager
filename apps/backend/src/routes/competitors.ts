import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { competitorAnalyzer } from '../services/ai/competitor-analyzer';

const router = Router();

/**
 * GET /api/competitors/client/:clientId
 * List all competitors (discovered + confirmed) for a client
 */
router.get('/client/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;

    const discovered = await prisma.discoveredCompetitor.findMany({
      where: { researchJob: { clientId } },
      include: { competitor: true },
      orderBy: { relevanceScore: 'desc' },
    });

    const confirmed = await prisma.competitor.findMany({
      where: { clientId },
    });

    res.json({
      discovered,
      confirmed,
    });
  } catch (error: any) {
    console.error('[Competitors API] Error fetching competitors:', error);
    res.status(500).json({ error: 'Failed to fetch competitors', details: error.message });
  }
});

/**
 * POST /api/competitors/discovered/:id/scrape
 * Trigger scraping for a discovered competitor
 */
router.post('/discovered/:id/scrape', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const forceUnavailable = Boolean(req.body?.forceUnavailable);

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id },
      include: { researchJob: true },
    });

    if (!discovered) {
      return res.status(404).json({ error: 'Discovered competitor not found' });
    }

    const selectionState = String(discovered.selectionState || '').toUpperCase();
    if (selectionState === 'FILTERED_OUT' || selectionState === 'REJECTED') {
      return res.status(409).json({
        success: false,
        error: 'FILTERED_COMPETITOR',
        message: 'Filtered/rejected competitors are not scrape-eligible',
      });
    }

    if (!forceUnavailable && discovered.availabilityStatus !== 'VERIFIED') {
      return res.status(409).json({
        success: false,
        error: 'PROFILE_UNAVAILABLE',
        message: `Profile is not scrape-ready (${discovered.availabilityStatus})`,
      });
    }

    console.log(`[Competitors API] Triggering scrape for ${discovered.handle} (${discovered.platform})`);

    // Import scraper and trigger background scraping
    const { scrapeCompetitorsIncremental } = await import('../services/discovery/competitor-scraper');
    
    // Trigger scraping in background (don't await)
    scrapeCompetitorsIncremental(discovered.researchJobId, [{
      id: discovered.id,
      handle: discovered.handle,
      platform: discovered.platform
    }]).catch(error => {
      console.error(`[Competitors API] Background scraping failed for ${discovered.handle}:`, error);
    });

    res.json({ 
      success: true, 
      message: `Scraping started for ${discovered.handle}`,
      competitorId: id
    });
  } catch (error: any) {
    console.error('[Competitors API] Error triggering scrape:', error);
    res.status(500).json({ error: 'Failed to trigger scrape', details: error.message });
  }
});

/**
 * POST /api/competitors/discovered/:id/confirm
 * Confirm a discovered competitor and create competitor record
 */
router.post('/discovered/:id/confirm', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id },
      include: { researchJob: true },
    });

    if (!discovered) {
      return res.status(404).json({ error: 'Discovered competitor not found' });
    }

    // Create Competitor record
    const competitor = await prisma.competitor.create({
      data: {
        clientId: discovered.researchJob.clientId,
        handle: discovered.handle,
        platform: discovered.platform,
        isPriority: false,
      },
    });

    // Update discovered competitor
    await prisma.discoveredCompetitor.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        competitorId: competitor.id,
      },
    });

    console.log(`[Competitors API] Confirmed competitor: ${competitor.handle}`);

    res.json({ success: true, competitor });
  } catch (error: any) {
    console.error('[Competitors API] Error confirming competitor:', error);
    res.status(500).json({ error: 'Failed to confirm competitor', details: error.message });
  }
});

/**
 * GET /api/competitors/discovered/:id/posts
 * Get all scraped posts for a discovered competitor
 */
router.get('/discovered/:id/posts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id },
    });

    if (!discovered) {
      return res.status(404).json({ error: 'Discovered competitor not found' });
    }

    // Check if competitor record exists
    if (!discovered.competitorId) {
      return res.json({
        competitor: { id: discovered.id, handle: discovered.handle, platform: discovered.platform },
        posts: [],
        total: 0,
        message: 'No competitor record linked yet - posts will appear after scraping',
      });
    }

    // Get cleaned posts for this competitor
    const posts = await prisma.cleanedPost.findMany({
      where: { competitorId: discovered.competitorId },
      include: {
        mediaAssets: true,
      },
      orderBy: { postedAt: 'desc' },
      take: 100,
    });

    // Transform posts with engagement metrics
    const transformedPosts = posts.map(post => {
      const mediaAsset = post.mediaAssets?.[0];
      const isVideo = mediaAsset?.mediaType === 'VIDEO';
      
      return {
        id: post.id,
        caption: post.caption || '',
        likes: post.likes || 0,
        comments: post.comments || 0,
        views: 0,  // Not stored in CleanedPost
        shares: post.shares || 0,
        saves: post.saves || 0,
        postUrl: post.postUrl || '',
        mediaUrl: mediaAsset?.blobStoragePath || null,
        videoUrl: isVideo ? mediaAsset?.blobStoragePath : null,
        isVideo,
        timestamp: post.postedAt?.toISOString() || post.cleanedAt.toISOString(),
        engagement: post.engagementRate || 0,
      };
    });

    res.json({
      competitor: {
        id: discovered.id,
        handle: discovered.handle,
        platform: discovered.platform,
        competitorId: discovered.competitorId, // Add this for debugging
      },
      posts: transformedPosts,
      total: transformedPosts.length,
    });
  } catch (error: any) {
    console.error('[Competitors API] Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts', details: error.message });
  }
});

/**
 * POST /api/competitors/discovered/:id/reject
 * Reject a discovered competitor
 */
router.post('/discovered/:id/reject', async (req: Request, res: Response) => {
  try {
    await prisma.discoveredCompetitor.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED' },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Competitors API] Error rejecting competitor:', error);
    res.status(500).json({ error: 'Failed to reject competitor', details: error.message });
  }
});

/**
 * GET /api/competitors/:competitorId
 * Get competitor details with posts
 */
router.get('/:competitorId', async (req: Request, res: Response) => {
  try {
    const competitor = await prisma.competitor.findUnique({
      where: { id: req.params.competitorId },
      include: {
        rawPosts: {
          include: {
            cleanedPost: {
              include: {
                mediaAssets: true,
                aiAnalyses: true,
              },
            },
          },
          take: 50,
          orderBy: { scrapedAt: 'desc' },
        },
      },
    });

    if (!competitor) {
      return res.status(404).json({ error: 'Competitor not found' });
    }

    res.json(competitor);
  } catch (error: any) {
    console.error('[Competitors API] Error fetching competitor:', error);
    res.status(500).json({ error: 'Failed to fetch competitor', details: error.message });
  }
});

/**
 * GET /api/competitors/:competitorId/analysis
 * Get competitive gap analysis
 */
router.get('/:competitorId/analysis', async (req: Request, res: Response) => {
  try {
    const competitor = await prisma.competitor.findUnique({
      where: { id: req.params.competitorId },
    });

    if (!competitor) {
      return res.status(404).json({ error: 'Competitor not found' });
    }

    console.log(`[Competitors API] Running analysis for competitor ${competitor.handle}`);

    const analysis = await competitorAnalyzer.compareWithCompetitor(
      competitor.clientId,
      req.params.competitorId
    );

    res.json(analysis);
  } catch (error: any) {
    console.error('[Competitors API] Error running analysis:', error);
    res.status(500).json({ error: 'Failed to run analysis', details: error.message });
  }
});

/**
 * DELETE /api/competitors/discovered/:id/posts
 * Delete all posts for a specific competitor
 */
router.delete('/discovered/:id/posts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id },
      include: { competitor: true }
    });

    if (!discovered) {
      return res.status(404).json({ error: 'Competitor not found' });
    }

    if (!discovered.competitorId) {
       // Just a suggestion with no data yet, reset stats
       await prisma.discoveredCompetitor.update({
         where: { id },
         data: { postsScraped: 0, scrapedAt: null }
       });
       return res.json({ success: true, message: 'Reset competitor stats', deletedCount: 0 });
    }

    // Delete associated posts
    // Note: CleanedPost cascades from RawPost usually, but we deletes both to be safe/thorough
    // or if cascade is not set up that way.
    const rawDeleted = await prisma.rawPost.deleteMany({
      where: { competitorId: discovered.competitorId }
    });
    
    // Also try delete cleaned posts directly if any exist without raw links (orphaned)
    const cleanedDeleted = await prisma.cleanedPost.deleteMany({
      where: { competitorId: discovered.competitorId }
    });

    // Reset stats
    await prisma.discoveredCompetitor.update({
      where: { id },
      data: {
        postsScraped: 0,
        scrapedAt: null,
        lastCheckedAt: null
      }
    });
    
    // Also reset main competitor stats
    await prisma.competitor.update({
      where: { id: discovered.competitorId },
      data: {
        lastScrapedAt: null
      }
    });

    console.log(`[Competitors API] Deleted ${rawDeleted.count} raw posts for competitor ${discovered.handle}`);

    res.json({
      success: true,
      deletedCount: rawDeleted.count,
      deletedCleaned: cleanedDeleted.count,
      message: `Deleted posts for ${discovered.handle}`
    });
  } catch (error: any) {
    console.error('[Competitors API] Error deleting posts:', error);
    res.status(500).json({ error: 'Failed to delete posts', details: error.message });
  }
});

export default router;
