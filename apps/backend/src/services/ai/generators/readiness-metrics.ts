import { prisma } from '../../../lib/prisma';
import { scoreAndPersistJobSnapshotReadiness } from '../../orchestration/content-readiness';

export interface ReadinessGateMetrics {
  clientReady: number;
  clientDegraded: number;
  clientBlocked: number;
  competitorReady: number;
  competitorDegraded: number;
  competitorBlocked: number;
  hadUnscoredSnapshots: boolean;
}

function summarizeReadinessCounts(input: {
  client: Array<{ status: 'READY' | 'DEGRADED' | 'BLOCKED' }>;
  competitor: Array<{ status: 'READY' | 'DEGRADED' | 'BLOCKED' }>;
}): ReadinessGateMetrics {
  const clientReady = input.client.filter((row) => row.status === 'READY').length;
  const clientDegraded = input.client.filter((row) => row.status === 'DEGRADED').length;
  const clientBlocked = input.client.filter((row) => row.status === 'BLOCKED').length;
  const competitorReady = input.competitor.filter((row) => row.status === 'READY').length;
  const competitorDegraded = input.competitor.filter((row) => row.status === 'DEGRADED').length;
  const competitorBlocked = input.competitor.filter((row) => row.status === 'BLOCKED').length;

  return {
    clientReady,
    clientDegraded,
    clientBlocked,
    competitorReady,
    competitorDegraded,
    competitorBlocked,
    hadUnscoredSnapshots: false,
  };
}

export async function loadReadinessGateMetrics(researchJobId: string): Promise<ReadinessGateMetrics> {
  const [
    clientReady,
    clientDegraded,
    clientBlocked,
    clientUnscored,
    competitorReady,
    competitorDegraded,
    competitorBlocked,
    competitorUnscored,
  ] = await Promise.all([
    prisma.clientProfileSnapshot.count({ where: { researchJobId, readinessStatus: 'READY' } }),
    prisma.clientProfileSnapshot.count({ where: { researchJobId, readinessStatus: 'DEGRADED' } }),
    prisma.clientProfileSnapshot.count({ where: { researchJobId, readinessStatus: 'BLOCKED' } }),
    prisma.clientProfileSnapshot.count({
      where: {
        researchJobId,
        OR: [{ readinessStatus: null }, { readinessStatus: '' }],
      },
    }),
    prisma.competitorProfileSnapshot.count({ where: { researchJobId, readinessStatus: 'READY' } }),
    prisma.competitorProfileSnapshot.count({ where: { researchJobId, readinessStatus: 'DEGRADED' } }),
    prisma.competitorProfileSnapshot.count({ where: { researchJobId, readinessStatus: 'BLOCKED' } }),
    prisma.competitorProfileSnapshot.count({
      where: {
        researchJobId,
        OR: [{ readinessStatus: null }, { readinessStatus: '' }],
      },
    }),
  ]);

  const shouldRescore =
    (clientReady + clientDegraded === 0 && clientUnscored > 0) ||
    (competitorReady + competitorDegraded === 0 && competitorUnscored > 0);

  if (shouldRescore) {
    const rescored = await scoreAndPersistJobSnapshotReadiness(researchJobId);
    const summarized = summarizeReadinessCounts({
      client: rescored.client.map((row) => ({ status: row.status })),
      competitor: rescored.competitor.map((row) => ({ status: row.status })),
    });
    return {
      ...summarized,
      hadUnscoredSnapshots: true,
    };
  }

  return {
    clientReady,
    clientDegraded,
    clientBlocked,
    competitorReady,
    competitorDegraded,
    competitorBlocked,
    hadUnscoredSnapshots: clientUnscored > 0 || competitorUnscored > 0,
  };
}
