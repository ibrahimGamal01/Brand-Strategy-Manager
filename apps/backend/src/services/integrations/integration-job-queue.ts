import { IntegrationJob, IntegrationJobType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const STALE_LOCK_MS = 5 * 60 * 1000;

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

export async function enqueueIntegrationJob(input: {
  type: IntegrationJobType;
  payload?: Record<string, unknown>;
  researchJobId?: string | null;
  slackTeamId?: string | null;
  runAt?: Date;
}) {
  return prisma.integrationJob.create({
    data: {
      type: input.type,
      status: 'QUEUED',
      payloadJson: normalizePayload(input.payload || {}) as Prisma.InputJsonValue,
      researchJobId: input.researchJobId || null,
      slackTeamId: input.slackTeamId || null,
      runAt: input.runAt || new Date(),
    },
  });
}

export async function enqueueIntegrationJobs(
  jobs: Array<{
    type: IntegrationJobType;
    payload?: Record<string, unknown>;
    researchJobId?: string | null;
    slackTeamId?: string | null;
    runAt?: Date;
  }>
) {
  if (!jobs.length) return;
  await prisma.integrationJob.createMany({
    data: jobs.map((job) => ({
      type: job.type,
      status: 'QUEUED',
      payloadJson: normalizePayload(job.payload || {}) as Prisma.InputJsonValue,
      researchJobId: job.researchJobId || null,
      slackTeamId: job.slackTeamId || null,
      runAt: job.runAt || new Date(),
    })),
  });
}

export async function claimNextIntegrationJob(workerId: string): Promise<IntegrationJob | null> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_LOCK_MS);
  const candidate = await prisma.integrationJob.findFirst({
    where: {
      status: { in: ['QUEUED', 'RETRY'] },
      runAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleCutoff } }],
    },
    orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
  });
  if (!candidate) return null;

  const claimed = await prisma.integrationJob.updateMany({
    where: {
      id: candidate.id,
      status: { in: ['QUEUED', 'RETRY'] },
    },
    data: {
      status: 'RUNNING',
      lockedAt: now,
      lockedBy: workerId,
    },
  });
  if (claimed.count === 0) return null;

  return prisma.integrationJob.findUnique({ where: { id: candidate.id } });
}

export async function markIntegrationJobDone(jobId: string) {
  return prisma.integrationJob.update({
    where: { id: jobId },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

export async function markIntegrationJobRetry(job: IntegrationJob, errorMessage: string, retryAfterMs: number) {
  const attempts = job.attempts + 1;
  const maxAttempts = Math.max(1, job.maxAttempts);
  const nextStatus = attempts >= maxAttempts ? 'FAILED' : 'RETRY';
  const delayMs = Math.max(3_000, Math.min(retryAfterMs, 12 * 60 * 60 * 1000));
  return prisma.integrationJob.update({
    where: { id: job.id },
    data: {
      attempts,
      status: nextStatus,
      runAt: new Date(Date.now() + delayMs),
      lockedAt: null,
      lockedBy: null,
      lastError: errorMessage.slice(0, 3000),
      ...(nextStatus === 'FAILED' ? { completedAt: new Date() } : {}),
    },
  });
}

export async function markIntegrationJobFailed(job: IntegrationJob, errorMessage: string) {
  const attempts = job.attempts + 1;
  const maxAttempts = Math.max(1, job.maxAttempts);
  const canRetry = attempts < maxAttempts;
  return prisma.integrationJob.update({
    where: { id: job.id },
    data: {
      attempts,
      status: canRetry ? 'RETRY' : 'FAILED',
      runAt: canRetry ? new Date(Date.now() + Math.min(30_000 * attempts, 30 * 60 * 1000)) : job.runAt,
      lockedAt: null,
      lockedBy: null,
      lastError: errorMessage.slice(0, 3000),
      ...(canRetry ? {} : { completedAt: new Date() }),
    },
  });
}

export async function queueDepthSnapshot() {
  const grouped = await prisma.integrationJob.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  return grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
}
