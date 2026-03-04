import { prisma } from '../../lib/prisma';
import { enqueueIntegrationJob } from './integration-job-queue';
import { runIntegrationWorkerBatch } from './integration-worker';
import { listActiveSlackInstallations } from '../slack/slack-installation-repo';

let timer: NodeJS.Timeout | null = null;
let running = false;
let ticks = 0;

const DEFAULT_INTERVAL_MS = 15_000;

function getIntervalMs(): number {
  const parsed = Number(process.env.INTEGRATION_SCHEDULER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.max(5_000, Math.min(120_000, Math.floor(parsed)));
}

async function ensureRecurringJob(input: {
  type: 'ATTENTION_REMINDER_SCAN' | 'BAT_WAITING_INPUT_SCAN' | 'SLACK_SYNC_CHANNELS';
  slackTeamId?: string | null;
  runAt: Date;
  staleWindowMs: number;
}) {
  const staleFrom = new Date(Date.now() - input.staleWindowMs);
  const existing = await prisma.integrationJob.findFirst({
    where: {
      type: input.type,
      ...(input.slackTeamId ? { slackTeamId: input.slackTeamId } : {}),
      status: { in: ['QUEUED', 'RUNNING', 'RETRY'] },
      runAt: { gt: staleFrom },
    },
    select: { id: true },
  });
  if (existing?.id) return;
  await enqueueIntegrationJob({
    type: input.type,
    slackTeamId: input.slackTeamId || null,
    runAt: input.runAt,
  });
}

async function scheduleRecurringJobs() {
  const now = new Date();
  await ensureRecurringJob({
    type: 'ATTENTION_REMINDER_SCAN',
    runAt: now,
    staleWindowMs: 5 * 60 * 1000,
  });
  await ensureRecurringJob({
    type: 'BAT_WAITING_INPUT_SCAN',
    runAt: now,
    staleWindowMs: 5 * 60 * 1000,
  });

  if (ticks % 20 !== 0) return;
  const installations = await listActiveSlackInstallations();
  for (const installation of installations) {
    await ensureRecurringJob({
      type: 'SLACK_SYNC_CHANNELS',
      slackTeamId: installation.slackTeamId,
      runAt: now,
      staleWindowMs: 30 * 60 * 1000,
    });
  }
}

async function runTick() {
  if (running) return;
  running = true;
  ticks += 1;
  try {
    await scheduleRecurringJobs();
    await runIntegrationWorkerBatch({
      workerId: `integration-scheduler-${process.pid}`,
      maxJobs: 10,
    });
  } catch (error: any) {
    console.warn('[IntegrationScheduler] Tick failed:', error?.message || error);
  } finally {
    running = false;
  }
}

export function startIntegrationScheduler() {
  if (timer) return;
  const interval = getIntervalMs();
  void runTick();
  timer = setInterval(() => {
    void runTick();
  }, interval);
  console.log(`[IntegrationScheduler] Started (${interval}ms interval).`);
}

export function stopIntegrationScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function getIntegrationSchedulerStatus() {
  return {
    running: Boolean(timer),
    intervalMs: getIntervalMs(),
    tickInProgress: running,
  };
}
