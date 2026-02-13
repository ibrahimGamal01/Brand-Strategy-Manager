import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { fileManager } from '../services/storage/file-manager';
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

    // REMOVED: Allow scraping ANY competitor regardless of state or availability
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

function pathToUrl(p: string | null | undefined): string | null {
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return fileManager.toUrl(p);
}

/**
 * GET /api/competitors/discovered/:id/posts
 * Get all scraped posts for a discovered competitor.
 * Merges CleanedPost with CompetitorPostSnapshot media when CleanedPost lacks thumbnails.
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

    // Fallback: fetch CompetitorPostSnapshot media for posts that lack thumbnails
    const externalIdsNeedingMedia = posts
      .filter((p) => !p.mediaAssets?.length)
      .map((p) => p.externalPostId);

    let snapshotMediaByExternalId: Record<string, { thumbnailUrl: string | null }> = {};
    if (externalIdsNeedingMedia.length > 0) {
      const snapshotPosts = await prisma.competitorPostSnapshot.findMany({
        where: {
          externalPostId: { in: externalIdsNeedingMedia },
          competitorProfileSnapshot: {
            competitorProfile: {
              competitorId: discovered.competitorId,
            },
          },
        },
        include: {
          mediaAssets: true,
        },
      });

      for (const sp of snapshotPosts) {
        const media = sp.mediaAssets?.[0];
        const thumb = pathToUrl(media?.thumbnailPath || media?.blobStoragePath);
        if (thumb && !snapshotMediaByExternalId[sp.externalPostId]) {
          snapshotMediaByExternalId[sp.externalPostId] = { thumbnailUrl: thumb };
        }
      }
    }

    // Transform posts to match frontend expectations
    const transformedPosts = posts.map((post) => {
      const mediaAsset = post.mediaAssets?.[0];
      const thumbnailUrl =
        pathToUrl(mediaAsset?.thumbnailPath || mediaAsset?.blobStoragePath) ||
        snapshotMediaByExternalId[post.externalPostId]?.thumbnailUrl ||
        null;

      return {
        id: post.id,
        caption: post.caption || '',
        thumbnailUrl,
        postUrl: post.postUrl || '',
        likesCount: post.likes || 0,
        commentsCount: post.comments || 0,
        viewsCount: 0,
        postedAt: post.postedAt,
        createdAt: post.cleanedAt,
      };
    });

    res.json({
      success: true,
      competitor: {
        id: discovered.id,
        handle: discovered.handle,
        platform: discovered.platform,
        competitorId: discovered.competitorId,
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

/**
 * PATCH /api/competitors/discovered/:id/state
 * Update competitor selection state manually
 */
router.patch('/discovered/:id/state', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { selectionState, reason } = req.body;

    if (!selectionState) {
      return res.status(400).json({ error: 'selectionState is required' });
    }

    // Validate state value
    const validStates = ['FILTERED_OUT', 'SHORTLISTED', 'TOP_PICK', 'APPROVED', 'REJECTED'];
    if (!validStates.includes(selectionState)) {
      return res.status(400).json({ 
        error: 'Invalid selectionState', 
        validStates 
      });
    }

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id },
      include: { researchJob: true },
    });

    if (!discovered) {
      return res.status(404).json({ error: 'Discovered competitor not found' });
    }

    // Update state
    const updated = await prisma.discoveredCompetitor.update({
      where: { id },
      data: {
        selectionState: selectionState as any,
        selectionReason: reason || `Manually set to ${selectionState}`,
        manuallyModified: true,
        lastModifiedAt: new Date(),
        lastModifiedBy: 'user', // TODO: Add actual user ID when auth is implemented
      },
    });

    // Emit research job event
    const { emitResearchJobEvent } = await import('../services/social/research-job-events');
    emitResearchJobEvent({
      researchJobId: discovered.researchJobId,
      source: 'competitors-api',
      code: 'competitor.state.manual_update',
      level: 'info',
      message: `Competitor state manually updated for @${discovered.handle}`,
      platform: discovered.platform,
      handle: discovered.handle,
      entityType: 'discovered_competitor',
      entityId: id,
      metadata: {
        oldState: discovered.selectionState,
        newState: selectionState,
        reason: reason || 'Manual update',
      },
    });

    console.log(`[Competitors API] Updated state for ${discovered.handle}: ${discovered.selectionState} -> ${selectionState}`);

    res.json({ 
      success: true, 
      competitor: updated 
    });
  } catch (error: any) {
    console.error('[Competitors API] Error updating state:', error);
    res.status(500).json({ error: 'Failed to update state', details: error.message });
  }
});

/**
 * PATCH /api/competitors/discovered/:id/order
 * Update competitor display order manually
 */
router.patch('/discovered/:id/order', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { displayOrder } = req.body;

    if (typeof displayOrder !== 'number') {
      return res.status(400).json({ error: 'displayOrder must be a number' });
    }

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id },
    });

    if (!discovered) {
      return res.status(404).json({ error: 'Discovered competitor not found' });
    }

    // Update order
    const updated = await prisma.discoveredCompetitor.update({
      where: { id },
      data: {
        displayOrder,
        manuallyModified: true,
        lastModifiedAt: new Date(),
        lastModifiedBy: 'user',
      },
    });

    console.log(`[Competitors API] Updated display order for ${discovered.handle}: ${displayOrder}`);

    res.json({ 
      success: true, 
      competitor: updated 
    });
  } catch (error: any) {
    console.error('[Competitors API] Error updating order:', error);
    res.status(500).json({ error: 'Failed to update order', details: error.message });
  }
});

/**
 * PATCH /api/competitors/discovered/batch/state
 * Batch update competitor states
 */
router.patch('/discovered/batch/state', async (req: Request, res: Response) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates must be a non-empty array' });
    }

    // Validate all updates
    const validStates = ['FILTERED_OUT', 'SHORTLISTED', 'TOP_PICK', 'APPROVED', 'REJECTED'];
    for (const update of updates) {
      if (!update.id || !update.selectionState) {
        return res.status(400).json({ error: 'Each update must have id and selectionState' });
      }
      if (!validStates.includes(update.selectionState)) {
        return res.status(400).json({ 
          error: `Invalid selectionState: ${update.selectionState}`, 
          validStates 
        });
      }
    }

    // Perform batch update
    const updatePromises = updates.map(async (update) => {
      const discovered = await prisma.discoveredCompetitor.findUnique({
        where: { id: update.id },
        include: { researchJob: true },
      });

      if (!discovered) {
        return { id: update.id, success: false, error: 'Not found' };
      }

      await prisma.discoveredCompetitor.update({
        where: { id: update.id },
        data: {
          selectionState: update.selectionState as any,
          selectionReason: update.reason || `Manually set to ${update.selectionState}`,
          manuallyModified: true,
          lastModifiedAt: new Date(),
          lastModifiedBy: 'user',
        },
      });

      // Emit event
      const { emitResearchJobEvent } = await import('../services/social/research-job-events');
      emitResearchJobEvent({
        researchJobId: discovered.researchJobId,
        source: 'competitors-api',
        code: 'competitor.state.batch_update',
        level: 'info',
        message: `Competitor state updated in batch for @${discovered.handle}`,
        platform: discovered.platform,
        handle: discovered.handle,
        entityType: 'discovered_competitor',
        entityId: update.id,
        metadata: {
          oldState: discovered.selectionState,
          newState: update.selectionState,
        },
      });

      return { id: update.id, success: true };
    });

    const results = await Promise.all(updatePromises);
    const successCount = results.filter(r => r.success).length;

    console.log(`[Competitors API] Batch updated ${successCount}/${updates.length} competitors`);

    res.json({ 
      success: true, 
      updatedCount: successCount,
      results 
    });
  } catch (error: any) {
    console.error('[Competitors API] Error in batch update:', error);
    res.status(500).json({ error: 'Failed to batch update', details: error.message });
  }
});

export default router;
