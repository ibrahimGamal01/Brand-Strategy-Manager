import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type {
  ApprovedContentDirection,
  ApprovedDesignDirection,
  ContentDirectionCandidate,
  DesignDirectionCandidate,
  FormatGenerationJob,
  ViralStudioPlannerSession,
} from './viral-studio-planner';

type JsonRecord = Record<string, unknown>;

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

function parsePlannerSessionPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    stage: string;
    shortlistedReferenceIds: Prisma.JsonValue | null;
    approvedDesignDirectionId: string | null;
    approvedContentDirectionId: string | null;
    selectedContentType: string | null;
    latestFormatGenerationId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
): ViralStudioPlannerSession {
  const parsed = asRecord(value);
  return {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    stage: String(parsed.stage || fallback.stage) as ViralStudioPlannerSession['stage'],
    shortlistedReferenceIds: asArray(parsed.shortlistedReferenceIds || fallback.shortlistedReferenceIds)
      .map((entry) => String(entry || ''))
      .filter(Boolean),
    ...(String(parsed.approvedDesignDirectionId || fallback.approvedDesignDirectionId || '')
      ? { approvedDesignDirectionId: String(parsed.approvedDesignDirectionId || fallback.approvedDesignDirectionId) }
      : {}),
    ...(String(parsed.approvedContentDirectionId || fallback.approvedContentDirectionId || '')
      ? { approvedContentDirectionId: String(parsed.approvedContentDirectionId || fallback.approvedContentDirectionId) }
      : {}),
    ...(String(parsed.selectedContentType || fallback.selectedContentType || '')
      ? { selectedContentType: String(parsed.selectedContentType || fallback.selectedContentType) as ViralStudioPlannerSession['selectedContentType'] }
      : {}),
    ...(String(parsed.latestFormatGenerationId || fallback.latestFormatGenerationId || '')
      ? { latestFormatGenerationId: String(parsed.latestFormatGenerationId || fallback.latestFormatGenerationId) }
      : {}),
    createdAt: String(parsed.createdAt || fallback.createdAt.toISOString()),
    updatedAt: String(parsed.updatedAt || fallback.updatedAt.toISOString()),
  };
}

function parseDesignDirectionPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    sessionId: string;
    orderIndex: number;
    archetypeName: string;
    createdAt: Date;
    updatedAt: Date;
  }
): DesignDirectionCandidate {
  const parsed = asRecord(value);
  return {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    sessionId: fallback.sessionId,
    orderIndex: Number(parsed.orderIndex || fallback.orderIndex || 0),
    archetypeName: String(parsed.archetypeName || fallback.archetypeName || ''),
    sourceReferenceIds: asArray(parsed.sourceReferenceIds).map((entry) => String(entry || '')).filter(Boolean),
    summary: String(parsed.summary || ''),
    layoutPattern: String(parsed.layoutPattern || ''),
    typographyCharacter: String(parsed.typographyCharacter || ''),
    colorPaletteSummary: String(parsed.colorPaletteSummary || ''),
    motionPacingNotes: String(parsed.motionPacingNotes || ''),
    hookFramingPattern: String(parsed.hookFramingPattern || ''),
    onScreenTextStyle: String(parsed.onScreenTextStyle || ''),
    proofStructure: String(parsed.proofStructure || ''),
    ctaPresentationStyle: String(parsed.ctaPresentationStyle || ''),
    bestFor: asArray(parsed.bestFor).map((entry) => String(entry || '')).filter(Boolean),
    whyGrouped: asArray(parsed.whyGrouped).map((entry) => String(entry || '')).filter(Boolean),
    pros: asArray(parsed.pros).map((entry) => String(entry || '')).filter(Boolean),
    risks: asArray(parsed.risks).map((entry) => String(entry || '')).filter(Boolean),
    thumbnailCluster: asArray(parsed.thumbnailCluster)
      .map((entry) => asRecord(entry))
      .map((entry) => ({
        referenceId: String(entry.referenceId || ''),
        platform: String(entry.platform || 'instagram') as DesignDirectionCandidate['thumbnailCluster'][number]['platform'],
        label: String(entry.label || ''),
        ...(String(entry.mediaUrl || '') ? { mediaUrl: String(entry.mediaUrl) } : {}),
      }))
      .filter((entry) => entry.referenceId || entry.label),
    createdAt: String(parsed.createdAt || fallback.createdAt.toISOString()),
    updatedAt: String(parsed.updatedAt || fallback.updatedAt.toISOString()),
  };
}

function parseApprovedDesignDirectionPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    sessionId: string;
    candidateId: string;
    createdAt: Date;
    updatedAt: Date;
  }
): ApprovedDesignDirection {
  const parsed = parseDesignDirectionPayload(value, {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    sessionId: fallback.sessionId,
    orderIndex: Number(asRecord(value).orderIndex || 0),
    archetypeName: String(asRecord(value).archetypeName || ''),
    createdAt: fallback.createdAt,
    updatedAt: fallback.updatedAt,
  });
  return {
    ...parsed,
    candidateId: String(asRecord(value).candidateId || fallback.candidateId),
    approvedAt: String(asRecord(value).approvedAt || fallback.updatedAt.toISOString()),
  };
}

function parseContentDirectionPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    sessionId: string;
    approvedDesignDirectionId: string;
    orderIndex: number;
    createdAt: Date;
    updatedAt: Date;
  }
): ContentDirectionCandidate {
  const parsed = asRecord(value);
  return {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    sessionId: fallback.sessionId,
    approvedDesignDirectionId: String(parsed.approvedDesignDirectionId || fallback.approvedDesignDirectionId),
    orderIndex: Number(parsed.orderIndex || fallback.orderIndex || 0),
    title: String(parsed.title || ''),
    coreAudience: String(parsed.coreAudience || ''),
    targetedPain: String(parsed.targetedPain || ''),
    targetedDesire: String(parsed.targetedDesire || ''),
    bigPromise: String(parsed.bigPromise || ''),
    proofAngle: String(parsed.proofAngle || ''),
    objectionHandling: String(parsed.objectionHandling || ''),
    ctaIntent: String(parsed.ctaIntent || ''),
    toneStance: String(parsed.toneStance || ''),
    recommendedUseCases: asArray(parsed.recommendedUseCases).map((entry) => String(entry || '')).filter(Boolean),
    whyFitsDesign: asArray(parsed.whyFitsDesign).map((entry) => String(entry || '')).filter(Boolean),
    sourceReferenceIds: asArray(parsed.sourceReferenceIds).map((entry) => String(entry || '')).filter(Boolean),
    createdAt: String(parsed.createdAt || fallback.createdAt.toISOString()),
    updatedAt: String(parsed.updatedAt || fallback.updatedAt.toISOString()),
  };
}

function parseApprovedContentDirectionPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    sessionId: string;
    candidateId: string;
    approvedDesignDirectionId: string;
    createdAt: Date;
    updatedAt: Date;
  }
): ApprovedContentDirection {
  const parsed = parseContentDirectionPayload(value, {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    sessionId: fallback.sessionId,
    approvedDesignDirectionId: fallback.approvedDesignDirectionId,
    orderIndex: Number(asRecord(value).orderIndex || 0),
    createdAt: fallback.createdAt,
    updatedAt: fallback.updatedAt,
  });
  return {
    ...parsed,
    candidateId: String(asRecord(value).candidateId || fallback.candidateId),
    approvedAt: String(asRecord(value).approvedAt || fallback.updatedAt.toISOString()),
  };
}

function parseFormatGenerationPayload(
  value: Prisma.JsonValue | null,
  fallback: {
    id: string;
    workspaceId: string;
    sessionId: string;
    approvedDesignDirectionId: string;
    approvedContentDirectionId: string;
    contentType: string;
    status: string;
    generationPackId: string;
    selectedReferenceIdsJson: Prisma.JsonValue | null;
    resultJson: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }
): FormatGenerationJob {
  const parsed = asRecord(value);
  const result = asRecord(parsed.result || fallback.resultJson);
  return {
    id: fallback.id,
    workspaceId: fallback.workspaceId,
    sessionId: fallback.sessionId,
    approvedDesignDirectionId: String(parsed.approvedDesignDirectionId || fallback.approvedDesignDirectionId),
    approvedContentDirectionId: String(parsed.approvedContentDirectionId || fallback.approvedContentDirectionId),
    contentType: String(parsed.contentType || fallback.contentType) as FormatGenerationJob['contentType'],
    status: String(parsed.status || fallback.status) as FormatGenerationJob['status'],
    generationPackId: String(parsed.generationPackId || fallback.generationPackId),
    selectedReferenceIds: asArray(parsed.selectedReferenceIds || fallback.selectedReferenceIdsJson)
      .map((entry) => String(entry || ''))
      .filter(Boolean),
    result: {
      title: String(result.title || ''),
      summary: String(result.summary || ''),
      contentType: String(result.contentType || fallback.contentType) as FormatGenerationJob['contentType'],
      approvedDesignDirectionId: String(result.approvedDesignDirectionId || fallback.approvedDesignDirectionId),
      approvedContentDirectionId: String(result.approvedContentDirectionId || fallback.approvedContentDirectionId),
      sourceReferenceIds: asArray(result.sourceReferenceIds).map((entry) => String(entry || '')).filter(Boolean),
      designDetails: {
        layoutStructure: asArray(asRecord(result.designDetails).layoutStructure).map((entry) => String(entry || '')).filter(Boolean),
        typographyTreatment: String(asRecord(result.designDetails).typographyTreatment || ''),
        onScreenTextGuidance: asArray(asRecord(result.designDetails).onScreenTextGuidance)
          .map((entry) => String(entry || ''))
          .filter(Boolean),
        pacingOrFrameStructure: asArray(asRecord(result.designDetails).pacingOrFrameStructure)
          .map((entry) => String(entry || ''))
          .filter(Boolean),
        visualCompositionNotes: asArray(asRecord(result.designDetails).visualCompositionNotes)
          .map((entry) => String(entry || ''))
          .filter(Boolean),
        assetSuggestions: asArray(asRecord(result.designDetails).assetSuggestions)
          .map((entry) => String(entry || ''))
          .filter(Boolean),
      },
      contentDetails: {
        hook: String(asRecord(result.contentDetails).hook || ''),
        narrativeBeats: asArray(asRecord(result.contentDetails).narrativeBeats)
          .map((entry) => String(entry || ''))
          .filter(Boolean),
        proofPlacement: String(asRecord(result.contentDetails).proofPlacement || ''),
        cta: String(asRecord(result.contentDetails).cta || ''),
        captionGuidance: asArray(asRecord(result.contentDetails).captionGuidance)
          .map((entry) => String(entry || ''))
          .filter(Boolean),
        variantIdeas: asArray(asRecord(result.contentDetails).variantIdeas)
          .map((entry) => String(entry || ''))
          .filter(Boolean),
      },
    },
    createdAt: String(parsed.createdAt || fallback.createdAt.toISOString()),
    updatedAt: String(parsed.updatedAt || fallback.updatedAt.toISOString()),
  };
}

export async function repositoryGetPlannerSession(workspaceId: string): Promise<ViralStudioPlannerSession | null> {
  const row = await prisma.viralStudioPlannerSession.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      workspaceId: true,
      stage: true,
      shortlistedReferenceIds: true,
      approvedDesignDirectionId: true,
      approvedContentDirectionId: true,
      selectedContentType: true,
      latestFormatGenerationId: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  return withPersistedMeta(
    parsePlannerSessionPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as ViralStudioPlannerSession;
}

export async function repositoryUpsertPlannerSession(
  session: ViralStudioPlannerSession
): Promise<ViralStudioPlannerSession> {
  const createdAt = toDate(session.createdAt) || new Date();
  const updatedAt = toDate(session.updatedAt) || new Date();
  const row = await prisma.viralStudioPlannerSession.upsert({
    where: { workspaceId: session.workspaceId },
    update: {
      stage: session.stage,
      shortlistedReferenceIds: toJson(session.shortlistedReferenceIds),
      approvedDesignDirectionId: session.approvedDesignDirectionId || null,
      approvedContentDirectionId: session.approvedContentDirectionId || null,
      selectedContentType: session.selectedContentType || null,
      latestFormatGenerationId: session.latestFormatGenerationId || null,
      payloadJson: toJson(session),
      updatedAt,
    },
    create: {
      id: session.id,
      workspaceId: session.workspaceId,
      stage: session.stage,
      shortlistedReferenceIds: toJson(session.shortlistedReferenceIds),
      approvedDesignDirectionId: session.approvedDesignDirectionId || null,
      approvedContentDirectionId: session.approvedContentDirectionId || null,
      selectedContentType: session.selectedContentType || null,
      latestFormatGenerationId: session.latestFormatGenerationId || null,
      payloadJson: toJson(session),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      stage: true,
      shortlistedReferenceIds: true,
      approvedDesignDirectionId: true,
      approvedContentDirectionId: true,
      selectedContentType: true,
      latestFormatGenerationId: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return withPersistedMeta(
    parsePlannerSessionPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as ViralStudioPlannerSession;
}

export async function repositoryListDesignDirectionCandidates(workspaceId: string): Promise<DesignDirectionCandidate[]> {
  const rows = await prisma.viralStudioDesignDirectionCandidate.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: 'desc' }, { orderIndex: 'asc' }],
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      orderIndex: true,
      archetypeName: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => withPersistedMeta(parseDesignDirectionPayload(row.payloadJson, row) as JsonRecord, row.updatedAt) as DesignDirectionCandidate);
}

export async function repositoryReplaceDesignDirectionCandidates(
  workspaceId: string,
  sessionId: string,
  candidates: DesignDirectionCandidate[]
): Promise<DesignDirectionCandidate[]> {
  await prisma.$transaction(async (tx) => {
    await tx.viralStudioDesignDirectionCandidate.deleteMany({ where: { workspaceId, sessionId } });
    for (const candidate of candidates) {
      const createdAt = toDate(candidate.createdAt) || new Date();
      const updatedAt = toDate(candidate.updatedAt) || new Date();
      await tx.viralStudioDesignDirectionCandidate.create({
        data: {
          id: candidate.id,
          workspaceId,
          sessionId,
          orderIndex: candidate.orderIndex,
          archetypeName: candidate.archetypeName,
          payloadJson: toJson(candidate),
          createdAt,
          updatedAt,
        },
      });
    }
  });
  const latest = await repositoryListDesignDirectionCandidates(workspaceId);
  return latest.filter((item) => item.sessionId === sessionId).sort((a, b) => a.orderIndex - b.orderIndex);
}

export async function repositoryGetDesignDirectionCandidate(
  workspaceId: string,
  id: string
): Promise<DesignDirectionCandidate | null> {
  const row = await prisma.viralStudioDesignDirectionCandidate.findFirst({
    where: { workspaceId, id },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      orderIndex: true,
      archetypeName: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  return withPersistedMeta(parseDesignDirectionPayload(row.payloadJson, row) as JsonRecord, row.updatedAt) as DesignDirectionCandidate;
}

export async function repositoryDeleteApprovedDesignDirection(workspaceId: string, sessionId: string): Promise<void> {
  await prisma.viralStudioApprovedDesignDirection.deleteMany({ where: { workspaceId, sessionId } });
}

export async function repositoryGetApprovedDesignDirection(
  workspaceId: string
): Promise<ApprovedDesignDirection | null> {
  const row = await prisma.viralStudioApprovedDesignDirection.findFirst({
    where: { workspaceId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      candidateId: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  return withPersistedMeta(
    parseApprovedDesignDirectionPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as ApprovedDesignDirection;
}

export async function repositoryUpsertApprovedDesignDirection(
  approval: ApprovedDesignDirection
): Promise<ApprovedDesignDirection> {
  const createdAt = toDate(approval.createdAt) || new Date();
  const updatedAt = toDate(approval.updatedAt) || new Date();
  const row = await prisma.viralStudioApprovedDesignDirection.upsert({
    where: { sessionId: approval.sessionId },
    update: {
      candidateId: approval.candidateId,
      payloadJson: toJson(approval),
      updatedAt,
    },
    create: {
      id: approval.id,
      workspaceId: approval.workspaceId,
      sessionId: approval.sessionId,
      candidateId: approval.candidateId,
      payloadJson: toJson(approval),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      candidateId: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return withPersistedMeta(
    parseApprovedDesignDirectionPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as ApprovedDesignDirection;
}

export async function repositoryListContentDirectionCandidates(workspaceId: string): Promise<ContentDirectionCandidate[]> {
  const rows = await prisma.viralStudioContentDirectionCandidate.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: 'desc' }, { orderIndex: 'asc' }],
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      approvedDesignDirectionId: true,
      orderIndex: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => withPersistedMeta(parseContentDirectionPayload(row.payloadJson, row) as JsonRecord, row.updatedAt) as ContentDirectionCandidate);
}

export async function repositoryReplaceContentDirectionCandidates(
  workspaceId: string,
  sessionId: string,
  candidates: ContentDirectionCandidate[]
): Promise<ContentDirectionCandidate[]> {
  await prisma.$transaction(async (tx) => {
    await tx.viralStudioContentDirectionCandidate.deleteMany({ where: { workspaceId, sessionId } });
    for (const candidate of candidates) {
      const createdAt = toDate(candidate.createdAt) || new Date();
      const updatedAt = toDate(candidate.updatedAt) || new Date();
      await tx.viralStudioContentDirectionCandidate.create({
        data: {
          id: candidate.id,
          workspaceId,
          sessionId,
          approvedDesignDirectionId: candidate.approvedDesignDirectionId,
          orderIndex: candidate.orderIndex,
          payloadJson: toJson(candidate),
          createdAt,
          updatedAt,
        },
      });
    }
  });
  const latest = await repositoryListContentDirectionCandidates(workspaceId);
  return latest.filter((item) => item.sessionId === sessionId).sort((a, b) => a.orderIndex - b.orderIndex);
}

export async function repositoryGetContentDirectionCandidate(
  workspaceId: string,
  id: string
): Promise<ContentDirectionCandidate | null> {
  const row = await prisma.viralStudioContentDirectionCandidate.findFirst({
    where: { workspaceId, id },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      approvedDesignDirectionId: true,
      orderIndex: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  return withPersistedMeta(parseContentDirectionPayload(row.payloadJson, row) as JsonRecord, row.updatedAt) as ContentDirectionCandidate;
}

export async function repositoryDeleteApprovedContentDirection(workspaceId: string, sessionId: string): Promise<void> {
  await prisma.viralStudioApprovedContentDirection.deleteMany({ where: { workspaceId, sessionId } });
}

export async function repositoryGetApprovedContentDirection(
  workspaceId: string
): Promise<ApprovedContentDirection | null> {
  const row = await prisma.viralStudioApprovedContentDirection.findFirst({
    where: { workspaceId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      candidateId: true,
      approvedDesignDirectionId: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  return withPersistedMeta(
    parseApprovedContentDirectionPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as ApprovedContentDirection;
}

export async function repositoryUpsertApprovedContentDirection(
  approval: ApprovedContentDirection
): Promise<ApprovedContentDirection> {
  const createdAt = toDate(approval.createdAt) || new Date();
  const updatedAt = toDate(approval.updatedAt) || new Date();
  const row = await prisma.viralStudioApprovedContentDirection.upsert({
    where: { sessionId: approval.sessionId },
    update: {
      candidateId: approval.candidateId,
      approvedDesignDirectionId: approval.approvedDesignDirectionId,
      payloadJson: toJson(approval),
      updatedAt,
    },
    create: {
      id: approval.id,
      workspaceId: approval.workspaceId,
      sessionId: approval.sessionId,
      candidateId: approval.candidateId,
      approvedDesignDirectionId: approval.approvedDesignDirectionId,
      payloadJson: toJson(approval),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      candidateId: true,
      approvedDesignDirectionId: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return withPersistedMeta(
    parseApprovedContentDirectionPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as ApprovedContentDirection;
}

export async function repositoryGetFormatGenerationJob(
  workspaceId: string,
  id: string
): Promise<FormatGenerationJob | null> {
  const row = await prisma.viralStudioFormatGenerationJob.findFirst({
    where: { workspaceId, id },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      approvedDesignDirectionId: true,
      approvedContentDirectionId: true,
      contentType: true,
      status: true,
      generationPackId: true,
      selectedReferenceIdsJson: true,
      resultJson: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  return withPersistedMeta(
    parseFormatGenerationPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as FormatGenerationJob;
}

export async function repositoryUpsertFormatGenerationJob(
  job: FormatGenerationJob
): Promise<FormatGenerationJob> {
  const createdAt = toDate(job.createdAt) || new Date();
  const updatedAt = toDate(job.updatedAt) || new Date();
  const row = await prisma.viralStudioFormatGenerationJob.upsert({
    where: { id: job.id },
    update: {
      approvedDesignDirectionId: job.approvedDesignDirectionId,
      approvedContentDirectionId: job.approvedContentDirectionId,
      contentType: job.contentType,
      status: job.status,
      generationPackId: job.generationPackId,
      selectedReferenceIdsJson: toJson(job.selectedReferenceIds),
      resultJson: toJson(job.result),
      payloadJson: toJson(job),
      updatedAt,
    },
    create: {
      id: job.id,
      workspaceId: job.workspaceId,
      sessionId: job.sessionId,
      approvedDesignDirectionId: job.approvedDesignDirectionId,
      approvedContentDirectionId: job.approvedContentDirectionId,
      contentType: job.contentType,
      status: job.status,
      generationPackId: job.generationPackId,
      selectedReferenceIdsJson: toJson(job.selectedReferenceIds),
      resultJson: toJson(job.result),
      payloadJson: toJson(job),
      createdAt,
      updatedAt,
    },
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      approvedDesignDirectionId: true,
      approvedContentDirectionId: true,
      contentType: true,
      status: true,
      generationPackId: true,
      selectedReferenceIdsJson: true,
      resultJson: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return withPersistedMeta(
    parseFormatGenerationPayload(row.payloadJson, row) as JsonRecord,
    row.updatedAt
  ) as FormatGenerationJob;
}

export async function repositoryLoadPlannerSnapshot(workspaceId: string): Promise<{
  session: ViralStudioPlannerSession | null;
  designDirections: DesignDirectionCandidate[];
  approvedDesign: ApprovedDesignDirection | null;
  contentDirections: ContentDirectionCandidate[];
  approvedContent: ApprovedContentDirection | null;
  formatJobs: FormatGenerationJob[];
}> {
  const [session, designDirections, approvedDesign, contentDirections, approvedContent, formatRows] = await Promise.all([
    repositoryGetPlannerSession(workspaceId),
    repositoryListDesignDirectionCandidates(workspaceId),
    repositoryGetApprovedDesignDirection(workspaceId),
    repositoryListContentDirectionCandidates(workspaceId),
    repositoryGetApprovedContentDirection(workspaceId),
    prisma.viralStudioFormatGenerationJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        workspaceId: true,
        sessionId: true,
        approvedDesignDirectionId: true,
        approvedContentDirectionId: true,
        contentType: true,
        status: true,
        generationPackId: true,
        selectedReferenceIdsJson: true,
        resultJson: true,
        payloadJson: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    session,
    designDirections,
    approvedDesign,
    contentDirections,
    approvedContent,
    formatJobs: formatRows.map((row) => withPersistedMeta(parseFormatGenerationPayload(row.payloadJson, row) as JsonRecord, row.updatedAt) as FormatGenerationJob),
  };
}

export async function repositoryGetPlannerPersistenceCounts(workspaceId: string): Promise<Record<string, number>> {
  const [sessions, designDirections, approvedDesigns, contentDirections, approvedContents, formatGenerations] =
    await Promise.all([
      prisma.viralStudioPlannerSession.count({ where: { workspaceId } }),
      prisma.viralStudioDesignDirectionCandidate.count({ where: { workspaceId } }),
      prisma.viralStudioApprovedDesignDirection.count({ where: { workspaceId } }),
      prisma.viralStudioContentDirectionCandidate.count({ where: { workspaceId } }),
      prisma.viralStudioApprovedContentDirection.count({ where: { workspaceId } }),
      prisma.viralStudioFormatGenerationJob.count({ where: { workspaceId } }),
    ]);
  return {
    sessions,
    designDirections,
    approvedDesigns,
    contentDirections,
    approvedContents,
    formatGenerations,
  };
}
