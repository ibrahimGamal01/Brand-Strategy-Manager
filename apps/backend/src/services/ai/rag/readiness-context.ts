import { prisma } from '../../../lib/prisma';

export type ReadinessStatus = 'READY' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';

export interface RagReadinessScope {
  allowedStatuses: Array<'READY' | 'DEGRADED'>;
  clientProfileKeys: Set<string>;
  competitorProfileKeys: Set<string>;
  clientCounts: Record<ReadinessStatus, number>;
  competitorCounts: Record<ReadinessStatus, number>;
  hasClientReady: boolean;
  hasCompetitorReady: boolean;
}

export interface BuildRagReadinessScopeOptions {
  allowDegraded?: boolean;
}

const ZERO_COUNTS: Record<ReadinessStatus, number> = {
  READY: 0,
  DEGRADED: 0,
  BLOCKED: 0,
  UNKNOWN: 0,
};

function normalizeHandle(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '');
}

export function buildProfileKey(platform: string | null | undefined, handle: string | null | undefined): string {
  return `${String(platform || '').trim().toLowerCase()}:${normalizeHandle(handle)}`;
}

function toStatus(value: string | null | undefined): ReadinessStatus {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'READY') return 'READY';
  if (normalized === 'DEGRADED') return 'DEGRADED';
  if (normalized === 'BLOCKED') return 'BLOCKED';
  return 'UNKNOWN';
}

function countStatuses(rows: Array<{ readinessStatus: string | null }>): Record<ReadinessStatus, number> {
  const counts: Record<ReadinessStatus, number> = { ...ZERO_COUNTS };
  for (const row of rows) {
    counts[toStatus(row.readinessStatus)] += 1;
  }
  return counts;
}

export async function buildRagReadinessScope(
  researchJobId: string,
  options: BuildRagReadinessScopeOptions = {}
): Promise<RagReadinessScope> {
  const allowDegraded = options.allowDegraded === true;
  const allowedStatuses: Array<'READY' | 'DEGRADED'> = allowDegraded
    ? ['READY', 'DEGRADED']
    : ['READY'];

  const [
    clientStatusRows,
    competitorStatusRows,
    clientAllowedRows,
    competitorAllowedRows,
  ] = await Promise.all([
    prisma.clientProfileSnapshot.findMany({
      where: { researchJobId },
      select: { readinessStatus: true },
    }),
    prisma.competitorProfileSnapshot.findMany({
      where: { researchJobId },
      select: { readinessStatus: true },
    }),
    prisma.clientProfileSnapshot.findMany({
      where: {
        researchJobId,
        readinessStatus: { in: allowedStatuses },
      },
      include: {
        clientProfile: {
          select: {
            platform: true,
            handle: true,
          },
        },
      },
      orderBy: { scrapedAt: 'desc' },
      take: 60,
    }),
    prisma.competitorProfileSnapshot.findMany({
      where: {
        researchJobId,
        readinessStatus: { in: allowedStatuses },
      },
      include: {
        competitorProfile: {
          select: {
            platform: true,
            handle: true,
          },
        },
      },
      orderBy: { scrapedAt: 'desc' },
      take: 120,
    }),
  ]);

  const clientProfileKeys = new Set(
    clientAllowedRows
      .map((row) => buildProfileKey(row.clientProfile?.platform, row.clientProfile?.handle))
      .filter((key) => !key.endsWith(':'))
  );

  const competitorProfileKeys = new Set(
    competitorAllowedRows
      .map((row) => buildProfileKey(row.competitorProfile?.platform, row.competitorProfile?.handle))
      .filter((key) => !key.endsWith(':'))
  );

  return {
    allowedStatuses,
    clientProfileKeys,
    competitorProfileKeys,
    clientCounts: countStatuses(clientStatusRows),
    competitorCounts: countStatuses(competitorStatusRows),
    hasClientReady: clientProfileKeys.size > 0,
    hasCompetitorReady: competitorProfileKeys.size > 0,
  };
}
