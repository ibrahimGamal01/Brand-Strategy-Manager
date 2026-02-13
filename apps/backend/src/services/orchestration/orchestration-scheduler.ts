import { prisma } from '../../lib/prisma';
import { runContinuousOrchestration } from './continuous-orchestrator';

let schedulerTimer: NodeJS.Timeout | null = null;
let isRunning = false;

const DEFAULT_INTERVAL_MINUTES = 15;
const MAX_CONCURRENT_JOBS = 3;

/**
 * Get orchestration interval from environment or config
 */
function getIntervalMs(): number {
  const minutes = Number(process.env.ORCHESTRATION_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES);
  return Math.max(1, minutes) * 60 * 1000;
}

/**
 * Process orchestration for all active research jobs
 */
async function processOrchestrationCycle(): Promise<void> {
  if (isRunning) {
    console.log('[OrchestrationScheduler] Previous cycle still running, skipping...');
    return;
  }

  isRunning = true;
  console.log('[OrchestrationScheduler] Starting orchestration cycle...');

  try {
    // Get all research jobs that are active (COMPLETE = data gathering done, per ResearchJobStatus enum)
    const activeJobs = await prisma.researchJob.findMany({
      where: {
        status: 'COMPLETE',
      },
      select: {
        id: true,
      },
      take: MAX_CONCURRENT_JOBS,
    });

    if (activeJobs.length === 0) {
      console.log('[OrchestrationScheduler] No active research jobs found');
      return;
    }

    console.log(`[OrchestrationScheduler] Processing ${activeJobs.length} research job(s)...`);

    // Process each job sequentially to avoid overwhelming the system
    for (const job of activeJobs) {
      try {
        await runContinuousOrchestration(job.id);
      } catch (error) {
        console.error(`[OrchestrationScheduler] Failed to process job ${job.id}:`, error);
        // Continue with next job even if this one fails
      }
    }

    console.log('[OrchestrationScheduler] Cycle complete');
  } catch (error) {
    console.error('[OrchestrationScheduler] Cycle failed:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the orchestration scheduler
 */
export function startOrchestrationScheduler(): void {
  if (schedulerTimer) {
    console.log('[OrchestrationScheduler] Already running');
    return;
  }

  const enabled = process.env.ORCHESTRATION_ENABLED !== 'false'; // Enabled by default
  
  if (!enabled) {
    console.log('[OrchestrationScheduler] Disabled via ORCHESTRATION_ENABLED env var');
    return;
  }

  const intervalMs = getIntervalMs();
  console.log(`[OrchestrationScheduler] Starting with ${intervalMs / 60000} minute interval`);

  // Run immediately on start
  void processOrchestrationCycle();

  // Then run on interval
  schedulerTimer = setInterval(() => {
    void processOrchestrationCycle();
  }, intervalMs);

  console.log('[OrchestrationScheduler] Started successfully');
}

/**
 * Stop the orchestration scheduler
 */
export function stopOrchestrationScheduler(): void {
  if (!schedulerTimer) {
    console.log('[OrchestrationScheduler] Not running');
    return;
  }

  clearInterval(schedulerTimer);
  schedulerTimer = null;
  console.log('[OrchestrationScheduler] Stopped');
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  enabled: boolean;
  intervalMinutes: number;
  cycleInProgress: boolean;
} {
  return {
    running: schedulerTimer !== null,
    enabled: process.env.ORCHESTRATION_ENABLED !== 'false',
    intervalMinutes: getIntervalMs() / 60000,
    cycleInProgress: isRunning,
  };
}
