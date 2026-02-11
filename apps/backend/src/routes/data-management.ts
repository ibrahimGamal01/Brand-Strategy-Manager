import { Router, NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// Map URL slugs to Prisma delegates and ID fields
const TYPE_CONFIG: Record<string, { model: keyof typeof prisma, idField?: string }> = {
  'search-results': { model: 'rawSearchResult' },
  'images': { model: 'ddgImageResult' },
  'videos': { model: 'ddgVideoResult' },
  'news': { model: 'ddgNewsResult' },
  'trends': { model: 'searchTrend' },
  'competitors': { model: 'discoveredCompetitor' },
  'community-insights': { model: 'communityInsight' },
  'ai-questions': { model: 'aiQuestion' },
  'media-assets': { model: 'mediaAsset' },
  'social-profiles': { model: 'clientAccount' }
};

// Helper to get prisma delegate
function getDelegate(type: string) {
  const config = TYPE_CONFIG[type];
  if (!config) return null;
  return (prisma as any)[config.model];
}

/**
 * PUT /:jobId/:dataType/:itemId
 * Update an item
 */
router.put('/:jobId/:dataType/:itemId', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId, dataType, itemId } = req.params;
  const updates = req.body;

  try {
    const delegate = getDelegate(dataType);
    if (!delegate) {
       return next();
    }

    // Special handling for social profiles (ClientAccount)
    // They might not strictly belong to researchJobId in the same way, 
    // but usually we can just update by ID.
    // Most models have generic update(where: {id}, data: ...) signature.

    const updated = await delegate.update({
      where: { id: itemId },
      data: updates
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error(`[DataManagement] Update failed for ${dataType}/${itemId}:`, error);
    res.status(500).json({ error: error.message || 'Update failed' });
  }
});

/**
 * DELETE /:jobId/:dataType/:itemId
 * Delete an item
 */
router.delete('/:jobId/:dataType/:itemId', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId, dataType, itemId } = req.params;

  try {
    const delegate = getDelegate(dataType);
    if (!delegate) {
       return next();
    }

    await delegate.delete({
      where: { id: itemId }
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error(`[DataManagement] Delete failed for ${dataType}/${itemId}:`, error);
    res.status(500).json({ error: error.message || 'Delete failed' });
  }
});

/**
 * DELETE /:jobId/:dataType
 * Bulk-delete all items for this job + data type
 */
router.delete('/:jobId/:dataType', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId, dataType } = req.params;

  try {
    const delegate = getDelegate(dataType);
    if (!delegate) {
      return next();
    }

    if (dataType === 'social-profiles') {
      const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { clientId: true } });
      if (!job) throw new Error('Research job not found');

      const result = await delegate.deleteMany({
        where: { clientId: job.clientId },
      });
      return res.json({ success: true, deletedCount: result.count });
    }

    const result = await delegate.deleteMany({
      where: { researchJobId: jobId },
    });
    res.json({ success: true, deletedCount: result.count });
  } catch (error: any) {
    console.error(`[DataManagement] Bulk delete failed for ${dataType}:`, error);
    res.status(500).json({ error: error.message || 'Bulk delete failed' });
  }
});

/**
 * POST /:jobId/:dataType
 * Create an item
 */
router.post('/:jobId/:dataType', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId, dataType } = req.params;
  const data = req.body;

  try {
    const delegate = getDelegate(dataType);
    if (!delegate) {
       return next();
    }

    // Most models need researchJobId, except ClientAccount (uses clientId)
    const createData = { ...data };
    
    if (dataType === 'social-profiles') {
        // ClientAccount needs clientId. We need to find the clientId from the researchJob
        const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { clientId: true } });
        if (!job) throw new Error('Research job not found');
        createData.clientId = job.clientId;
    } else {
        createData.researchJobId = jobId;
    }

    const created = await delegate.create({
      data: createData
    });

    res.json({ success: true, data: created });
  } catch (error: any) {
    console.error(`[DataManagement] Create failed for ${dataType}:`, error);
    res.status(500).json({ error: error.message || 'Create failed' });
  }
});

/**
 * GET /:jobId/:dataType
 * List items (Optional, mostly handled by main job GET but useful for pagination/refresh)
 */
router.get('/:jobId/:dataType', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId, dataType } = req.params;
  
  try {
     const delegate = getDelegate(dataType);
    if (!delegate) {
       return next();
    }

    let items;
    if (dataType === 'social-profiles') {
        const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { clientId: true } });
         if (!job) throw new Error('Research job not found');
        items = await delegate.findMany({ where: { clientId: job.clientId } });
    } else {
        items = await delegate.findMany({ where: { researchJobId: jobId } });
    }

     res.json({ success: true, data: items });
  } catch (error: any) {
    console.error(`[DataManagement] List failed for ${dataType}:`, error);
    res.status(500).json({ error: error.message || 'List failed' });
  }
});

export default router;
