import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { runContinuousOrchestration } from '../services/orchestration/continuous-orchestrator';
import { getSchedulerStatus } from '../services/orchestration/orchestration-scheduler';

const router = Router();

/**
 * GET /api/research-jobs/:id/orchestration/status
 * Get current orchestration status and gaps for a research job
 */
router.get('/:id/orchestration/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get last orchestration event
    const lastEvent = await prisma.researchJobEvent.findFirst({
      where: {
        researchJobId: id,
        code: 'orchestration.cycle.completed',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get scheduler status
    const schedulerStatus = getSchedulerStatus();

    res.json({
      success: true,
      schedulerRunning: schedulerStatus.running,
      lastCheck: lastEvent?.createdAt || null,
      lastMetrics: lastEvent?.metrics || null,
      intervalMinutes: schedulerStatus.intervalMinutes,
    });
  } catch (error: any) {
    console.error('[Orchestration API] Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status', details: error.message });
  }
});

/**
 * POST /api/research-jobs/:id/orchestration/run
 * Manually trigger an orchestration cycle
 */
router.post('/:id/orchestration/run', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify job exists
    const job = await prisma.researchJob.findUnique({
      where: { id },
    });

    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }

    console.log(`[Orchestration API] Manually triggering orchestration for job ${id}`);

    // Run orchestration in background
    runContinuousOrchestration(id)
      .then((result) => {
        console.log(`[Orchestration API] Manual orchestration complete for job ${id}`);
      })
      .catch((error) => {
        console.error(`[Orchestration API] Manual orchestration failed for job ${id}:`, error);
      });

    res.json({
      success: true,
      message: 'Orchestration cycle started',
    });
  } catch (error: any) {
    console.error('[Orchestration API] Error triggering orchestration:', error);
    res.status(500).json({ error: 'Failed to trigger orchestration', details: error.message });
  }
});

/**
 * GET /api/research-jobs/:id/orchestration/history
 * Get orchestration history
 */
router.get('/:id/orchestration/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const events = await prisma.researchJobEvent.findMany({
      where: {
        researchJobId: id,
        code: { in: ['orchestration.cycle.completed', 'orchestration.cycle.failed'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const history = events.map((event) => ({
      timestamp: event.createdAt,
      success: event.code === 'orchestration.cycle.completed',
      metrics: event.metrics,
      message: event.message,
    }));

    res.json({
      success: true,
      history,
      total: events.length,
    });
  } catch (error: any) {
    console.error('[Orchestration API] Error getting history:', error);
    res.status(500).json({ error: 'Failed to get history', details: error.message });
  }
});

export default router;
