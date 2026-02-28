import { Prisma, WorkspaceEvidenceStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

type ArtifactLike = {
  kind: string;
  id: string;
  section?: string;
};

type EvidenceLike = {
  kind: string;
  label: string;
  url?: string;
  refId?: string;
  status?: string;
  provider?: string;
  confidence?: number;
  contentHash?: string;
  runId?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
};

type PersistRuntimeEvidenceInput = {
  researchJobId: string;
  toolName: string;
  defaultRunId?: string | null;
  evidence: EvidenceLike[];
  rawEvidenceRefs?: unknown;
  artifacts?: ArtifactLike[];
};

type PersistedRuntimeEvidence = {
  id: string;
  kind: string;
  refId: string | null;
  label: string | null;
  url: string | null;
  runId: string | null;
  status: WorkspaceEvidenceStatus;
  confidence: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, max = 500): string {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function mapEvidenceStatus(value: unknown): WorkspaceEvidenceStatus {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'PARTIAL') return WorkspaceEvidenceStatus.PARTIAL;
  if (normalized === 'BLOCKED') return WorkspaceEvidenceStatus.BLOCKED;
  if (normalized === 'VERIFIED') return WorkspaceEvidenceStatus.VERIFIED;
  return WorkspaceEvidenceStatus.RAW;
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function normalizeEvidenceArray(value: unknown): EvidenceLike[] {
  if (!Array.isArray(value)) return [];
  const out: EvidenceLike[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const label = normalizeText(row.label || row.title || row.name || row.handle, 220);
    if (!label) continue;
    const kind = normalizeText(row.kind || 'url', 60) || 'url';
    const url = normalizeText(row.url || row.href || row.finalUrl || row.profileUrl, 500);
    const refId = normalizeText(row.refId || row.id, 160);
    const contentHash = normalizeText(row.contentHash, 180);
    out.push({
      kind,
      label,
      ...(url ? { url } : {}),
      ...(refId ? { refId } : {}),
      ...(contentHash ? { contentHash } : {}),
      ...(typeof row.status === 'string' ? { status: row.status } : {}),
      ...(typeof row.provider === 'string' ? { provider: normalizeText(row.provider, 120) } : {}),
      ...(Number.isFinite(Number(row.confidence)) ? { confidence: Number(row.confidence) } : {}),
      ...(typeof row.runId === 'string' ? { runId: normalizeText(row.runId, 180) } : {}),
      ...(typeof row.snippet === 'string' ? { snippet: normalizeText(row.snippet, 480) } : {}),
      ...(isRecord(row.metadata) ? { metadata: row.metadata } : {}),
    });
  }
  return out;
}

function buildEvidenceCandidates(input: PersistRuntimeEvidenceInput): EvidenceLike[] {
  const combined: EvidenceLike[] = [];
  const fromRaw = normalizeEvidenceArray(input.rawEvidenceRefs);
  const fromNormalized = normalizeEvidenceArray(input.evidence);
  combined.push(...fromRaw, ...fromNormalized);

  const deduped = new Map<string, EvidenceLike>();
  for (const item of combined) {
    const kind = normalizeText(item.kind, 60) || 'url';
    const label = normalizeText(item.label, 220);
    if (!label) continue;
    const refId = normalizeText(item.refId, 160);
    const contentHash = normalizeText(item.contentHash, 180);
    const url = normalizeText(item.url, 500);
    const key = [kind.toLowerCase(), refId.toLowerCase(), contentHash.toLowerCase(), url.toLowerCase(), label.toLowerCase()].join('|');
    if (deduped.has(key)) continue;
    deduped.set(key, {
      kind,
      label,
      ...(url ? { url } : {}),
      ...(refId ? { refId } : {}),
      ...(contentHash ? { contentHash } : {}),
      ...(typeof item.status === 'string' ? { status: item.status } : {}),
      ...(typeof item.provider === 'string' ? { provider: normalizeText(item.provider, 120) } : {}),
      ...(Number.isFinite(Number(item.confidence)) ? { confidence: Number(item.confidence) } : {}),
      ...(typeof item.runId === 'string' ? { runId: normalizeText(item.runId, 180) } : {}),
      ...(typeof item.snippet === 'string' ? { snippet: normalizeText(item.snippet, 480) } : {}),
      ...(isRecord(item.metadata) ? { metadata: item.metadata } : {}),
    });
  }

  return Array.from(deduped.values()).slice(0, 40);
}

function mapArtifactEntityType(artifact: ArtifactLike): string {
  const section = normalizeText(artifact.section, 120);
  if (section) return section;
  const kind = normalizeText(artifact.kind, 120);
  if (!kind) return 'runtime_artifact';
  return kind;
}

async function upsertEvidenceRefTx(input: {
  tx: Prisma.TransactionClient;
  researchJobId: string;
  defaultRunId?: string | null;
  item: EvidenceLike;
}): Promise<PersistedRuntimeEvidence | null> {
  const kind = normalizeText(input.item.kind, 60) || 'url';
  const label = normalizeText(input.item.label, 220);
  if (!label) return null;

  const runId = normalizeText(input.item.runId || input.defaultRunId, 180) || null;
  const refId = normalizeText(input.item.refId, 160) || null;
  const contentHash = normalizeText(input.item.contentHash, 180) || null;
  const url = normalizeText(input.item.url, 500) || null;
  const provider = normalizeText(input.item.provider, 120) || null;
  const snippet = normalizeText(input.item.snippet, 480) || null;
  const confidence = clampConfidence(input.item.confidence);
  const status = mapEvidenceStatus(input.item.status);

  const baseCreate = {
    researchJobId: input.researchJobId,
    kind,
    ...(refId ? { refId } : {}),
    ...(url ? { url } : {}),
    ...(label ? { label } : {}),
    ...(snippet ? { snippet } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(provider ? { provider } : {}),
    ...(runId ? { runId } : {}),
    status,
    confidence,
    ...(isRecord(input.item.metadata) ? { metadata: input.item.metadata as Prisma.InputJsonValue } : {}),
    fetchedAt: new Date(),
  };

  const baseUpdate = {
    ...(url ? { url } : {}),
    ...(label ? { label } : {}),
    ...(snippet ? { snippet } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(provider ? { provider } : {}),
    ...(runId ? { runId } : {}),
    status,
    confidence,
    ...(isRecord(input.item.metadata) ? { metadata: input.item.metadata as Prisma.InputJsonValue } : {}),
    fetchedAt: new Date(),
  };

  if (refId) {
    const row = await input.tx.workspaceEvidenceRef.upsert({
      where: {
        researchJobId_kind_refId: {
          researchJobId: input.researchJobId,
          kind,
          refId,
        },
      },
      create: baseCreate,
      update: baseUpdate,
      select: {
        id: true,
        kind: true,
        refId: true,
        label: true,
        url: true,
        runId: true,
        status: true,
        confidence: true,
      },
    });
    return row;
  }

  const whereClauses: Prisma.WorkspaceEvidenceRefWhereInput[] = [];
  if (contentHash) {
    whereClauses.push({ contentHash });
  }
  if (url) {
    whereClauses.push({ url, ...(label ? { label } : {}) });
  }

  const existing = whereClauses.length
    ? await input.tx.workspaceEvidenceRef.findFirst({
        where: {
          researchJobId: input.researchJobId,
          kind,
          OR: whereClauses,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    : null;

  if (existing?.id) {
    const row = await input.tx.workspaceEvidenceRef.update({
      where: { id: existing.id },
      data: baseUpdate,
      select: {
        id: true,
        kind: true,
        refId: true,
        label: true,
        url: true,
        runId: true,
        status: true,
        confidence: true,
      },
    });
    return row;
  }

  const created = await input.tx.workspaceEvidenceRef.create({
    data: baseCreate,
    select: {
      id: true,
      kind: true,
      refId: true,
      label: true,
      url: true,
      runId: true,
      status: true,
      confidence: true,
    },
  });
  return created;
}

export async function persistRuntimeEvidenceRefs(input: PersistRuntimeEvidenceInput): Promise<{
  evidenceRefs: PersistedRuntimeEvidence[];
  evidenceRefIds: string[];
}> {
  const candidates = buildEvidenceCandidates(input);
  if (!candidates.length) {
    return { evidenceRefs: [], evidenceRefIds: [] };
  }

  const artifactTargets = Array.isArray(input.artifacts)
    ? input.artifacts
        .map((artifact) => ({
          entityType: mapArtifactEntityType(artifact),
          entityId: normalizeText(artifact.id, 180),
        }))
        .filter((entry) => entry.entityType && entry.entityId)
        .slice(0, 20)
    : [];

  const persisted = await prisma.$transaction(async (tx) => {
    const refs: PersistedRuntimeEvidence[] = [];

    for (const item of candidates) {
      const row = await upsertEvidenceRefTx({
        tx,
        researchJobId: input.researchJobId,
        defaultRunId: input.defaultRunId,
        item,
      });
      if (!row) continue;
      refs.push(row);

      for (const target of artifactTargets) {
        await tx.workspaceEvidenceLink.upsert({
          where: {
            researchJobId_evidenceRefId_entityType_entityId_role: {
              researchJobId: input.researchJobId,
              evidenceRefId: row.id,
              entityType: target.entityType,
              entityId: target.entityId,
              role: 'supporting',
            },
          },
          create: {
            researchJobId: input.researchJobId,
            evidenceRefId: row.id,
            entityType: target.entityType,
            entityId: target.entityId,
            role: 'supporting',
          },
          update: {},
        });
      }
    }

    return refs;
  });

  return {
    evidenceRefs: persisted,
    evidenceRefIds: persisted.map((row) => row.id),
  };
}

export async function listWorkspaceEvidence(input: {
  researchJobId: string;
  runId?: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(200, Number(input.limit || 80)));
  return prisma.workspaceEvidenceRef.findMany({
    where: {
      researchJobId: input.researchJobId,
      ...(input.runId ? { runId: input.runId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      links: {
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
    },
  });
}

export async function listWorkspaceEvidenceByIds(input: {
  researchJobId: string;
  ids: string[];
}) {
  const ids = Array.from(
    new Set(
      (input.ids || [])
        .map((id) => normalizeText(id, 120))
        .filter(Boolean)
    )
  ).slice(0, 120);

  if (!ids.length) return [];

  return prisma.workspaceEvidenceRef.findMany({
    where: {
      researchJobId: input.researchJobId,
      id: { in: ids },
    },
    include: {
      links: {
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
    },
  });
}
