import { prisma } from '../../lib/prisma';
import { scrapeProfileSafe } from './scraper';
import { randomUUID } from 'crypto';
import { emitResearchJobEvent } from './research-job-events';

const MIN_CONTINUITY_INTERVAL_HOURS = 2;
const DEFAULT_CONTINUITY_INTERVAL_HOURS = 2;
const DEFAULT_POLL_MS = 60_000;

const inFlightJobs = new Set<string>();
let loopTimer: NodeJS.Timeout | null = null;
let loopRunning = false;

type ContinueTrigger = 'manual' | 'scheduler';

type ContinueJobResult = {
  success: boolean;
  partial: boolean;
  trigger: ContinueTrigger;
  jobId: string;
  runId: string;
  clientProfilesAttempted: number;
  competitorProfilesAttempted: number;
  errors: string[];
};

function normalizeIntervalHours(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CONTINUITY_INTERVAL_HOURS;
  return Math.max(MIN_CONTINUITY_INTERVAL_HOURS, parsed);
}

function nextRunFromNow(intervalHours: number): Date {
  return new Date(Date.now() + intervalHours * 60 * 60 * 1000);
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function dedupeTargets(targets: Array<{ platform: string; handle: string }>) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.platform}:${target.handle}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectClientTargets(job: any): Array<{ platform: string; handle: string }> {
  const targets: Array<{ platform: string; handle: string }> = [];

  for (const account of job.client?.clientAccounts || []) {
    if (!account?.handle || !account?.platform) continue;
    const platform = String(account.platform).toLowerCase();
    if (platform !== 'instagram' && platform !== 'tiktok') continue;
    targets.push({ platform, handle: String(account.handle).toLowerCase() });
  }

  const inputData = (job.inputData || {}) as any;
  if (inputData?.handles && typeof inputData.handles === 'object') {
    for (const [rawPlatform, rawHandle] of Object.entries(inputData.handles)) {
      if (typeof rawHandle !== 'string' || !rawHandle.trim()) continue;
      const platform = String(rawPlatform).toLowerCase();
      if (platform !== 'instagram' && platform !== 'tiktok') continue;
      targets.push({ platform, handle: rawHandle.replace(/^@+/, '').toLowerCase().trim() });
    }
  } else if (inputData?.handle && inputData?.platform) {
    const platform = String(inputData.platform).toLowerCase();
    if ((platform === 'instagram' || platform === 'tiktok') && typeof inputData.handle === 'string') {
      targets.push({ platform, handle: inputData.handle.replace(/^@+/, '').toLowerCase().trim() });
    }
  }

  return dedupeTargets(targets);
}

export async function configureResearchJobContinuity(
  jobId: string,
  input: { enabled?: boolean; intervalHours?: number }
) {
  const job = await prisma.researchJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Research job not found');

  const nextData: any = {};
  const intervalHours =
    input.intervalHours !== undefined
      ? normalizeIntervalHours(input.intervalHours)
      : normalizeIntervalHours((job as any).continuityIntervalHours);

  if (input.intervalHours !== undefined) {
    nextData.continuityIntervalHours = intervalHours;
  }

  if (input.enabled !== undefined) {
    nextData.continuityEnabled = input.enabled;
    if (input.enabled) {
      nextData.continuityNextRunAt = nextRunFromNow(intervalHours);
    } else {
      nextData.continuityNextRunAt = null;
      nextData.continuityRunning = false;
    }
  } else if (input.intervalHours !== undefined && (job as any).continuityEnabled) {
    nextData.continuityNextRunAt = nextRunFromNow(intervalHours);
  }

  return prisma.researchJob.update({
    where: { id: jobId },
    data: nextData,
    select: {
      id: true,
      continuityEnabled: true,
      continuityIntervalHours: true,
      continuityLastRunAt: true,
      continuityNextRunAt: true,
      continuityRunning: true,
      continuityErrorMessage: true,
    },
  });
}

export async function continueResearchJob(
  jobId: string,
  trigger: ContinueTrigger = 'manual'
): Promise<ContinueJobResult> {
  const runId = randomUUID();

  if (inFlightJobs.has(jobId)) {
    return {
      success: false,
      partial: true,
      trigger,
      jobId,
      runId,
      clientProfilesAttempted: 0,
      competitorProfilesAttempted: 0,
      errors: ['Continuation already running for this job'],
    };
  }

  inFlightJobs.add(jobId);
  const errors: string[] = [];
  let clientProfilesAttempted = 0;
  let competitorProfilesAttempted = 0;
  let intervalHoursForNextRun = DEFAULT_CONTINUITY_INTERVAL_HOURS;

  try {
    const job = await prisma.researchJob.findUnique({
      where: { id: jobId },
      include: {
        client: { include: { clientAccounts: true } },
      },
    });

    if (!job) {
      return {
        success: false,
        partial: false,
        trigger,
        jobId,
        runId,
        clientProfilesAttempted: 0,
        competitorProfilesAttempted: 0,
        errors: ['Research job not found'],
      };
    }

    const intervalHours = normalizeIntervalHours((job as any).continuityIntervalHours);
    intervalHoursForNextRun = intervalHours;

    await prisma.researchJob.update({
      where: { id: jobId },
      data: {
        continuityRunning: true,
        continuityErrorMessage: null,
      },
    });

    emitResearchJobEvent({
      researchJobId: jobId,
      runId,
      source: 'continuity',
      code: 'continuity.started',
      level: 'info',
      message: `Continuity cycle started (${trigger})`,
      metrics: {
        trigger,
      },
    });

    const clientTargets = collectClientTargets(job);
    for (const target of clientTargets) {
      clientProfilesAttempted++;
      emitResearchJobEvent({
        researchJobId: jobId,
        runId,
        source: 'continuity',
        code: 'continuity.target.started',
        level: 'info',
        message: `Scraping client target ${target.platform} @${target.handle}`,
        platform: target.platform,
        handle: target.handle,
        entityType: 'client',
      });

      const result = await scrapeProfileSafe(jobId, target.platform, target.handle, {
        runId,
        source: 'continuity',
        entityType: 'client',
      });
      if (!result.success) {
        errors.push(`Client ${target.platform} @${target.handle}: ${result.error}`);
        emitResearchJobEvent({
          researchJobId: jobId,
          runId,
          source: 'continuity',
          code: 'continuity.target.failed',
          level: 'error',
          message: `Failed client target ${target.platform} @${target.handle}`,
          platform: target.platform,
          handle: target.handle,
          entityType: 'client',
          metadata: {
            error: result.error || 'Unknown scrape error',
          },
        });
      } else {
        emitResearchJobEvent({
          researchJobId: jobId,
          runId,
          source: 'continuity',
          code: 'continuity.target.succeeded',
          level: 'info',
          message: `Completed client target ${target.platform} @${target.handle}`,
          platform: target.platform,
          handle: target.handle,
          entityType: 'client',
          metrics: {
            postsScraped: result.data?.posts?.length ?? 0,
          },
        });
      }
    }

    const competitors = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId: jobId,
        platform: { in: ['instagram', 'tiktok'] },
        status: { in: ['SUGGESTED', 'SCRAPED', 'CONFIRMED'] },
        selectionState: { notIn: ['FILTERED_OUT', 'REJECTED'] },
      },
      orderBy: [{ relevanceScore: 'desc' }, { discoveredAt: 'asc' }],
      take: Math.max((job as any).competitorsToFind || 10, 10),
    });

    for (const competitor of competitors) {
      competitorProfilesAttempted++;
      emitResearchJobEvent({
        researchJobId: jobId,
        runId,
        source: 'continuity',
        code: 'continuity.target.started',
        level: 'info',
        message: `Scraping competitor target ${competitor.platform} @${competitor.handle}`,
        platform: competitor.platform,
        handle: competitor.handle,
        entityType: 'competitor',
        entityId: competitor.id,
      });

      const result = await scrapeProfileSafe(jobId, competitor.platform, competitor.handle, {
        runId,
        source: 'continuity',
        entityType: 'competitor',
        entityId: competitor.id,
      });
      if (!result.success) {
        errors.push(`Competitor ${competitor.platform} @${competitor.handle}: ${result.error}`);
        emitResearchJobEvent({
          researchJobId: jobId,
          runId,
          source: 'continuity',
          code: 'continuity.target.failed',
          level: 'error',
          message: `Failed competitor target ${competitor.platform} @${competitor.handle}`,
          platform: competitor.platform,
          handle: competitor.handle,
          entityType: 'competitor',
          entityId: competitor.id,
          metadata: {
            error: result.error || 'Unknown scrape error',
          },
        });
      } else {
        emitResearchJobEvent({
          researchJobId: jobId,
          runId,
          source: 'continuity',
          code: 'continuity.target.succeeded',
          level: 'info',
          message: `Completed competitor target ${competitor.platform} @${competitor.handle}`,
          platform: competitor.platform,
          handle: competitor.handle,
          entityType: 'competitor',
          entityId: competitor.id,
          metrics: {
            postsScraped: result.data?.posts?.length ?? 0,
          },
        });
      }
    }

    const completedAt = new Date();
    const nextRunAt = (job as any).continuityEnabled ? nextRunFromNow(intervalHours) : null;

    await prisma.researchJob.update({
      where: { id: jobId },
      data: {
        continuityLastRunAt: completedAt,
        continuityNextRunAt: nextRunAt,
        continuityRunning: false,
        continuityErrorMessage: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
      },
    });

    emitResearchJobEvent({
      researchJobId: jobId,
      runId,
      source: 'continuity',
      code: 'continuity.completed',
      level: errors.length > 0 ? 'warn' : 'info',
      message:
        errors.length > 0
          ? `Continuity cycle completed with ${errors.length} warning(s)`
          : 'Continuity cycle completed successfully',
      metrics: {
        trigger,
        clientProfilesAttempted,
        competitorProfilesAttempted,
        errorsCount: errors.length,
      },
      metadata: errors.length > 0 ? { errors: errors.slice(0, 10) } : null,
    });

    return {
      success: errors.length === 0,
      partial: errors.length > 0,
      trigger,
      jobId,
      runId,
      clientProfilesAttempted,
      competitorProfilesAttempted,
      errors,
    };
  } catch (error) {
    const message = safeError(error);
    emitResearchJobEvent({
      researchJobId: jobId,
      runId,
      source: 'continuity',
      code: 'continuity.completed',
      level: 'error',
      message: `Continuity cycle failed: ${message}`,
      metrics: {
        trigger,
        clientProfilesAttempted,
        competitorProfilesAttempted,
        errorsCount: 1,
      },
      metadata: {
        error: message,
      },
    });

    try {
      await prisma.researchJob.update({
        where: { id: jobId },
        data: {
          continuityRunning: false,
          continuityErrorMessage: message,
          continuityNextRunAt: nextRunFromNow(intervalHoursForNextRun),
        },
      });
    } catch {
      // Ignore secondary update errors.
    }

    return {
      success: false,
      partial: false,
      trigger,
      jobId,
      runId,
      clientProfilesAttempted,
      competitorProfilesAttempted,
      errors: [message],
    };
  } finally {
    inFlightJobs.delete(jobId);
  }
}

async function runContinuityLoopCycle() {
  if (loopRunning) return;
  loopRunning = true;

  try {
    const dueJobs = await prisma.researchJob.findMany({
      where: {
        continuityEnabled: true,
        continuityRunning: false,
        OR: [{ continuityNextRunAt: null }, { continuityNextRunAt: { lte: new Date() } }],
      },
      select: { id: true },
      orderBy: { continuityNextRunAt: 'asc' },
      take: 20,
    });

    for (const job of dueJobs) {
      const result = await continueResearchJob(job.id, 'scheduler');
      if (!result.success && !result.partial) {
        console.error(
          `[ContinuityLoop] Job ${job.id} failed: ${result.errors.join(' | ') || 'unknown error'}`
        );
      } else {
        console.log(
          `[ContinuityLoop] Job ${job.id} continued (client=${result.clientProfilesAttempted}, competitors=${result.competitorProfilesAttempted}, errors=${result.errors.length})`
        );
      }
    }
  } catch (error) {
    console.error(`[ContinuityLoop] Cycle failed: ${safeError(error)}`);
  } finally {
    loopRunning = false;
  }
}

export function startResearchContinuityLoop(pollMs: number = DEFAULT_POLL_MS) {
  if (loopTimer) return;

  const interval = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : DEFAULT_POLL_MS;
  console.log(`[ContinuityLoop] Starting. Poll interval: ${interval}ms`);

  loopTimer = setInterval(() => {
    runContinuityLoopCycle().catch((error) => {
      console.error(`[ContinuityLoop] Unhandled cycle error: ${safeError(error)}`);
    });
  }, interval);

  // Prime one cycle shortly after startup.
  setTimeout(() => {
    runContinuityLoopCycle().catch((error) => {
      console.error(`[ContinuityLoop] Startup cycle error: ${safeError(error)}`);
    });
  }, 5_000);
}

export function stopResearchContinuityLoop() {
  if (!loopTimer) return;
  clearInterval(loopTimer);
  loopTimer = null;
  console.log('[ContinuityLoop] Stopped');
}

export const researchContinuity = {
  minIntervalHours: MIN_CONTINUITY_INTERVAL_HOURS,
  configureResearchJobContinuity,
  continueResearchJob,
  startResearchContinuityLoop,
  stopResearchContinuityLoop,
};
