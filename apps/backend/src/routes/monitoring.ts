/**
 * Monitoring Routes
 * 
 * API endpoints for triggering and monitoring dailyscrapers
 */

import { Router, Request, Response } from 'express';
import { monitorClient, monitorAllClients, getStaleProfiles } from '../services/monitoring/monitoring-service';
import { startMonitoringScheduler, stopMonitoringScheduler, getSchedulerStatus, runMonitoringNow } from '../services/monitoring/monitoring-scheduler';
import { prisma } from '../lib/prisma';

const router = Router();

/**
 * POST /api/monitoring/run/:clientId
 * Manually trigger monitoring for a single client
 */
router.post('/run/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    
    console.log(`[API] Manual monitoring triggered for client ${clientId}`);
    const result = await monitorClient(clientId);
    
    res.json({ 
      success: true, 
      message: `Monitoring completed for client`,
      result 
    });
  } catch (error: any) {
    console.error('[API] Monitoring failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/monitoring/run-all
 * Manually trigger monitoring for all active clients
 */
router.post('/run-all', async (req: Request, res: Response) => {
  try {
    console.log(`[API] Manual monitoring triggered for all clients`);
    const { results, summary } = await runMonitoringNow();
    
    res.json({ 
      success: true, 
      message: `Monitoring completed for ${summary.totalClients} clients`,
      summary,
      results 
    });
  } catch (error: any) {
    console.error('[API] Monitoring all failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitoring/status
 * Get monitoring status and scheduler status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const schedulerStatus = getSchedulerStatus();
    
    // Get recent monitoring logs
    const recentLogs = await prisma.monitoringLog.findMany({
      take: 10,
      orderBy: { lastMonitoredAt: 'desc' },
      include: {
        client: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    // Get stale profiles count
    const staleProfiles = await getStaleProfiles(24);
    
    res.json({
      scheduler: schedulerStatus,
      recentLogs,
      staleProfilesCount: staleProfiles.length
    });
  } catch (error: any) {
    console.error('[API] Get status failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/monitoring/scheduler/start
 * Start the monitoring scheduler
 */
router.post('/scheduler/start', async (req: Request, res: Response) => {
  try {
    const config = req.body; // Optional: { cronExpression, timezone }
    startMonitoringScheduler(config);
    
    const status = getSchedulerStatus();
    res.json({ 
      success: true, 
      message: 'Scheduler started',
      status 
    });
  } catch (error: any) {
    console.error('[API] Start scheduler failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/monitoring/scheduler/stop
 * Stop the monitoring scheduler
 */
router.post('/scheduler/stop', async (req: Request, res: Response) => {
  try {
    stopMonitoringScheduler();
    res.json({ success: true, message: 'Scheduler stopped' });
  } catch (error: any) {
    console.error('[API] Stop scheduler failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
