import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export type PortalIntakeScanRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type PortalIntakeScanInitiatedBy = 'USER' | 'SYSTEM';

const DEFAULT_STALE_SCAN_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.PORTAL_INTAKE_SCAN_STALE_MS || 20 * 60_000)
);

export type PortalIntakeEventRecord = {
  id: number;
  workspaceId: string;
  scanRunId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type PortalIntakeScanRunDiagnosticsRecord = {
  id: string;
  workspaceId: string;
  mode: string;
  status: string;
  initiatedBy: string;
  targetsCompleted: number;
  snapshotsSaved: number;
  pagesDiscovered: number;
  pagesFetched: number;
  pagesPersisted: number;
  uniquePathPatterns: number;
  templateCoverageScore: number;
  coverageStatus: string;
  proof?: Record<string, unknown> | null;
  assetStats?: Record<string, unknown> | null;
  warnings: number;
  failures: number;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toEventRecord(row: {
  id: number;
  workspaceId: string;
  scanRunId: string;
  type: string;
  message: string;
  payloadJson: Prisma.JsonValue | null;
  createdAt: Date;
}): PortalIntakeEventRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scanRunId: row.scanRunId,
    type: row.type,
    message: row.message,
    ...(isRecord(row.payloadJson) ? { payload: row.payloadJson } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createPortalIntakeScanRun(input: {
  workspaceId: string;
  mode: string;
  status: PortalIntakeScanRunStatus;
  initiatedBy: PortalIntakeScanInitiatedBy;
  targets: string[];
  crawlSettings?: Record<string, unknown>;
}) {
  return prisma.portalIntakeScanRun.create({
    data: {
      workspaceId: input.workspaceId,
      mode: input.mode,
      status: input.status,
      initiatedBy: input.initiatedBy,
      targetsJson: toJson(input.targets),
      ...(input.crawlSettings ? { crawlSettingsJson: toJson(input.crawlSettings) } : {}),
    },
  });
}

export async function updatePortalIntakeScanRun(
  scanRunId: string,
  data: {
    status?: PortalIntakeScanRunStatus;
    targetsCompleted?: number;
    snapshotsSaved?: number;
    pagesDiscovered?: number;
    pagesFetched?: number;
    pagesPersisted?: number;
    uniquePathPatterns?: number;
    templateCoverageScore?: number;
    coverageStatus?: string;
    proof?: Record<string, unknown> | null;
    assetStats?: Record<string, unknown> | null;
    warnings?: number;
    failures?: number;
    error?: string | null;
    endedAt?: Date | null;
  }
) {
  return prisma.portalIntakeScanRun.update({
    where: { id: scanRunId },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(typeof data.targetsCompleted === 'number' ? { targetsCompleted: data.targetsCompleted } : {}),
      ...(typeof data.snapshotsSaved === 'number' ? { snapshotsSaved: data.snapshotsSaved } : {}),
      ...(typeof data.pagesDiscovered === 'number' ? { pagesDiscovered: data.pagesDiscovered } : {}),
      ...(typeof data.pagesFetched === 'number' ? { pagesFetched: data.pagesFetched } : {}),
      ...(typeof data.pagesPersisted === 'number' ? { pagesPersisted: data.pagesPersisted } : {}),
      ...(typeof data.uniquePathPatterns === 'number' ? { uniquePathPatterns: data.uniquePathPatterns } : {}),
      ...(typeof data.templateCoverageScore === 'number'
        ? { templateCoverageScore: data.templateCoverageScore }
        : {}),
      ...(typeof data.coverageStatus === 'string' && data.coverageStatus.trim()
        ? { coverageStatus: data.coverageStatus.trim() }
        : {}),
      ...(data.proof !== undefined ? { proofJson: data.proof ? toJson(data.proof) : Prisma.JsonNull } : {}),
      ...(data.assetStats !== undefined
        ? { assetStatsJson: data.assetStats ? toJson(data.assetStats) : Prisma.JsonNull }
        : {}),
      ...(typeof data.warnings === 'number' ? { warnings: data.warnings } : {}),
      ...(typeof data.failures === 'number' ? { failures: data.failures } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.endedAt !== undefined ? { endedAt: data.endedAt } : {}),
    },
  });
}

export async function expireStalePortalIntakeScanRuns(input?: {
  workspaceId?: string;
  staleMs?: number;
  reason?: string;
}) {
  const workspaceId = String(input?.workspaceId || '').trim();
  const staleMs = Math.max(60_000, Number(input?.staleMs || DEFAULT_STALE_SCAN_WINDOW_MS));
  const cutoff = new Date(Date.now() - staleMs);
  const reason =
    String(input?.reason || '').trim() ||
    `Scan exceeded stale window (${Math.round(staleMs / 60_000)}m) without progress heartbeat.`;
  const endedAt = new Date();

  const updated = await prisma.portalIntakeScanRun.updateMany({
    where: {
      status: 'RUNNING',
      updatedAt: { lt: cutoff },
      ...(workspaceId ? { workspaceId } : {}),
    },
    data: {
      status: 'FAILED',
      coverageStatus: 'FAILED',
      error: reason,
      failures: 1,
      endedAt,
    },
  });

  return {
    staleMs,
    cutoff,
    failedRuns: updated.count,
  };
}

export async function getPortalIntakeScanRun(workspaceId: string, scanRunId: string) {
  return prisma.portalIntakeScanRun.findFirst({
    where: {
      id: scanRunId,
      workspaceId,
    },
  });
}

export async function createPortalIntakeScanEvent(input: {
  workspaceId: string;
  scanRunId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<PortalIntakeEventRecord> {
  const created = await prisma.portalIntakeScanEvent.create({
    data: {
      workspaceId: input.workspaceId,
      scanRunId: input.scanRunId,
      type: input.type,
      message: input.message,
      ...(input.payload ? { payloadJson: toJson(input.payload) } : {}),
    },
    select: {
      id: true,
      workspaceId: true,
      scanRunId: true,
      type: true,
      message: true,
      payloadJson: true,
      createdAt: true,
    },
  });

  return toEventRecord(created);
}

export async function listPortalIntakeScanEvents(
  workspaceId: string,
  options?: {
    afterId?: number;
    limit?: number;
    scanRunId?: string;
  }
): Promise<PortalIntakeEventRecord[]> {
  const limit = Math.max(1, Math.min(500, Number(options?.limit || 200)));
  const afterId = typeof options?.afterId === 'number' ? options.afterId : undefined;
  const scanRunId = String(options?.scanRunId || '').trim() || undefined;

  const rows = await prisma.portalIntakeScanEvent.findMany({
    where: {
      workspaceId,
      ...(scanRunId ? { scanRunId } : {}),
      ...(typeof afterId === 'number' ? { id: { gt: afterId } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      workspaceId: true,
      scanRunId: true,
      type: true,
      message: true,
      payloadJson: true,
      createdAt: true,
    },
  });

  return rows.map((row) => toEventRecord(row));
}

export async function listPortalIntakeScanRunsWithEventCounts(options?: {
  workspaceId?: string;
  limit?: number;
}): Promise<PortalIntakeScanRunDiagnosticsRecord[]> {
  const workspaceId = String(options?.workspaceId || '').trim() || undefined;
  const limit = Math.max(1, Math.min(200, Number(options?.limit || 50)));

  const rows = await prisma.portalIntakeScanRun.findMany({
    where: workspaceId ? { workspaceId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      workspaceId: true,
      mode: true,
      status: true,
      initiatedBy: true,
      targetsCompleted: true,
      snapshotsSaved: true,
      pagesDiscovered: true,
      pagesFetched: true,
      pagesPersisted: true,
      uniquePathPatterns: true,
      templateCoverageScore: true,
      coverageStatus: true,
      proofJson: true,
      assetStatsJson: true,
      warnings: true,
      failures: true,
      error: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          events: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    mode: row.mode,
    status: row.status,
    initiatedBy: row.initiatedBy,
    targetsCompleted: row.targetsCompleted,
    snapshotsSaved: row.snapshotsSaved,
    pagesDiscovered: row.pagesDiscovered,
    pagesFetched: row.pagesFetched,
    pagesPersisted: row.pagesPersisted,
    uniquePathPatterns: row.uniquePathPatterns,
    templateCoverageScore: row.templateCoverageScore,
    coverageStatus: row.coverageStatus,
    proof: isRecord(row.proofJson) ? row.proofJson : null,
    assetStats: isRecord(row.assetStatsJson) ? row.assetStatsJson : null,
    warnings: row.warnings,
    failures: row.failures,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    eventCount: row._count.events,
  }));
}
