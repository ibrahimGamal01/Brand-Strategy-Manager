import { prisma } from '../../../lib/prisma';

export type WorkspaceMemoryScope =
  | 'workspace_profile'
  | 'deliverable_preferences'
  | 'approved_decisions'
  | 'family_defaults'
  | 'quality_history';

type WorkspaceMemoryEntry = {
  id: string;
  researchJobId: string;
  branchId: string;
  scope: WorkspaceMemoryScope;
  key: string;
  valueJson: unknown;
  confidence: number;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeScope(value: string): WorkspaceMemoryScope {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'workspace_profile' ||
    normalized === 'deliverable_preferences' ||
    normalized === 'approved_decisions' ||
    normalized === 'family_defaults' ||
    normalized === 'quality_history'
  ) {
    return normalized;
  }
  return 'family_defaults';
}

function normalizeBranchId(branchId?: string | null): string {
  const normalized = String(branchId || '').trim();
  return normalized || 'global';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function upsertWorkspaceMemorySnapshot(input: {
  researchJobId: string;
  branchId?: string | null;
  scope: WorkspaceMemoryScope;
  key: string;
  valueJson: unknown;
  confidence?: number;
  sourceRunId?: string | null;
}) {
  const researchJobId = String(input.researchJobId || '').trim();
  if (!researchJobId) throw new Error('researchJobId is required');
  const scope = normalizeScope(input.scope);
  const key = String(input.key || '').trim().slice(0, 120);
  if (!key) throw new Error('memory key is required');
  const branchId = normalizeBranchId(input.branchId);
  const confidence = Number.isFinite(Number(input.confidence)) ? Math.max(0, Math.min(1, Number(input.confidence))) : 0.8;
  const sourceRunId = String(input.sourceRunId || '').trim() || null;

  return prisma.workspaceMemorySnapshot.upsert({
    where: {
      researchJobId_branchId_scope_key: {
        researchJobId,
        branchId,
        scope,
        key,
      },
    },
    update: {
      valueJson: input.valueJson as any,
      confidence,
      sourceRunId,
    },
    create: {
      researchJobId,
      branchId,
      scope,
      key,
      valueJson: input.valueJson as any,
      confidence,
      sourceRunId,
    },
  });
}

export async function readWorkspaceMemoryContext(input: {
  researchJobId: string;
  branchId?: string | null;
  limitPerScope?: number;
}): Promise<{
  entries: WorkspaceMemoryEntry[];
  byScope: Record<WorkspaceMemoryScope, Record<string, unknown>>;
}> {
  const researchJobId = String(input.researchJobId || '').trim();
  if (!researchJobId) {
    return {
      entries: [],
      byScope: {
        workspace_profile: {},
        deliverable_preferences: {},
        approved_decisions: {},
        family_defaults: {},
        quality_history: {},
      },
    };
  }

  const branchId = normalizeBranchId(input.branchId);
  const limitPerScope = Number.isFinite(Number(input.limitPerScope))
    ? Math.max(3, Math.min(40, Math.floor(Number(input.limitPerScope))))
    : 12;

  const rows = await prisma.workspaceMemorySnapshot.findMany({
    where: {
      researchJobId,
      branchId: {
        in: ['global', branchId],
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: limitPerScope * 6,
  });

  const byScope: Record<WorkspaceMemoryScope, Record<string, unknown>> = {
    workspace_profile: {},
    deliverable_preferences: {},
    approved_decisions: {},
    family_defaults: {},
    quality_history: {},
  };
  const seenByScopeKey = new Set<string>();
  const entries: WorkspaceMemoryEntry[] = [];

  for (const row of rows) {
    const scope = normalizeScope(row.scope);
    const key = String(row.key || '').trim();
    if (!key) continue;
    const dedupe = `${scope}:${key}`;
    if (seenByScopeKey.has(dedupe)) continue;
    seenByScopeKey.add(dedupe);

    byScope[scope][key] = row.valueJson;
    entries.push({
      id: row.id,
      researchJobId: row.researchJobId,
      branchId: row.branchId,
      scope,
      key,
      valueJson: row.valueJson,
      confidence: row.confidence,
      sourceRunId: row.sourceRunId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  return { entries, byScope };
}

export async function persistDocumentQualityMemory(input: {
  researchJobId: string;
  branchId?: string | null;
  sourceRunId?: string | null;
  docFamily: string;
  coverageScore: number;
  coverageBand: string;
  qualityScore?: number;
  qualityNotes?: string[];
  dimensionScores?: {
    grounding: number;
    specificity: number;
    usefulness: number;
    redundancy: number;
    tone: number;
    visual: number;
  };
  renderTheme?: string;
  editorialPassCount?: number;
  partial: boolean;
  partialReasons: string[];
}) {
  const family = String(input.docFamily || '').trim().toUpperCase() || 'BUSINESS_STRATEGY';
  const coverageScore = Number.isFinite(Number(input.coverageScore)) ? Math.max(0, Math.min(100, Number(input.coverageScore))) : 0;
  const qualityScore = Number.isFinite(Number(input.qualityScore)) ? Math.max(0, Math.min(100, Number(input.qualityScore))) : undefined;
  const editorialPassCount = Number.isFinite(Number(input.editorialPassCount))
    ? Math.max(0, Math.floor(Number(input.editorialPassCount)))
    : undefined;
  const qualityNotes = Array.isArray(input.qualityNotes)
    ? input.qualityNotes.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const dimensionScores =
    input.dimensionScores && typeof input.dimensionScores === 'object'
      ? {
          grounding: Number.isFinite(Number(input.dimensionScores.grounding))
            ? Math.max(0, Math.min(100, Number(input.dimensionScores.grounding)))
            : undefined,
          specificity: Number.isFinite(Number(input.dimensionScores.specificity))
            ? Math.max(0, Math.min(100, Number(input.dimensionScores.specificity)))
            : undefined,
          usefulness: Number.isFinite(Number(input.dimensionScores.usefulness))
            ? Math.max(0, Math.min(100, Number(input.dimensionScores.usefulness)))
            : undefined,
          redundancy: Number.isFinite(Number(input.dimensionScores.redundancy))
            ? Math.max(0, Math.min(100, Number(input.dimensionScores.redundancy)))
            : undefined,
          tone: Number.isFinite(Number(input.dimensionScores.tone))
            ? Math.max(0, Math.min(100, Number(input.dimensionScores.tone)))
            : undefined,
          visual: Number.isFinite(Number(input.dimensionScores.visual))
            ? Math.max(0, Math.min(100, Number(input.dimensionScores.visual)))
            : undefined,
        }
      : undefined;
  const partialReasons = Array.isArray(input.partialReasons)
    ? input.partialReasons.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
    : [];

  const tasks = [
    upsertWorkspaceMemorySnapshot({
      researchJobId: input.researchJobId,
      branchId: input.branchId,
      scope: 'deliverable_preferences',
      key: 'last_doc_family',
      valueJson: {
        family,
        at: new Date().toISOString(),
      },
      confidence: 0.9,
      sourceRunId: input.sourceRunId || null,
    }),
    upsertWorkspaceMemorySnapshot({
      researchJobId: input.researchJobId,
      branchId: input.branchId,
      scope: 'family_defaults',
      key: `last_${family.toLowerCase()}`,
      valueJson: {
        family,
        coverageScore,
        coverageBand: String(input.coverageBand || '').trim().toLowerCase() || 'unknown',
        qualityScore,
        qualityNotes,
        dimensionScores,
        renderTheme: String(input.renderTheme || '').trim() || undefined,
        editorialPassCount,
        partial: Boolean(input.partial),
        partialReasons,
        at: new Date().toISOString(),
      },
      confidence: 0.85,
      sourceRunId: input.sourceRunId || null,
    }),
    upsertWorkspaceMemorySnapshot({
      researchJobId: input.researchJobId,
      branchId: input.branchId,
      scope: 'quality_history',
      key: 'last_document_quality',
      valueJson: {
        family,
        coverageScore,
        coverageBand: String(input.coverageBand || '').trim().toLowerCase() || 'unknown',
        qualityScore,
        qualityNotes,
        dimensionScores,
        renderTheme: String(input.renderTheme || '').trim() || undefined,
        editorialPassCount,
        partial: Boolean(input.partial),
        partialReasons,
        at: new Date().toISOString(),
      },
      confidence: 0.8,
      sourceRunId: input.sourceRunId || null,
    }),
  ];

  if (!input.partial && typeof qualityScore === 'number' && qualityScore >= 84) {
    tasks.push(
      upsertWorkspaceMemorySnapshot({
        researchJobId: input.researchJobId,
        branchId: input.branchId,
        scope: 'quality_history',
        key: 'last_good_document_workflow',
        valueJson: {
          family,
          coverageScore,
          coverageBand: String(input.coverageBand || '').trim().toLowerCase() || 'unknown',
          qualityScore,
          qualityNotes,
          dimensionScores,
          renderTheme: String(input.renderTheme || '').trim() || undefined,
          editorialPassCount,
          partial: false,
          at: new Date().toISOString(),
        },
        confidence: 0.9,
        sourceRunId: input.sourceRunId || null,
      }),
    );
  }

  await Promise.all(tasks);
}

export function flattenMemoryForRuntimeContext(input: {
  byScope: Record<WorkspaceMemoryScope, Record<string, unknown>>;
}): Record<string, unknown> {
  const workspaceProfile = asRecord(input.byScope.workspace_profile);
  const deliverablePreferences = asRecord(input.byScope.deliverable_preferences);
  const approvedDecisions = asRecord(input.byScope.approved_decisions);
  const familyDefaults = asRecord(input.byScope.family_defaults);
  const qualityHistory = asRecord(input.byScope.quality_history);

  return {
    workspaceMemory: {
      workspaceProfile,
      deliverablePreferences,
      approvedDecisions,
      familyDefaults,
      qualityHistory,
    },
    lastDocFamily: String(asRecord(deliverablePreferences.last_doc_family).family || '').trim() || undefined,
    lastDocumentQuality: qualityHistory.last_document_quality,
    lastGoodDocumentWorkflow: qualityHistory.last_good_document_workflow,
  };
}
