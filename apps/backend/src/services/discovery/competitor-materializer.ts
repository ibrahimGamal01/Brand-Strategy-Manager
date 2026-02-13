import {
  CompetitorAvailabilityStatus,
  CompetitorCandidateProfile,
  CompetitorCandidateState,
  CompetitorSelectionState,
  DiscoveredCompetitorStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import { scrapeCompetitorsIncremental } from './competitor-scraper';
import { ScoredCandidate } from './competitor-scorer';

type ScrapePlatform = 'instagram' | 'tiktok';

export interface IdentityGroupView {
  identityId: string | null;
  canonicalName: string;
  websiteDomain: string | null;
  businessType: string | null;
  audienceSummary: string | null;
  profiles: CandidateProfileView[];
  bestScore: number;
}

export interface CandidateProfileView {
  id: string;
  platform: string;
  handle: string;
  normalizedHandle: string;
  profileUrl: string | null;
  availabilityStatus: CompetitorAvailabilityStatus;
  availabilityReason: string | null;
  resolverConfidence: number | null;
  state: CompetitorCandidateState;
  stateReason: string | null;
  relevanceScore: number | null;
  scoreBreakdown: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  sources: string[];
  discoveredCompetitorId: string | null;
  discoveredStatus: DiscoveredCompetitorStatus | null;
}

function toSelectionState(state: CompetitorCandidateState): CompetitorSelectionState {
  if (state === 'TOP_PICK') return 'TOP_PICK';
  if (state === 'APPROVED') return 'APPROVED';
  if (state === 'SHORTLISTED') return 'SHORTLISTED';
  if (state === 'REJECTED') return 'REJECTED';
  return 'FILTERED_OUT';
}

function selectionToCandidateState(state: CompetitorSelectionState): CompetitorCandidateState {
  if (state === 'TOP_PICK') return 'TOP_PICK';
  if (state === 'APPROVED') return 'APPROVED';
  if (state === 'SHORTLISTED') return 'SHORTLISTED';
  if (state === 'REJECTED') return 'REJECTED';
  return 'FILTERED_OUT';
}

function toJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function isScrapePlatform(platform: string): platform is ScrapePlatform {
  return platform === 'instagram' || platform === 'tiktok';
}

function selectDiscoveredStatus(
  selectionState: CompetitorSelectionState,
  existingStatus?: DiscoveredCompetitorStatus | null
): DiscoveredCompetitorStatus {
  if (existingStatus === 'SCRAPED' || existingStatus === 'SCRAPING' || existingStatus === 'CONFIRMED') {
    return existingStatus;
  }
  if (selectionState === 'FILTERED_OUT' || selectionState === 'REJECTED') return 'REJECTED';
  return existingStatus === 'FAILED' ? 'FAILED' : 'SUGGESTED';
}

async function findOrCreateIdentity(
  researchJobId: string,
  canonicalName: string,
  websiteDomain: string | null
): Promise<{ id: string }> {
  const existing = await prisma.competitorIdentity.findFirst({
    where: {
      researchJobId,
      OR: [
        { canonicalName, websiteDomain: websiteDomain || undefined },
        { canonicalName },
      ],
    },
    select: { id: true },
  });

  if (existing) return existing;

  return prisma.competitorIdentity.create({
    data: {
      researchJobId,
      canonicalName,
      websiteDomain: websiteDomain || null,
    },
    select: { id: true },
  });
}

async function materializeCandidateToDiscovered(
  researchJobId: string,
  runId: string,
  candidate: CompetitorCandidateProfile
): Promise<string | null> {
  if (!isScrapePlatform(candidate.platform)) return null;

  const selectionState = toSelectionState(candidate.state);
  const existing = await prisma.discoveredCompetitor.findUnique({
    where: {
      researchJobId_platform_handle: {
        researchJobId,
        platform: candidate.platform,
        handle: candidate.handle,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  const keepForHistory =
    existing?.status === 'SCRAPED' ||
    existing?.status === 'SCRAPING' ||
    existing?.status === 'CONFIRMED';

  // Keep discovered competitors focused on execution-ready or historically scraped rows.
  if (
    (selectionState === 'FILTERED_OUT' || selectionState === 'REJECTED') &&
    !keepForHistory
  ) {
    if (existing?.id) {
      await prisma.discoveredCompetitor.deleteMany({ where: { id: existing.id } });
    }
    return null;
  }

  const persisted = await prisma.discoveredCompetitor.upsert({
    where: {
      researchJobId_platform_handle: {
        researchJobId,
        platform: candidate.platform,
        handle: candidate.handle,
      },
    },
    create: {
      researchJobId,
      orchestrationRunId: runId,
      candidateProfileId: candidate.id,
      handle: candidate.handle,
      platform: candidate.platform,
      profileUrl: candidate.profileUrl,
      availabilityStatus: candidate.availabilityStatus,
      availabilityReason: candidate.availabilityReason,
      discoveryReason: candidate.stateReason,
      relevanceScore: candidate.relevanceScore,
      evidence: candidate.evidence || undefined,
      scoreBreakdown: candidate.scoreBreakdown || undefined,
      selectionState,
      selectionReason: candidate.stateReason,
      status: selectDiscoveredStatus(selectionState, existing?.status),
    },
    update: {
      orchestrationRunId: runId,
      candidateProfileId: candidate.id,
      profileUrl: candidate.profileUrl,
      availabilityStatus: candidate.availabilityStatus,
      availabilityReason: candidate.availabilityReason,
      discoveryReason: candidate.stateReason,
      relevanceScore: candidate.relevanceScore,
      evidence: candidate.evidence || undefined,
      scoreBreakdown: candidate.scoreBreakdown || undefined,
      selectionState,
      selectionReason: candidate.stateReason,
      status: selectDiscoveredStatus(selectionState, existing?.status),
    },
    select: { id: true },
  });

  return persisted.id;
}

/**
 * Materialize a filtered candidate and set state to SHORTLISTED.
 * Enables "Add to shortlist" for filtered items.
 */
export async function materializeAndShortlistCandidate(
  researchJobId: string,
  runId: string,
  profileId: string
): Promise<{ discoveredCompetitorId: string | null; success: boolean }> {
  const profile = await prisma.competitorCandidateProfile.findFirst({
    where: {
      id: profileId,
      researchJobId,
      orchestrationRunId: runId,
    },
  });

  if (!profile) {
    return { discoveredCompetitorId: null, success: false };
  }

  await prisma.competitorCandidateProfile.update({
    where: { id: profileId },
    data: {
      state: 'SHORTLISTED',
      stateReason: 'Added to shortlist by operator',
    },
  });

  const discoveredId = await materializeCandidateToDiscovered(researchJobId, runId, {
    ...profile,
    state: 'SHORTLISTED',
    stateReason: 'Added to shortlist by operator',
  });

  return {
    discoveredCompetitorId: discoveredId,
    success: Boolean(discoveredId),
  };
}

export async function persistOrchestrationCandidates(input: {
  researchJobId: string;
  runId: string;
  scored: ScoredCandidate[];
  mode: 'append' | 'replace';
  strategyVersion: string;
  configSnapshot: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}): Promise<{
  candidatesDiscovered: number;
  candidatesFiltered: number;
  shortlisted: number;
  topPicks: number;
  profileUnavailableCount: number;
}> {
  const now = new Date();
  const scored = input.scored;
  let candidatesFiltered = 0;
  let shortlisted = 0;
  let topPicks = 0;
  let profileUnavailableCount = 0;

  await prisma.competitorOrchestrationRun.update({
    where: { id: input.runId },
    data: {
      strategyVersion: input.strategyVersion,
      configSnapshot: toJson(input.configSnapshot),
      diagnostics: toJson(input.diagnostics),
      phase: 'persisting',
      errorCode: null,
    },
  });

  for (const row of scored) {
    if (row.availabilityStatus === 'PROFILE_UNAVAILABLE') {
      profileUnavailableCount += 1;
    }

    const identity = await findOrCreateIdentity(
      input.researchJobId,
      row.canonicalName,
      row.websiteDomain
    );

    const existing = await prisma.competitorCandidateProfile.findUnique({
      where: {
        researchJobId_platform_normalizedHandle: {
          researchJobId: input.researchJobId,
          platform: row.platform,
          normalizedHandle: row.normalizedHandle,
        },
      },
      select: {
        id: true,
        state: true,
      },
    });

    let nextState = row.state;
    let nextReason = row.stateReason;
    if (existing?.state === 'APPROVED' && row.state !== 'REJECTED') {
      nextState = 'APPROVED';
      nextReason = 'Preserved previously approved candidate';
    }

    const profile = await prisma.competitorCandidateProfile.upsert({
      where: {
        researchJobId_platform_normalizedHandle: {
          researchJobId: input.researchJobId,
          platform: row.platform,
          normalizedHandle: row.normalizedHandle,
        },
      },
      create: {
        researchJobId: input.researchJobId,
        orchestrationRunId: input.runId,
        identityId: identity.id,
        platform: row.platform,
        handle: row.handle,
        normalizedHandle: row.normalizedHandle,
        profileUrl: row.profileUrl,
        source: row.sources[0] || 'orchestrator',
        availabilityStatus: row.availabilityStatus,
        availabilityReason: row.availabilityReason,
        resolverConfidence: row.resolverConfidence,
        state: nextState,
        stateReason: nextReason,
        relevanceScore: row.relevanceScore,
        scoreBreakdown: toJson(row.scoreBreakdown),
        evidence: toJson({
          sources: row.sources,
          summary: row.stateReason,
          updatedAt: now.toISOString(),
        }),
      },
      update: {
        orchestrationRunId: input.runId,
        identityId: identity.id,
        handle: row.handle,
        profileUrl: row.profileUrl,
        source: row.sources[0] || 'orchestrator',
        availabilityStatus: row.availabilityStatus,
        availabilityReason: row.availabilityReason,
        resolverConfidence: row.resolverConfidence,
        state: nextState,
        stateReason: nextReason,
        relevanceScore: row.relevanceScore,
        scoreBreakdown: toJson(row.scoreBreakdown),
        evidence: toJson({
          sources: row.sources,
          summary: row.stateReason,
          updatedAt: now.toISOString(),
        }),
      },
    });

    await prisma.competitorCandidateEvidence.deleteMany({
      where: { candidateProfileId: profile.id },
    });
    if (row.evidence.length > 0) {
      await prisma.competitorCandidateEvidence.createMany({
        data: row.evidence.slice(0, 25).map((evidenceRow) => ({
          candidateProfileId: profile.id,
          sourceType: evidenceRow.sourceType,
          query: evidenceRow.query || null,
          title: evidenceRow.title || null,
          url: evidenceRow.url || null,
          snippet: evidenceRow.snippet || null,
          signalScore: evidenceRow.signalScore,
        })),
      });
    }

    await materializeCandidateToDiscovered(input.researchJobId, input.runId, profile);

    if (nextState === 'TOP_PICK') {
      topPicks += 1;
      shortlisted += 1;
    } else if (nextState === 'SHORTLISTED' || nextState === 'APPROVED') {
      shortlisted += 1;
    } else {
      candidatesFiltered += 1;
    }
  }

  // Remove non-actionable discovered rows to prevent noisy filtered competitors from cluttering UI.
  await prisma.discoveredCompetitor.deleteMany({
    where: {
      researchJobId: input.researchJobId,
      selectionState: { in: ['FILTERED_OUT', 'REJECTED'] },
      status: { in: ['SUGGESTED', 'FAILED', 'REJECTED'] },
    },
  });

  const summary = {
    candidatesDiscovered: scored.length,
    candidatesFiltered,
    shortlisted,
    topPicks,
    profileUnavailableCount,
  };

  await prisma.competitorOrchestrationRun.update({
    where: { id: input.runId },
    data: {
      phase: 'completed',
      status: 'COMPLETED',
      summary: toJson(summary),
      diagnostics: toJson({
        ...(input.diagnostics || {}),
        summary,
      }),
      completedAt: new Date(),
    },
  });

  return summary;
}

type CandidateProfileWithRelations = CompetitorCandidateProfile & {
  identity: {
    id: string;
    canonicalName: string;
    websiteDomain: string | null;
    businessType: string | null;
    audienceSummary: string | null;
  } | null;
  evidenceRows: Array<{
    sourceType: string;
    query: string | null;
    title: string | null;
    url: string | null;
    snippet: string | null;
    signalScore: number | null;
  }>;
  discoveredCompetitors: Array<{
    id: string;
    status: DiscoveredCompetitorStatus;
  }>;
};

function profileToView(profile: CandidateProfileWithRelations): CandidateProfileView {
  return {
    id: profile.id,
    platform: profile.platform,
    handle: profile.handle,
    normalizedHandle: profile.normalizedHandle,
    profileUrl: profile.profileUrl,
    availabilityStatus: profile.availabilityStatus,
    availabilityReason: profile.availabilityReason,
    resolverConfidence: profile.resolverConfidence,
    state: profile.state,
    stateReason: profile.stateReason,
    relevanceScore: profile.relevanceScore,
    scoreBreakdown: (profile.scoreBreakdown || null) as Record<string, unknown> | null,
    evidence: {
      summary: profile.evidence || null,
      rows: profile.evidenceRows,
    },
    sources: Array.isArray((profile.evidence as Record<string, unknown> | null)?.sources)
      ? (((profile.evidence as Record<string, unknown>).sources as unknown[]) || []).map((value) => String(value))
      : [],
    discoveredCompetitorId: profile.discoveredCompetitors[0]?.id || null,
    discoveredStatus: profile.discoveredCompetitors[0]?.status || null,
  };
}

function fallbackCanonicalName(handle: string): string {
  const cleaned = String(handle || '').replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return handle;
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildIdentityGroupedShortlist(
  profiles: CandidateProfileWithRelations[]
): {
  topPicks: IdentityGroupView[];
  shortlist: IdentityGroupView[];
  filteredOut: IdentityGroupView[];
} {
  const statePriority: Record<CompetitorCandidateState, number> = {
    TOP_PICK: 5,
    APPROVED: 4,
    SHORTLISTED: 3,
    DISCOVERED: 2,
    FILTERED_OUT: 1,
    REJECTED: 0,
  };
  const grouped = new Map<string, IdentityGroupView>();

  for (const profile of profiles) {
    const identityKey = profile.identity?.id || `unlinked:${profile.platform}:${profile.normalizedHandle}`;
    const existing = grouped.get(identityKey);
    const profileView = profileToView(profile);
    const score = Number(profile.relevanceScore || 0);
    if (existing) {
      existing.profiles.push(profileView);
      existing.bestScore = Math.max(existing.bestScore, score);
      continue;
    }
    grouped.set(identityKey, {
      identityId: profile.identity?.id || null,
      canonicalName: profile.identity?.canonicalName || fallbackCanonicalName(profile.handle),
      websiteDomain: profile.identity?.websiteDomain || null,
      businessType: profile.identity?.businessType || null,
      audienceSummary: profile.identity?.audienceSummary || null,
      profiles: [profileView],
      bestScore: score,
    } as IdentityGroupView);
  }

  const groups = Array.from(grouped.values()).sort((a, b) => b.bestScore - a.bestScore);
  for (const group of groups) {
    group.profiles.sort((a, b) => {
      const stateDiff = (statePriority[b.state] || 0) - (statePriority[a.state] || 0);
      if (stateDiff !== 0) return stateDiff;
      return Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0);
    });
  }
  const topPicks: IdentityGroupView[] = [];
  const shortlist: IdentityGroupView[] = [];
  const filteredOut: IdentityGroupView[] = [];

  for (const group of groups) {
    const hasTopPick = group.profiles.some((profile) => profile.state === 'TOP_PICK');
    const hasShortlist = group.profiles.some(
      (profile) => profile.state === 'SHORTLISTED' || profile.state === 'APPROVED'
    );
    if (hasTopPick) {
      topPicks.push(group);
    } else if (hasShortlist) {
      shortlist.push(group);
    } else {
      filteredOut.push(group);
    }
  }

  const FILTERED_DISPLAY_LIMIT = 10;
  const filteredOutLimited = filteredOut
    .filter((group) => {
      const hasVerifiedHighSignal = group.profiles.some(
        (profile) =>
          profile.availabilityStatus === 'VERIFIED' &&
          Number(profile.relevanceScore || 0) >= 0.58
      );
      const hasMeaningfulUnavailableDiagnostic = group.profiles.some(
        (profile) =>
          profile.availabilityStatus === 'PROFILE_UNAVAILABLE' &&
          Number(profile.relevanceScore || 0) >= 0.8
      );
      if (hasVerifiedHighSignal || hasMeaningfulUnavailableDiagnostic) return true;
      return group.bestScore >= 0.72;
    })
    .slice(0, FILTERED_DISPLAY_LIMIT);

  return { topPicks, shortlist, filteredOut: filteredOutLimited };
}

export async function approveAndQueueCandidates(input: {
  researchJobId: string;
  runId: string;
  candidateProfileIds: string[];
}): Promise<{
  approvedCount: number;
  rejectedCount: number;
  queuedCount: number;
  skippedCount: number;
}> {
  const selectedIds = Array.from(new Set(input.candidateProfileIds));
  if (selectedIds.length === 0) {
    return { approvedCount: 0, rejectedCount: 0, queuedCount: 0, skippedCount: 0 };
  }

  const selectedProfiles = await prisma.competitorCandidateProfile.findMany({
    where: {
      researchJobId: input.researchJobId,
      orchestrationRunId: input.runId,
      id: { in: selectedIds },
    },
    include: {
      discoveredCompetitors: {
        select: { id: true, status: true },
      },
    },
  });

  if (selectedProfiles.length === 0) {
    return { approvedCount: 0, rejectedCount: 0, queuedCount: 0, skippedCount: selectedIds.length };
  }

  await prisma.competitorCandidateProfile.updateMany({
    where: { id: { in: selectedProfiles.map((profile) => profile.id) } },
    data: {
      state: 'APPROVED',
      stateReason: 'Approved by operator',
    },
  });

  const rejectedCandidates = await prisma.competitorCandidateProfile.findMany({
    where: {
      researchJobId: input.researchJobId,
      orchestrationRunId: input.runId,
      id: { notIn: selectedProfiles.map((profile) => profile.id) },
      state: { in: ['TOP_PICK', 'SHORTLISTED', 'APPROVED'] },
    },
    select: { id: true },
  });

  if (rejectedCandidates.length > 0) {
    await prisma.competitorCandidateProfile.updateMany({
      where: { id: { in: rejectedCandidates.map((row) => row.id) } },
      data: {
        state: 'REJECTED',
        stateReason: 'Rejected during selection review',
      },
    });
  }

  const queueTargets: Array<{ id: string; handle: string; platform: string }> = [];
  let skippedCount = 0;

  for (const profile of selectedProfiles) {
    const selectionState = toSelectionState('APPROVED');
    const discoveredId = await materializeCandidateToDiscovered(input.researchJobId, input.runId, {
      ...profile,
      state: selectionToCandidateState(selectionState),
      stateReason: profile.stateReason || 'Approved by operator',
    });

    if (!discoveredId || !isScrapePlatform(profile.platform)) {
      skippedCount += 1;
      continue;
    }

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id: discoveredId },
      select: { status: true, id: true },
    });

    if (!discovered) {
      skippedCount += 1;
      continue;
    }

    if (profile.availabilityStatus !== 'VERIFIED') {
      skippedCount += 1;
      emitResearchJobEvent({
        researchJobId: input.researchJobId,
        runId: input.runId,
        source: 'competitor-orchestrator-v2',
        code: 'competitor.profile.unavailable',
        level: 'warn',
        message: `Skipped scrape queue for ${profile.platform} @${profile.handle} (${profile.availabilityStatus})`,
        platform: profile.platform,
        handle: profile.handle,
        entityType: 'competitor_candidate_profile',
        entityId: profile.id,
      });
      continue;
    }

    if (discovered.status === 'SCRAPING') {
      skippedCount += 1;
      continue;
    }
    if (discovered.status === 'SCRAPED' || discovered.status === 'CONFIRMED') {
      skippedCount += 1;
      continue;
    }

    queueTargets.push({ id: discovered.id, platform: profile.platform, handle: profile.handle });
  }

  if (queueTargets.length > 0) {
    void scrapeCompetitorsIncremental(input.researchJobId, queueTargets, {
      runId: input.runId,
      source: 'orchestration-approval-v2',
    }).catch((error: unknown) => {
      console.error('[CompetitorOrchestratorV2] approve queue failed:', error);
    });
  }

  return {
    approvedCount: selectedProfiles.length,
    rejectedCount: rejectedCandidates.length,
    queuedCount: queueTargets.length,
    skippedCount,
  };
}

export async function continueQueueFromCandidates(input: {
  researchJobId: string;
  runId?: string;
  candidateProfileIds?: string[];
  onlyPending?: boolean;
  forceUnavailable?: boolean;
  forceMaterialize?: boolean;
}): Promise<{ queuedCount: number; skippedCount: number }> {
  const selectedIds = Array.from(new Set((input.candidateProfileIds || []).filter(Boolean)));
  const forceMaterialize = Boolean(input.forceMaterialize);

  const where: Prisma.CompetitorCandidateProfileWhereInput = {
    researchJobId: input.researchJobId,
    state: forceMaterialize
      ? { notIn: ['REJECTED'] }
      : { notIn: ['FILTERED_OUT', 'REJECTED'] },
  };
  if (input.runId) where.orchestrationRunId = input.runId;
  if (selectedIds.length > 0) where.id = { in: selectedIds };

  const profiles = await prisma.competitorCandidateProfile.findMany({
    where,
    include: {
      discoveredCompetitors: {
        select: { id: true, status: true },
      },
    },
    orderBy: [{ relevanceScore: 'desc' }],
    take: 80,
  });

  const queueTargets: Array<{ id: string; handle: string; platform: string }> = [];
  let skippedCount = 0;

  for (const profile of profiles) {
    if (!isScrapePlatform(profile.platform)) {
      skippedCount += 1;
      continue;
    }
    if (!input.forceUnavailable && profile.availabilityStatus !== 'VERIFIED') {
      skippedCount += 1;
      continue;
    }

    // If forceMaterialize and profile is FILTERED_OUT, update to SHORTLISTED first
    let profileToMaterialize = profile;
    if (forceMaterialize && profile.state === 'FILTERED_OUT') {
      await prisma.competitorCandidateProfile.update({
        where: { id: profile.id },
        data: {
          state: 'SHORTLISTED',
          stateReason: 'Materialized for scrape by operator',
        },
      });
      profileToMaterialize = { ...profile, state: 'SHORTLISTED' as const };
    }

    let discoveredId = profile.discoveredCompetitors[0]?.id || null;
    if (!discoveredId) {
      discoveredId = await materializeCandidateToDiscovered(
        input.researchJobId,
        profile.orchestrationRunId || input.runId || '',
        profileToMaterialize
      );
    }
    if (!discoveredId) {
      skippedCount += 1;
      continue;
    }

    const discovered = await prisma.discoveredCompetitor.findUnique({
      where: { id: discoveredId },
      select: { status: true, id: true },
    });
    if (!discovered) {
      skippedCount += 1;
      continue;
    }

    const queueable = input.onlyPending
      ? discovered.status === 'SUGGESTED' || discovered.status === 'FAILED'
      : discovered.status === 'SUGGESTED' || discovered.status === 'FAILED';
    if (!queueable) {
      skippedCount += 1;
      continue;
    }

    queueTargets.push({
      id: discovered.id,
      handle: profile.handle,
      platform: profile.platform,
    });
  }

  if (queueTargets.length > 0) {
    void scrapeCompetitorsIncremental(input.researchJobId, queueTargets, {
      runId: input.runId,
      source: 'orchestration-continue-v2',
    }).catch((error: unknown) => {
      console.error('[CompetitorOrchestratorV2] continue queue failed:', error);
    });
  }

  return {
    queuedCount: queueTargets.length,
    skippedCount,
  };
}
