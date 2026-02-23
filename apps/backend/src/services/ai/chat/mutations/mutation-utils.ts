import { createHmac } from 'node:crypto';
import { Prisma, type ChatMutationKind } from '@prisma/client';

export const CREATED_MARKER = '__created__';

function getMutationSecret(): string {
  return process.env.CHAT_MUTATION_SECRET || 'dev-chat-mutation-secret';
}

export function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function signToken(payload: string): string {
  return createHmac('sha256', getMutationSecret()).update(payload).digest('hex');
}

export function createConfirmToken(params: {
  id: string;
  sessionId: string;
  kind: ChatMutationKind;
  createdAt: Date;
}): string {
  return signToken(`confirm:${params.id}:${params.sessionId}:${params.kind}:${params.createdAt.toISOString()}`);
}

export function createUndoToken(params: {
  id: string;
  sessionId: string;
  kind: ChatMutationKind;
  appliedAt: Date;
}): string {
  return signToken(`undo:${params.id}:${params.sessionId}:${params.kind}:${params.appliedAt.toISOString()}`);
}

export function assertToken(actual: string, expected: string, label: string): void {
  if (!actual || actual !== expected) {
    throw new Error(`Invalid ${label}.`);
  }
}

export function toCompetitorCreateData(snapshot: Record<string, unknown>): Prisma.DiscoveredCompetitorUncheckedCreateInput {
  return {
    id: String(snapshot.id),
    researchJobId: String(snapshot.researchJobId),
    competitorId: typeof snapshot.competitorId === 'string' ? snapshot.competitorId : null,
    handle: String(snapshot.handle),
    platform: String(snapshot.platform),
    profileUrl: typeof snapshot.profileUrl === 'string' ? snapshot.profileUrl : null,
    discoveryReason: typeof snapshot.discoveryReason === 'string' ? snapshot.discoveryReason : null,
    relevanceScore: typeof snapshot.relevanceScore === 'number' ? snapshot.relevanceScore : null,
    status: String(snapshot.status) as any,
    discoveredAt: new Date(String(snapshot.discoveredAt)),
    scrapedAt: snapshot.scrapedAt ? new Date(String(snapshot.scrapedAt)) : null,
    postsScraped: typeof snapshot.postsScraped === 'number' ? snapshot.postsScraped : 0,
    lastCheckedAt: snapshot.lastCheckedAt ? new Date(String(snapshot.lastCheckedAt)) : null,
    latestPostId: typeof snapshot.latestPostId === 'string' ? snapshot.latestPostId : null,
    evidence: (snapshot.evidence as Prisma.InputJsonValue) || Prisma.JsonNull,
    orchestrationRunId: typeof snapshot.orchestrationRunId === 'string' ? snapshot.orchestrationRunId : null,
    scoreBreakdown: (snapshot.scoreBreakdown as Prisma.InputJsonValue) || Prisma.JsonNull,
    selectionReason: typeof snapshot.selectionReason === 'string' ? snapshot.selectionReason : null,
    selectionState: String(snapshot.selectionState) as any,
    candidateProfileId: typeof snapshot.candidateProfileId === 'string' ? snapshot.candidateProfileId : null,
    availabilityStatus: String(snapshot.availabilityStatus) as any,
    availabilityReason: typeof snapshot.availabilityReason === 'string' ? snapshot.availabilityReason : null,
    displayOrder: typeof snapshot.displayOrder === 'number' ? snapshot.displayOrder : null,
    manuallyModified: typeof snapshot.manuallyModified === 'boolean' ? snapshot.manuallyModified : false,
    lastModifiedBy: typeof snapshot.lastModifiedBy === 'string' ? snapshot.lastModifiedBy : null,
    lastModifiedAt: snapshot.lastModifiedAt ? new Date(String(snapshot.lastModifiedAt)) : null,
  };
}

export function toCompetitorUpdateData(snapshot: Record<string, unknown>): Prisma.DiscoveredCompetitorUncheckedUpdateInput {
  const { id: _id, researchJobId: _job, ...rest } = snapshot;
  return toJsonSafe(rest) as Prisma.DiscoveredCompetitorUncheckedUpdateInput;
}
