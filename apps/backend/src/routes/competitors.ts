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

export default router;
