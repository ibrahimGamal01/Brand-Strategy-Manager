import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  buildViralStudioAssetRef,
  parseViralStudioAssetRef,
  type ViralStudioAssetRefKind,
} from './viral-studio-asset-refs';
import type {
  BrandDNAProfile,
  GenerationPack,
  IngestionRun,
  ReferenceAsset,
  ReferenceListFilters,
  StudioDocument,
  StudioDocumentVersion,
  ViralStudioTelemetryRuntimeEvent,
} from './viral-studio';

type JsonRecord = Record<string, unknown>;

export type ViralStudioIngestionEventRecord = {
  id: number;
  workspaceId: string;
  ingestionRunId: string;
  type: string;
  status?: string;
  message: string;
  payload?: JsonRecord;
  createdAt: string;
};

export type ViralStudioResolvedAssetRef = {
  workspaceId: string;
  kind: ViralStudioAssetRefKind;
  id: string;
  assetRef: string;
  title: string;
  summary: string;
  sourceUrl?: string;
  createdAt: string;
  metadata?: JsonRecord;
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function withPersistedMeta<T extends JsonRecord>(payload: T, updatedAt: Date): T {
  return {
    ...payload,
    persistedAt: updatedAt.toISOString(),
  };
}

function withStorageMode<T extends JsonRecord>(payload: T, storageMode: string): T {
  return {
    ...payload,
    storageMode,
  };
}

function parseBrandDnaPayload(value: Prisma.JsonValue | null, workspaceId: string): BrandDNAProfile | null {
  const parsed = asRecord(value);
  if (!Object.keys(parsed).length) return null;
  return {
    workspaceId,
    status: String(parsed.status || 'draft').toLowerCase() === 'final' ? 'final' : 'draft',
    mission: String(parsed.mission || ''),
    valueProposition: String(parsed.valueProposition || ''),
    productOrService: String(parsed.productOrService || ''),
    region: String(parsed.region || ''),
    audiencePersonas: asArray(parsed.audiencePersonas).map((item) => String(item || '')).filter(Boolean),
    pains: asArray(parsed.pains).map((item) => String(item || '')).filter(Boolean),
    desires: asArray(parsed.desires).map((item) => String(item || '')).filter(Boolean),
    objections: asArray(parsed.objections).map((item) => String(item || '')).filter(Boolean),
    voiceSliders: asRecord(parsed.voiceSliders) as BrandDNAProfile['voiceSliders'],
    bannedPhrases: asArray(parsed.bannedPhrases).map((item) => String(item || '')).filter(Boolean),
    requiredClaims: asArray(parsed.requiredClaims).map((item) => String(item || '')).filter(Boolean),
    exemplars: asArray(parsed.exemplars).map((item) => String(item || '')).filter(Boolean),
    summary: String(parsed.summary || ''),
    completeness: asRecord(parsed.completeness) as BrandDNAProfile['completeness'],
    createdAt: String(parsed.createdAt || new Date(0).toISOString()),
    updatedAt: String(parsed.updatedAt || new Date(0).toISOString()),
  };
}

function parseIngestionPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    sourcePlatform: string;
    sourceUrl: string;
    maxVideos: number;
    lookbackDays: number;
    sortBy: string;
    preset: string;
    attempt: number;
    retryOfRunId: string | null;
    status: string;
    found: number;
    downloaded: number;
    analyzed: number;
    ranked: number;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    endedAt: Date | null;
    assetRef: string | null;
    eventCount?: number;
  }
): IngestionRun {
  const parsed = asRecord(value);
  const base: IngestionRun = {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    sourcePlatform: (fallback.sourcePlatform as IngestionRun['sourcePlatform']) || 'instagram',
    sourceUrl: fallback.sourceUrl,
    maxVideos: fallback.maxVideos,
    lookbackDays: fallback.lookbackDays,
    sortBy: (fallback.sortBy as IngestionRun['sortBy']) || 'engagement',
    preset: (fallback.preset as IngestionRun['preset']) || 'balanced',
    attempt: fallback.attempt,
    ...(fallback.retryOfRunId ? { retryOfRunId: fallback.retryOfRunId } : {}),
    status: (fallback.status as IngestionRun['status']) || 'queued',
    progress: {
      found: fallback.found,
      downloaded: fallback.downloaded,
      analyzed: fallback.analyzed,
      ranked: fallback.ranked,
    },
    ...(fallback.error ? { error: fallback.error } : {}),
    createdAt: fallback.createdAt.toISOString(),
    updatedAt: fallback.updatedAt.toISOString(),
    ...(fallback.startedAt ? { startedAt: fallback.startedAt.toISOString() } : {}),
    ...(fallback.endedAt ? { endedAt: fallback.endedAt.toISOString() } : {}),
  };
  if (!Object.keys(parsed).length) {
    return {
      ...base,
      ...(fallback.assetRef ? { assetRef: fallback.assetRef } : {}),
      ...(typeof fallback.eventCount === 'number' ? { eventCount: fallback.eventCount } : {}),
    } as IngestionRun;
  }
  return {
    ...base,
    ...parsed,
    progress: {
      ...base.progress,
      ...asRecord(parsed.progress),
    },
    ...(fallback.assetRef ? { assetRef: fallback.assetRef } : {}),
    ...(typeof fallback.eventCount === 'number' ? { eventCount: fallback.eventCount } : {}),
  } as IngestionRun;
}

function parseReferencePayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    ingestionRunId: string;
    sourcePlatform: string;
    sourceUrl: string;
    caption: string;
    shortlistState: string;
    rank: number;
    viralScore: number;
    createdAt: Date;
    updatedAt: Date;
    assetRef: string | null;
  }
): ReferenceAsset {
  const parsed = asRecord(value);
  const base: ReferenceAsset = {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    ingestionRunId: fallback.ingestionRunId,
    sourcePlatform: (fallback.sourcePlatform as ReferenceAsset['sourcePlatform']) || 'instagram',
    sourceUrl: fallback.sourceUrl,
    caption: fallback.caption,
    transcriptSummary: '',
    ocrSummary: '',
    metrics: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      postedAt: new Date(0).toISOString(),
    },
    scores: {
      engagementRate: 0,
      recency: 0,
      hookStrength: 0,
      retentionProxy: 0,
      captionClarity: 0,
      composite: fallback.viralScore,
    },
    normalizedMetrics: {
      engagementRatePct: 0,
      recencyPct: 0,
      hookStrengthPct: 0,
      retentionProxyPct: 0,
      captionClarityPct: 0,
    },
    explainability: {
      formulaVersion: 'viral-score-v1',
      weightedContributions: {
        engagementRate: 0,
        recency: 0,
        hookStrength: 0,
        retentionProxy: 0,
        captionClarity: 0,
      },
      topDrivers: [],
      whyRankedHigh: [],
    },
    ranking: {
      rank: fallback.rank,
      rationaleTitle: '',
      rationaleBullets: [],
    },
    shortlistState: (fallback.shortlistState as ReferenceAsset['shortlistState']) || 'none',
    createdAt: fallback.createdAt.toISOString(),
    updatedAt: fallback.updatedAt.toISOString(),
  };
  const hydrated = {
    ...base,
    ...parsed,
    ranking: {
      ...base.ranking,
      ...asRecord(parsed.ranking),
    },
    ...(fallback.assetRef ? { assetRef: fallback.assetRef } : {}),
  } as ReferenceAsset;
  return hydrated;
}

function parseGenerationPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    status: string;
    promptTemplateId: string;
    formatTarget: string;
    inputPrompt: string;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
    assetRef: string | null;
    revisionCount?: number;
  }
): GenerationPack {
  const parsed = asRecord(value);
  const base: GenerationPack = {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    status: 'completed',
    promptTemplateId: fallback.promptTemplateId,
    formatTarget: (fallback.formatTarget as GenerationPack['formatTarget']) || 'reel-30',
    inputPrompt: fallback.inputPrompt,
    selectedReferenceIds: [],
    promptContext: {
      template: {
        id: fallback.promptTemplateId,
        title: '',
        intent: 'hook-script',
      },
      formatTarget: 'reel-30',
      objective: '',
      audienceSnapshot: '',
      brandSummary: '',
      voiceProfile: [],
      requiredClaims: [],
      bannedPhrases: [],
      referenceNotes: [],
      composedPrompt: '',
    },
    outputs: {
      hooks: [],
      scripts: {
        short: '',
        medium: '',
        long: '',
      },
      captions: [],
      ctas: [],
      angleRemixes: [],
    },
    qualityCheck: {
      bannedTermHits: [],
      toneMismatch: false,
      duplicates: [],
      lengthWarnings: [],
      passed: true,
    },
    revision: fallback.revision,
    createdAt: fallback.createdAt.toISOString(),
    updatedAt: fallback.updatedAt.toISOString(),
  };
  return {
    ...base,
    ...parsed,
    ...(fallback.assetRef ? { assetRef: fallback.assetRef } : {}),
    ...(typeof fallback.revisionCount === 'number' ? { revisionCount: fallback.revisionCount } : {}),
  } as GenerationPack;
}

function parseDocumentPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    title: string;
    currentVersionId: string | null;
    createdAt: Date;
    updatedAt: Date;
    assetRef: string | null;
  }
): StudioDocument {
  const parsed = asRecord(value);
  const base: StudioDocument = {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    title: fallback.title,
    linkedGenerationIds: [],
    sections: [],
    currentVersionId: fallback.currentVersionId,
    createdAt: fallback.createdAt.toISOString(),
    updatedAt: fallback.updatedAt.toISOString(),
  };
  return {
    ...base,
    ...parsed,
    ...(fallback.assetRef ? { assetRef: fallback.assetRef } : {}),
  } as StudioDocument;
}

function parseDocumentVersionPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    documentId: string;
    author: string;
    summary: string;
    basedOnVersionId: string | null;
    createdAt: Date;
    versionNumber: number;
    assetRef: string | null;
  }
): StudioDocumentVersion {
  const parsed = asRecord(value);
  const base: StudioDocumentVersion = {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    documentId: fallback.documentId,
    author: fallback.author,
    summary: fallback.summary,
    ...(fallback.basedOnVersionId ? { basedOnVersionId: fallback.basedOnVersionId } : {}),
    snapshotSections: [],
    createdAt: fallback.createdAt.toISOString(),
  };
  return {
    ...base,
    ...parsed,
    versionNumber: fallback.versionNumber,
    ...(fallback.assetRef ? { assetRef: fallback.assetRef } : {}),
  } as StudioDocumentVersion;
}

function toEventRecord(row: {
  id: number;
  workspaceId: string;
  ingestionRunId: string;
  type: string;
  status: string | null;
  message: string;
  payloadJson: Prisma.JsonValue | null;
  createdAt: Date;
}): ViralStudioIngestionEventRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ingestionRunId: row.ingestionRunId,
    type: row.type,
    ...(row.status ? { status: row.status } : {}),
    message: row.message,
    ...(Object.keys(asRecord(row.payloadJson)).length ? { payload: asRecord(row.payloadJson) } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

function ensureAssetRef(workspaceId: string, kind: ViralStudioAssetRefKind, id: string, provided?: string): string {
  const normalizedProvided = String(provided || '').trim();
  if (normalizedProvided) return normalizedProvided;
  return buildViralStudioAssetRef({ workspaceId, kind, id });
}

export async function repositoryGetBrandDnaProfile(workspaceId: string): Promise<BrandDNAProfile | null> {
  const row = await prisma.viralStudioBrandDnaProfile.findUnique({
    where: { workspaceId },
    select: {
      workspaceId: true,
      payloadJson: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  const parsed = parseBrandDnaPayload(row.payloadJson, row.workspaceId);
  if (!parsed) return null;
  return withPersistedMeta(parsed as JsonRecord, row.updatedAt) as BrandDNAProfile;
}

export async function repositoryUpsertBrandDnaProfile(
  workspaceId: string,
  profile: BrandDNAProfile
): Promise<BrandDNAProfile> {
  const createdAt = toDate(profile.createdAt) || new Date();
  const updatedAt = toDate(profile.updatedAt) || new Date();
  const saved = await prisma.viralStudioBrandDnaProfile.upsert({
    where: { workspaceId },
    update: {
      status: profile.status,
      mission: profile.mission,
      valueProposition: profile.valueProposition,
      productOrService: profile.productOrService,
      region: profile.region,
      audienceJson: toJson(profile.audiencePersonas),
      painsJson: toJson(profile.pains),
      desiresJson: toJson(profile.desires),
      objectionsJson: toJson(profile.objections),
      voiceSlidersJson: toJson(profile.voiceSliders),
      bannedPhrasesJson: toJson(profile.bannedPhrases),
      requiredClaimsJson: toJson(profile.requiredClaims),
      exemplarsJson: toJson(profile.exemplars),
      summary: profile.summary,
      completenessJson: toJson(profile.completeness),
      payloadJson: toJson(profile),
      updatedAt,
    },
    create: {
      id: crypto.randomUUID(),
      workspaceId,
      status: profile.status,
      mission: profile.mission,
      valueProposition: profile.valueProposition,
      productOrService: profile.productOrService,
      region: profile.region,
      audienceJson: toJson(profile.audiencePersonas),
      painsJson: toJson(profile.pains),
      desiresJson: toJson(profile.desires),
      objectionsJson: toJson(profile.objections),
      voiceSlidersJson: toJson(profile.voiceSliders),
      bannedPhrasesJson: toJson(profile.bannedPhrases),
      requiredClaimsJson: toJson(profile.requiredClaims),
      exemplarsJson: toJson(profile.exemplars),
      summary: profile.summary,
      completenessJson: toJson(profile.completeness),
      payloadJson: toJson(profile),
      createdAt,
      updatedAt,
    },
    select: {
      workspaceId: true,
      payloadJson: true,
      updatedAt: true,
    },
  });
  const parsed = parseBrandDnaPayload(saved.payloadJson, saved.workspaceId) || profile;
  return withPersistedMeta(parsed as JsonRecord, saved.updatedAt) as BrandDNAProfile;
}

export async function repositoryUpsertIngestionRun(run: IngestionRun): Promise<IngestionRun> {
  const createdAt = toDate(run.createdAt) || new Date();
  const updatedAt = toDate(run.updatedAt) || new Date();
  const startedAt = toDate(run.startedAt);
  const endedAt = toDate(run.endedAt);
  const assetRef = ensureAssetRef(run.workspaceId, 'ingestion', run.id, (run as any).assetRef);
  const row = await prisma.viralStudioIngestionRun.upsert({
    where: { id: run.id },
    update: {
      sourcePlatform: run.sourcePlatform,
      sourceUrl: run.sourceUrl,
      maxVideos: run.maxVideos,
      lookbackDays: run.lookbackDays,
      sortBy: run.sortBy,
      preset: run.preset,
      attempt: run.attempt,
      retryOfRunId: run.retryOfRunId || null,
      status: run.status,
      found: run.progress.found,
      downloaded: run.progress.downloaded,
      analyzed: run.progress.analyzed,
      ranked: run.progress.ranked,
      error: run.error || null,
      startedAt: startedAt || null,
      endedAt: endedAt || null,
      assetRef,
      payloadJson: toJson(run),
      updatedAt,
    },
    create: {
      id: run.id,
      workspaceId: run.workspaceId,
      sourcePlatform: run.sourcePlatform,
      sourceUrl: run.sourceUrl,
      maxVideos: run.maxVideos,
      lookbackDays: run.lookbackDays,
      sortBy: run.sortBy,
      preset: run.preset,
      attempt: run.attempt,
      retryOfRunId: run.retryOfRunId || null,
      status: run.status,
      found: run.progress.found,
      downloaded: run.progress.downloaded,
      analyzed: run.progress.analyzed,
      ranked: run.progress.ranked,
      error: run.error || null,
      startedAt: startedAt || null,
      endedAt: endedAt || null,
      assetRef,
      payloadJson: toJson(run),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      sourcePlatform: true,
      sourceUrl: true,
      maxVideos: true,
      lookbackDays: true,
      sortBy: true,
      preset: true,
      attempt: true,
      retryOfRunId: true,
      status: true,
      found: true,
      downloaded: true,
      analyzed: true,
      ranked: true,
      error: true,
      startedAt: true,
      endedAt: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          events: true,
        },
      },
    },
  });
  return withPersistedMeta(
    parseIngestionPayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      sourcePlatform: row.sourcePlatform,
      sourceUrl: row.sourceUrl,
      maxVideos: row.maxVideos,
      lookbackDays: row.lookbackDays,
      sortBy: row.sortBy,
      preset: row.preset,
      attempt: row.attempt,
      retryOfRunId: row.retryOfRunId,
      status: row.status,
      found: row.found,
      downloaded: row.downloaded,
      analyzed: row.analyzed,
      ranked: row.ranked,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      assetRef: row.assetRef,
      eventCount: row._count.events,
    }) as JsonRecord,
    row.updatedAt
  ) as IngestionRun;
}

export async function repositoryListIngestionRuns(workspaceId: string): Promise<IngestionRun[]> {
  const rows = await prisma.viralStudioIngestionRun.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      workspaceId: true,
      sourcePlatform: true,
      sourceUrl: true,
      maxVideos: true,
      lookbackDays: true,
      sortBy: true,
      preset: true,
      attempt: true,
      retryOfRunId: true,
      status: true,
      found: true,
      downloaded: true,
      analyzed: true,
      ranked: true,
      error: true,
      startedAt: true,
      endedAt: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          events: true,
        },
      },
    },
  });
  return rows.map((row) =>
    withPersistedMeta(
      parseIngestionPayload(row.payloadJson, {
        id: row.id,
        workspaceId: row.workspaceId,
        sourcePlatform: row.sourcePlatform,
        sourceUrl: row.sourceUrl,
        maxVideos: row.maxVideos,
        lookbackDays: row.lookbackDays,
        sortBy: row.sortBy,
        preset: row.preset,
        attempt: row.attempt,
        retryOfRunId: row.retryOfRunId,
        status: row.status,
        found: row.found,
        downloaded: row.downloaded,
        analyzed: row.analyzed,
        ranked: row.ranked,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        assetRef: row.assetRef,
        eventCount: row._count.events,
      }) as JsonRecord,
      row.updatedAt
    ) as IngestionRun
  );
}

export async function repositoryListNonTerminalIngestionRuns(workspaceId: string): Promise<IngestionRun[]> {
  const rows = await prisma.viralStudioIngestionRun.findMany({
    where: {
      workspaceId,
      status: {
        in: ['queued', 'running'],
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      workspaceId: true,
      sourcePlatform: true,
      sourceUrl: true,
      maxVideos: true,
      lookbackDays: true,
      sortBy: true,
      preset: true,
      attempt: true,
      retryOfRunId: true,
      status: true,
      found: true,
      downloaded: true,
      analyzed: true,
      ranked: true,
      error: true,
      startedAt: true,
      endedAt: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          events: true,
        },
      },
    },
  });
  return rows.map((row) =>
    withPersistedMeta(
      parseIngestionPayload(row.payloadJson, {
        id: row.id,
        workspaceId: row.workspaceId,
        sourcePlatform: row.sourcePlatform,
        sourceUrl: row.sourceUrl,
        maxVideos: row.maxVideos,
        lookbackDays: row.lookbackDays,
        sortBy: row.sortBy,
        preset: row.preset,
        attempt: row.attempt,
        retryOfRunId: row.retryOfRunId,
        status: row.status,
        found: row.found,
        downloaded: row.downloaded,
        analyzed: row.analyzed,
        ranked: row.ranked,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        assetRef: row.assetRef,
        eventCount: row._count.events,
      }) as JsonRecord,
      row.updatedAt
    ) as IngestionRun
  );
}

export async function repositoryGetIngestionRun(workspaceId: string, ingestionRunId: string): Promise<IngestionRun | null> {
  const row = await prisma.viralStudioIngestionRun.findFirst({
    where: { id: ingestionRunId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      sourcePlatform: true,
      sourceUrl: true,
      maxVideos: true,
      lookbackDays: true,
      sortBy: true,
      preset: true,
      attempt: true,
      retryOfRunId: true,
      status: true,
      found: true,
      downloaded: true,
      analyzed: true,
      ranked: true,
      error: true,
      startedAt: true,
      endedAt: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          events: true,
        },
      },
    },
  });
  if (!row) return null;
  return withPersistedMeta(
    parseIngestionPayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      sourcePlatform: row.sourcePlatform,
      sourceUrl: row.sourceUrl,
      maxVideos: row.maxVideos,
      lookbackDays: row.lookbackDays,
      sortBy: row.sortBy,
      preset: row.preset,
      attempt: row.attempt,
      retryOfRunId: row.retryOfRunId,
      status: row.status,
      found: row.found,
      downloaded: row.downloaded,
      analyzed: row.analyzed,
      ranked: row.ranked,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      assetRef: row.assetRef,
      eventCount: row._count.events,
    }) as JsonRecord,
    row.updatedAt
  ) as IngestionRun;
}

export async function repositoryAppendIngestionEvent(input: {
  workspaceId: string;
  ingestionRunId: string;
  type: string;
  status?: string;
  message: string;
  payload?: JsonRecord;
}): Promise<ViralStudioIngestionEventRecord> {
  const row = await prisma.viralStudioIngestionEvent.create({
    data: {
      workspaceId: input.workspaceId,
      ingestionRunId: input.ingestionRunId,
      type: input.type,
      status: input.status || null,
      message: input.message,
      payloadJson: input.payload ? toJson(input.payload) : undefined,
    },
    select: {
      id: true,
      workspaceId: true,
      ingestionRunId: true,
      type: true,
      status: true,
      message: true,
      payloadJson: true,
      createdAt: true,
    },
  });
  return toEventRecord(row);
}

export async function repositoryListIngestionEvents(
  workspaceId: string,
  ingestionRunId: string,
  options?: {
    afterId?: number;
    limit?: number;
  }
): Promise<ViralStudioIngestionEventRecord[]> {
  const limit = Math.max(1, Math.min(500, Number(options?.limit || 240)));
  const afterId = typeof options?.afterId === 'number' ? options?.afterId : undefined;
  const rows = await prisma.viralStudioIngestionEvent.findMany({
    where: {
      workspaceId,
      ingestionRunId,
      ...(typeof afterId === 'number' ? { id: { gt: afterId } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      workspaceId: true,
      ingestionRunId: true,
      type: true,
      status: true,
      message: true,
      payloadJson: true,
      createdAt: true,
    },
  });
  return rows.map((row) => toEventRecord(row));
}

export async function repositoryReplaceIngestionReferences(
  workspaceId: string,
  ingestionRunId: string,
  references: ReferenceAsset[]
): Promise<ReferenceAsset[]> {
  const ids = references.map((item) => item.id).filter(Boolean);
  await prisma.$transaction(async (tx) => {
    if (ids.length === 0) {
      await tx.viralStudioReferenceAsset.deleteMany({
        where: { workspaceId, ingestionRunId },
      });
      return;
    }
    await tx.viralStudioReferenceAsset.deleteMany({
      where: {
        workspaceId,
        ingestionRunId,
        id: { notIn: ids },
      },
    });
    for (const item of references) {
      const createdAt = toDate(item.createdAt) || new Date();
      const updatedAt = toDate(item.updatedAt) || new Date();
      const assetRef = ensureAssetRef(item.workspaceId, 'reference', item.id, (item as any).assetRef);
      await tx.viralStudioReferenceAsset.upsert({
        where: { id: item.id },
        update: {
          sourcePlatform: item.sourcePlatform,
          sourceUrl: item.sourceUrl,
          caption: item.caption,
          viralScore: Number(item.scores?.composite || 0),
          rank: Number(item.ranking?.rank || 0),
          shortlistState: item.shortlistState,
          assetRef,
          explainabilityJson: toJson(item.explainability),
          payloadJson: toJson(item),
          updatedAt,
        },
        create: {
          id: item.id,
          workspaceId: item.workspaceId,
          ingestionRunId: item.ingestionRunId,
          sourcePlatform: item.sourcePlatform,
          sourceUrl: item.sourceUrl,
          caption: item.caption,
          viralScore: Number(item.scores?.composite || 0),
          rank: Number(item.ranking?.rank || 0),
          shortlistState: item.shortlistState,
          assetRef,
          explainabilityJson: toJson(item.explainability),
          payloadJson: toJson(item),
          createdAt,
          updatedAt,
        },
      });
    }
  });
  return repositoryListReferenceAssets(workspaceId, { ingestionRunId, includeExcluded: true });
}

export async function repositoryUpsertReferenceAsset(item: ReferenceAsset): Promise<ReferenceAsset> {
  const createdAt = toDate(item.createdAt) || new Date();
  const updatedAt = toDate(item.updatedAt) || new Date();
  const assetRef = ensureAssetRef(item.workspaceId, 'reference', item.id, (item as any).assetRef);
  const row = await prisma.viralStudioReferenceAsset.upsert({
    where: { id: item.id },
    update: {
      sourcePlatform: item.sourcePlatform,
      sourceUrl: item.sourceUrl,
      caption: item.caption,
      viralScore: Number(item.scores?.composite || 0),
      rank: Number(item.ranking?.rank || 0),
      shortlistState: item.shortlistState,
      assetRef,
      explainabilityJson: toJson(item.explainability),
      payloadJson: toJson(item),
      updatedAt,
    },
    create: {
      id: item.id,
      workspaceId: item.workspaceId,
      ingestionRunId: item.ingestionRunId,
      sourcePlatform: item.sourcePlatform,
      sourceUrl: item.sourceUrl,
      caption: item.caption,
      viralScore: Number(item.scores?.composite || 0),
      rank: Number(item.ranking?.rank || 0),
      shortlistState: item.shortlistState,
      assetRef,
      explainabilityJson: toJson(item.explainability),
      payloadJson: toJson(item),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      ingestionRunId: true,
      sourcePlatform: true,
      sourceUrl: true,
      caption: true,
      shortlistState: true,
      rank: true,
      viralScore: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return withPersistedMeta(
    parseReferencePayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      ingestionRunId: row.ingestionRunId,
      sourcePlatform: row.sourcePlatform,
      sourceUrl: row.sourceUrl,
      caption: row.caption,
      shortlistState: row.shortlistState,
      rank: row.rank,
      viralScore: row.viralScore,
      assetRef: row.assetRef,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }) as JsonRecord,
    row.updatedAt
  ) as ReferenceAsset;
}

export async function repositoryListReferenceAssets(
  workspaceId: string,
  filters?: ReferenceListFilters
): Promise<ReferenceAsset[]> {
  const ingestionRunId = String(filters?.ingestionRunId || '').trim() || undefined;
  const shortlistOnly = Boolean(filters?.shortlistOnly);
  const includeExcluded = Boolean(filters?.includeExcluded);
  const rows = await prisma.viralStudioReferenceAsset.findMany({
    where: {
      workspaceId,
      ...(ingestionRunId ? { ingestionRunId } : {}),
      ...(shortlistOnly ? { shortlistState: { in: ['pin', 'must-use', 'exclude'] } } : {}),
      ...(includeExcluded ? {} : { shortlistState: { not: 'exclude' } }),
    },
    orderBy: [{ viralScore: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      workspaceId: true,
      ingestionRunId: true,
      sourcePlatform: true,
      sourceUrl: true,
      caption: true,
      shortlistState: true,
      rank: true,
      viralScore: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((row) =>
    withPersistedMeta(
      parseReferencePayload(row.payloadJson, {
        id: row.id,
        workspaceId: row.workspaceId,
        ingestionRunId: row.ingestionRunId,
        sourcePlatform: row.sourcePlatform,
        sourceUrl: row.sourceUrl,
        caption: row.caption,
        shortlistState: row.shortlistState,
        rank: row.rank,
        viralScore: row.viralScore,
        assetRef: row.assetRef,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }) as JsonRecord,
      row.updatedAt
    ) as ReferenceAsset
  );
}

export async function repositoryUpsertGenerationPack(generation: GenerationPack): Promise<GenerationPack> {
  const createdAt = toDate(generation.createdAt) || new Date();
  const updatedAt = toDate(generation.updatedAt) || new Date();
  const assetRef = ensureAssetRef(generation.workspaceId, 'generation', generation.id, (generation as any).assetRef);
  const row = await prisma.viralStudioGenerationPack.upsert({
    where: { id: generation.id },
    update: {
      status: generation.status,
      promptTemplateId: generation.promptTemplateId,
      formatTarget: generation.formatTarget,
      inputPrompt: generation.inputPrompt,
      revision: generation.revision,
      selectedReferenceIdsJson: toJson(generation.selectedReferenceIds),
      promptContextJson: toJson(generation.promptContext),
      outputsJson: toJson(generation.outputs),
      qualityCheckJson: toJson(generation.qualityCheck),
      assetRef,
      payloadJson: toJson(generation),
      updatedAt,
    },
    create: {
      id: generation.id,
      workspaceId: generation.workspaceId,
      status: generation.status,
      promptTemplateId: generation.promptTemplateId,
      formatTarget: generation.formatTarget,
      inputPrompt: generation.inputPrompt,
      revision: generation.revision,
      selectedReferenceIdsJson: toJson(generation.selectedReferenceIds),
      promptContextJson: toJson(generation.promptContext),
      outputsJson: toJson(generation.outputs),
      qualityCheckJson: toJson(generation.qualityCheck),
      assetRef,
      payloadJson: toJson(generation),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      promptTemplateId: true,
      formatTarget: true,
      inputPrompt: true,
      revision: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          revisions: true,
        },
      },
    },
  });
  return withPersistedMeta(
    parseGenerationPayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      status: row.status,
      promptTemplateId: row.promptTemplateId,
      formatTarget: row.formatTarget,
      inputPrompt: row.inputPrompt,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assetRef: row.assetRef,
      revisionCount: row._count.revisions,
    }) as JsonRecord,
    row.updatedAt
  ) as GenerationPack;
}

export async function repositoryUpsertGenerationRevision(input: {
  workspaceId: string;
  generationId: string;
  revisionNumber: number;
  mode?: string;
  section?: string;
  instruction?: string;
  payload: GenerationPack;
  qualityCheck?: JsonRecord;
}): Promise<void> {
  await prisma.viralStudioGenerationRevision.upsert({
    where: {
      generationId_revisionNumber: {
        generationId: input.generationId,
        revisionNumber: input.revisionNumber,
      },
    },
    update: {
      mode: input.mode || null,
      section: input.section || null,
      instruction: input.instruction || null,
      payloadJson: toJson(input.payload),
      qualityCheckJson: input.qualityCheck ? toJson(input.qualityCheck) : undefined,
    },
    create: {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      generationId: input.generationId,
      revisionNumber: input.revisionNumber,
      mode: input.mode || null,
      section: input.section || null,
      instruction: input.instruction || null,
      payloadJson: toJson(input.payload),
      qualityCheckJson: input.qualityCheck ? toJson(input.qualityCheck) : undefined,
    },
  });
}

export async function repositoryGetGenerationPack(workspaceId: string, generationId: string): Promise<GenerationPack | null> {
  const row = await prisma.viralStudioGenerationPack.findFirst({
    where: { workspaceId, id: generationId },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      promptTemplateId: true,
      formatTarget: true,
      inputPrompt: true,
      revision: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          revisions: true,
        },
      },
    },
  });
  if (!row) return null;
  return withPersistedMeta(
    parseGenerationPayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      status: row.status,
      promptTemplateId: row.promptTemplateId,
      formatTarget: row.formatTarget,
      inputPrompt: row.inputPrompt,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assetRef: row.assetRef,
      revisionCount: row._count.revisions,
    }) as JsonRecord,
    row.updatedAt
  ) as GenerationPack;
}

export async function repositoryListGenerationPacks(workspaceId: string): Promise<GenerationPack[]> {
  const rows = await prisma.viralStudioGenerationPack.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      promptTemplateId: true,
      formatTarget: true,
      inputPrompt: true,
      revision: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          revisions: true,
        },
      },
    },
  });
  return rows.map((row) =>
    withPersistedMeta(
      parseGenerationPayload(row.payloadJson, {
        id: row.id,
        workspaceId: row.workspaceId,
        status: row.status,
        promptTemplateId: row.promptTemplateId,
        formatTarget: row.formatTarget,
        inputPrompt: row.inputPrompt,
        revision: row.revision,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        assetRef: row.assetRef,
        revisionCount: row._count.revisions,
      }) as JsonRecord,
      row.updatedAt
    ) as GenerationPack
  );
}

export async function repositoryUpsertDocument(
  document: StudioDocument,
  generationId: string
): Promise<StudioDocument> {
  const createdAt = toDate(document.createdAt) || new Date();
  const updatedAt = toDate(document.updatedAt) || new Date();
  const assetRef = ensureAssetRef(document.workspaceId, 'document', document.id, (document as any).assetRef);
  const row = await prisma.viralStudioDocument.upsert({
    where: { id: document.id },
    update: {
      generationId,
      title: document.title,
      linkedGenerationIdsJson: toJson(document.linkedGenerationIds),
      sectionsJson: toJson(document.sections),
      currentVersionId: document.currentVersionId,
      assetRef,
      payloadJson: toJson(document),
      updatedAt,
    },
    create: {
      id: document.id,
      workspaceId: document.workspaceId,
      generationId,
      title: document.title,
      linkedGenerationIdsJson: toJson(document.linkedGenerationIds),
      sectionsJson: toJson(document.sections),
      currentVersionId: document.currentVersionId,
      assetRef,
      payloadJson: toJson(document),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      currentVersionId: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return withPersistedMeta(
    parseDocumentPayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      currentVersionId: row.currentVersionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assetRef: row.assetRef,
    }) as JsonRecord,
    row.updatedAt
  ) as StudioDocument;
}

export async function repositoryUpsertDocumentVersion(
  version: StudioDocumentVersion,
  versionNumber: number
): Promise<StudioDocumentVersion> {
  const createdAt = toDate(version.createdAt) || new Date();
  const assetRef = ensureAssetRef(version.workspaceId, 'document-version', version.id, (version as any).assetRef);
  const row = await prisma.viralStudioDocumentVersion.upsert({
    where: { id: version.id },
    update: {
      versionNumber,
      author: version.author,
      summary: version.summary,
      basedOnVersionId: version.basedOnVersionId || null,
      snapshotSectionsJson: toJson(version.snapshotSections),
      assetRef,
      payloadJson: toJson(version),
    },
    create: {
      id: version.id,
      workspaceId: version.workspaceId,
      documentId: version.documentId,
      versionNumber,
      author: version.author,
      summary: version.summary,
      basedOnVersionId: version.basedOnVersionId || null,
      snapshotSectionsJson: toJson(version.snapshotSections),
      assetRef,
      payloadJson: toJson(version),
      createdAt,
    },
    select: {
      id: true,
      workspaceId: true,
      documentId: true,
      author: true,
      summary: true,
      basedOnVersionId: true,
      versionNumber: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
    },
  });
  return withPersistedMeta(
    parseDocumentVersionPayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      documentId: row.documentId,
      author: row.author,
      summary: row.summary,
      basedOnVersionId: row.basedOnVersionId,
      createdAt: row.createdAt,
      versionNumber: row.versionNumber,
      assetRef: row.assetRef,
    }) as JsonRecord,
    row.createdAt
  ) as StudioDocumentVersion;
}

export async function repositoryGetDocumentWithVersions(
  workspaceId: string,
  documentId: string
): Promise<{ document: StudioDocument; versions: StudioDocumentVersion[] } | null> {
  const row = await prisma.viralStudioDocument.findFirst({
    where: { workspaceId, id: documentId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      currentVersionId: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      versions: {
        orderBy: [{ versionNumber: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          workspaceId: true,
          documentId: true,
          author: true,
          summary: true,
          basedOnVersionId: true,
          versionNumber: true,
          assetRef: true,
          payloadJson: true,
          createdAt: true,
        },
      },
    },
  });
  if (!row) return null;
  const document = withPersistedMeta(
    parseDocumentPayload(row.payloadJson, {
      id: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      currentVersionId: row.currentVersionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assetRef: row.assetRef,
    }) as JsonRecord,
    row.updatedAt
  ) as StudioDocument;
  const versions = row.versions.map((versionRow) =>
    withPersistedMeta(
      parseDocumentVersionPayload(versionRow.payloadJson, {
        id: versionRow.id,
        workspaceId: versionRow.workspaceId,
        documentId: versionRow.documentId,
        author: versionRow.author,
        summary: versionRow.summary,
        basedOnVersionId: versionRow.basedOnVersionId,
        createdAt: versionRow.createdAt,
        versionNumber: versionRow.versionNumber,
        assetRef: versionRow.assetRef,
      }) as JsonRecord,
      versionRow.createdAt
    ) as StudioDocumentVersion
  );
  return {
    document: {
      ...document,
      versionCount: versions.length,
    } as StudioDocument,
    versions,
  };
}

export async function repositoryListDocumentsWithVersions(workspaceId: string): Promise<Array<{
  document: StudioDocument;
  versions: StudioDocumentVersion[];
}>> {
  const rows = await prisma.viralStudioDocument.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      currentVersionId: true,
      assetRef: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
      versions: {
        orderBy: [{ versionNumber: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          workspaceId: true,
          documentId: true,
          author: true,
          summary: true,
          basedOnVersionId: true,
          versionNumber: true,
          assetRef: true,
          payloadJson: true,
          createdAt: true,
        },
      },
    },
  });
  return rows.map((row) => {
    const document = withPersistedMeta(
      parseDocumentPayload(row.payloadJson, {
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        currentVersionId: row.currentVersionId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        assetRef: row.assetRef,
      }) as JsonRecord,
      row.updatedAt
    ) as StudioDocument;
    const versions = row.versions.map((versionRow) =>
      withPersistedMeta(
        parseDocumentVersionPayload(versionRow.payloadJson, {
          id: versionRow.id,
          workspaceId: versionRow.workspaceId,
          documentId: versionRow.documentId,
          author: versionRow.author,
          summary: versionRow.summary,
          basedOnVersionId: versionRow.basedOnVersionId,
          createdAt: versionRow.createdAt,
          versionNumber: versionRow.versionNumber,
          assetRef: versionRow.assetRef,
        }) as JsonRecord,
        versionRow.createdAt
      ) as StudioDocumentVersion
    );
    return {
      document: {
        ...document,
        versionCount: versions.length,
      } as StudioDocument,
      versions,
    };
  });
}

export async function repositoryAppendTelemetryEvent(
  workspaceId: string,
  event: ViralStudioTelemetryRuntimeEvent
): Promise<void> {
  await prisma.viralStudioTelemetryEvent.create({
    data: {
      workspaceId,
      name: event.name,
      stage: event.stage,
      status: event.status,
      durationMs: Math.max(0, Math.floor(Number(event.durationMs || 0))),
      payloadJson: toJson(event),
      createdAt: toDate(event.at) || new Date(),
    },
  });
}

export async function repositoryListTelemetryEvents(
  workspaceId: string,
  limit = 200
): Promise<ViralStudioTelemetryRuntimeEvent[]> {
  const rows = await prisma.viralStudioTelemetryEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(500, limit)),
    select: {
      name: true,
      stage: true,
      status: true,
      durationMs: true,
      payloadJson: true,
      createdAt: true,
    },
  });
  return rows.map((row) => {
    const payload = asRecord(row.payloadJson);
    const event = {
      name: String(payload.name || row.name),
      stage: (String(payload.stage || row.stage) || 'platform') as ViralStudioTelemetryRuntimeEvent['stage'],
      status: (String(payload.status || row.status) || 'ok') as ViralStudioTelemetryRuntimeEvent['status'],
      durationMs: Number(payload.durationMs ?? row.durationMs) || 0,
      at: String(payload.at || row.createdAt.toISOString()),
    };
    return event;
  });
}

export async function repositoryLoadWorkspaceSnapshot(workspaceId: string): Promise<{
  brandDna: BrandDNAProfile | null;
  ingestions: IngestionRun[];
  references: ReferenceAsset[];
  generations: GenerationPack[];
  documents: Array<{ document: StudioDocument; versions: StudioDocumentVersion[] }>;
  telemetry: ViralStudioTelemetryRuntimeEvent[];
}> {
  const [brandDna, ingestions, references, generations, documents, telemetry] = await Promise.all([
    repositoryGetBrandDnaProfile(workspaceId),
    repositoryListIngestionRuns(workspaceId),
    repositoryListReferenceAssets(workspaceId, { includeExcluded: true }),
    repositoryListGenerationPacks(workspaceId),
    repositoryListDocumentsWithVersions(workspaceId),
    repositoryListTelemetryEvents(workspaceId, 500),
  ]);
  return {
    brandDna,
    ingestions,
    references,
    generations,
    documents,
    telemetry,
  };
}

export async function repositoryGetWorkspacePersistenceCounts(workspaceId: string): Promise<Record<string, number>> {
  const [
    brandDna,
    ingestionRuns,
    ingestionEvents,
    references,
    generations,
    generationRevisions,
    documents,
    documentVersions,
    telemetryEvents,
  ] = await Promise.all([
    prisma.viralStudioBrandDnaProfile.count({ where: { workspaceId } }),
    prisma.viralStudioIngestionRun.count({ where: { workspaceId } }),
    prisma.viralStudioIngestionEvent.count({ where: { workspaceId } }),
    prisma.viralStudioReferenceAsset.count({ where: { workspaceId } }),
    prisma.viralStudioGenerationPack.count({ where: { workspaceId } }),
    prisma.viralStudioGenerationRevision.count({ where: { workspaceId } }),
    prisma.viralStudioDocument.count({ where: { workspaceId } }),
    prisma.viralStudioDocumentVersion.count({ where: { workspaceId } }),
    prisma.viralStudioTelemetryEvent.count({ where: { workspaceId } }),
  ]);
  return {
    brandDna,
    ingestionRuns,
    ingestionEvents,
    references,
    generations,
    generationRevisions,
    documents,
    documentVersions,
    telemetryEvents,
  };
}

export async function repositoryResolveViralStudioAssetRef(
  workspaceId: string,
  assetRef: string
): Promise<ViralStudioResolvedAssetRef | null> {
  const parsed = parseViralStudioAssetRef(assetRef);
  if (!parsed) return null;
  if (parsed.workspaceId !== workspaceId) return null;

  if (parsed.kind === 'reference') {
    const row = await prisma.viralStudioReferenceAsset.findFirst({
      where: { workspaceId, id: parsed.id },
      select: {
        id: true,
        assetRef: true,
        caption: true,
        sourceUrl: true,
        viralScore: true,
        rank: true,
        payloadJson: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    const payload = asRecord(row.payloadJson);
    return {
      workspaceId,
      kind: parsed.kind,
      id: row.id,
      assetRef: row.assetRef || assetRef,
      title: `Viral reference #${Math.max(1, Math.floor(Number(row.rank || 1)))}`,
      summary:
        String(payload?.ranking && asRecord(payload.ranking).rationaleTitle) ||
        String(row.caption || '').slice(0, 220) ||
        `Composite score ${Number(row.viralScore || 0).toFixed(3)}`,
      ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
      createdAt: row.createdAt.toISOString(),
      metadata: {
        score: Number(row.viralScore || 0),
        rank: Number(row.rank || 0),
      },
    };
  }

  if (parsed.kind === 'generation') {
    const row = await prisma.viralStudioGenerationPack.findFirst({
      where: { workspaceId, id: parsed.id },
      select: {
        id: true,
        assetRef: true,
        formatTarget: true,
        inputPrompt: true,
        revision: true,
        payloadJson: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    const payload = asRecord(row.payloadJson);
    const promptContext = asRecord(payload.promptContext);
    return {
      workspaceId,
      kind: parsed.kind,
      id: row.id,
      assetRef: row.assetRef || assetRef,
      title: `Generation pack (${String(row.formatTarget || 'reel-30')})`,
      summary:
        String(promptContext.objective || '') ||
        String(row.inputPrompt || '').slice(0, 240) ||
        `Generation revision ${Math.max(1, Math.floor(Number(row.revision || 1)))}`,
      createdAt: row.createdAt.toISOString(),
      metadata: {
        revision: Number(row.revision || 1),
        formatTarget: row.formatTarget,
      },
    };
  }

  if (parsed.kind === 'document-version') {
    const row = await prisma.viralStudioDocumentVersion.findFirst({
      where: { workspaceId, id: parsed.id },
      select: {
        id: true,
        documentId: true,
        versionNumber: true,
        summary: true,
        assetRef: true,
        payloadJson: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    return {
      workspaceId,
      kind: parsed.kind,
      id: row.id,
      assetRef: row.assetRef || assetRef,
      title: `Document version v${Math.max(1, Math.floor(Number(row.versionNumber || 1)))}`,
      summary: String(row.summary || '') || `Snapshot for document ${row.documentId}`,
      createdAt: row.createdAt.toISOString(),
      metadata: {
        documentId: row.documentId,
        versionNumber: row.versionNumber,
      },
    };
  }

  if (parsed.kind === 'document') {
    const row = await prisma.viralStudioDocument.findFirst({
      where: { workspaceId, id: parsed.id },
      select: {
        id: true,
        title: true,
        assetRef: true,
        payloadJson: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    return {
      workspaceId,
      kind: parsed.kind,
      id: row.id,
      assetRef: row.assetRef || assetRef,
      title: String(row.title || 'Viral Studio document'),
      summary: String(row.title || 'Viral Studio document'),
      createdAt: row.createdAt.toISOString(),
      metadata: asRecord(row.payloadJson),
    };
  }

  const row = await prisma.viralStudioIngestionRun.findFirst({
    where: { workspaceId, id: parsed.id },
    select: {
      id: true,
      sourcePlatform: true,
      sourceUrl: true,
      status: true,
      assetRef: true,
      createdAt: true,
    },
  });
  if (!row) return null;
  return {
    workspaceId,
    kind: parsed.kind,
    id: row.id,
    assetRef: row.assetRef || assetRef,
    title: `Ingestion run (${row.sourcePlatform})`,
    summary: `${row.status.toUpperCase()} • ${row.sourceUrl}`,
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    createdAt: row.createdAt.toISOString(),
    metadata: {
      status: row.status,
      sourcePlatform: row.sourcePlatform,
    },
  };
}

export function repositoryAttachStorageMode<T extends JsonRecord>(payload: T, storageMode: string): T {
  return withStorageMode(payload, storageMode);
}
