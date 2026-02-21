/**
 * Seed competitor top picks from client-provided inspiration links at intake.
 * So the competitor panel shows the client's picks immediately instead of zero.
 */

import { prisma } from '../../lib/prisma';
import {
  getProfileUrl,
  parseCompetitorInspirationInputs,
} from '../intake/brain-intake-utils';
import {
  deriveCandidateEligibility,
  deriveClientInspirationStates,
} from './competitor-pipeline-rules';

async function findOrCreateIdentity(
  researchJobId: string,
  canonicalName: string,
  websiteDomain: string | null
): Promise<string> {
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
  if (existing) return existing.id;
  const created = await prisma.competitorIdentity.create({
    data: {
      researchJobId,
      canonicalName,
      websiteDomain: websiteDomain || null,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Create a bootstrap orchestration run and TOP_PICK candidate profiles from
 * competitorInspirationLinks so the shortlist UI shows them as top picks.
 */
export async function seedTopPicksFromInspirationLinks(
  researchJobId: string,
  links: string[]
): Promise<{ topPicks: number }> {
  const parsed = parseCompetitorInspirationInputs(links);
  if (parsed.length === 0) return { topPicks: 0 };

  const run = await prisma.competitorOrchestrationRun.create({
    data: {
      researchJobId,
      platforms: {
        requested: parsed
          .map((p) => p.inputType)
          .filter((value, idx, arr) => arr.indexOf(value) === idx),
      },
      targetCount: 0,
      mode: 'append',
      status: 'COMPLETED',
      phase: 'completed',
      strategyVersion: 'v2',
      completedAt: new Date(),
      summary: {
        candidatesDiscovered: parsed.length,
        candidatesFiltered: 0,
        shortlisted: parsed.length,
        topPicks: parsed.length,
        profileUnavailableCount: 0,
      },
      configSnapshot: { source: 'client_intake_inspiration' },
    },
    select: { id: true },
  });

  let created = 0;
  for (const input of parsed) {
    const isWebsite = input.inputType === 'website';
    const platform = input.inputType;
    const normalizedHandle = isWebsite
      ? input.domain.toLowerCase()
      : input.handle.toLowerCase().replace(/^@+/, '').trim();
    const websiteDomain = isWebsite ? input.domain.toLowerCase() : null;
    const canonicalName = isWebsite
      ? input.domain.split('.')[0] || input.domain
      : normalizedHandle;
    const profileUrl = isWebsite
      ? input.sourceUrl
      : getProfileUrl(platform, normalizedHandle) || input.sourceUrl;

    const eligibility = deriveCandidateEligibility({
      platformOrInputType: platform,
      availabilityStatus: 'UNVERIFIED',
    });
    const intakeStates = deriveClientInspirationStates(platform);

    const identityId = await findOrCreateIdentity(
      researchJobId,
      canonicalName,
      websiteDomain
    );

    const profile = await prisma.competitorCandidateProfile.upsert({
      where: {
        researchJobId_platform_normalizedHandle: {
          researchJobId,
          platform,
          normalizedHandle,
        },
      },
      create: {
        researchJobId,
        orchestrationRunId: run.id,
        identityId,
        platform,
        handle: normalizedHandle,
        normalizedHandle,
        profileUrl,
        source: 'client_inspiration',
        inputType: eligibility.inputType,
        scrapeEligible: eligibility.scrapeEligible,
        blockerReasonCode: eligibility.blockerReasonCode,
        availabilityStatus: 'UNVERIFIED',
        state: intakeStates.candidateState,
        stateReason: isWebsite
          ? 'Client-provided website inspiration link'
          : 'Client-provided inspiration link',
        relevanceScore: 1,
        evidence: {
          sources: ['client_inspiration'],
          summary: 'From intake form',
          sourceUrl: input.sourceUrl,
        },
      },
      update: {
        orchestrationRunId: run.id,
        inputType: eligibility.inputType,
        scrapeEligible: eligibility.scrapeEligible,
        blockerReasonCode: eligibility.blockerReasonCode,
        state: intakeStates.candidateState,
        stateReason: isWebsite
          ? 'Client-provided website inspiration link'
          : 'Client-provided inspiration link',
      },
      select: { id: true },
    });

    await prisma.discoveredCompetitor.upsert({
      where: {
        researchJobId_platform_handle: {
          researchJobId,
          platform,
          handle: normalizedHandle,
        },
      },
      create: {
        researchJobId,
        orchestrationRunId: run.id,
        candidateProfileId: profile.id,
        handle: normalizedHandle,
        platform,
        profileUrl,
        discoveryReason: isWebsite
          ? 'Client-provided website inspiration link'
          : 'Client-provided inspiration link',
        relevanceScore: 1,
        status: 'SUGGESTED',
        selectionState: intakeStates.selectionState,
        selectionReason: 'From intake form',
      },
      update: {
        orchestrationRunId: run.id,
        candidateProfileId: profile.id,
        selectionState: intakeStates.selectionState,
      },
    });
    created += 1;
  }

  // Queue only scrape-eligible social competitors from intake; website-only entries remain intelligence rows.
  const toScrape = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      orchestrationRunId: run.id,
      platform: { in: ['instagram', 'tiktok'] },
      selectionState: { in: ['TOP_PICK', 'APPROVED', 'SHORTLISTED'] },
      candidateProfile: {
        scrapeEligible: true,
        availabilityStatus: {
          notIn: ['PROFILE_UNAVAILABLE', 'INVALID_HANDLE'],
        },
      },
    },
    select: { id: true, handle: true, platform: true },
  });
  if (toScrape.length > 0) {
    const { scrapeCompetitorsIncremental } = await import('./competitor-scraper');
    void scrapeCompetitorsIncremental(
      researchJobId,
      toScrape.map((c) => ({ id: c.id, handle: c.handle, platform: c.platform })),
      { source: 'client_intake_inspiration' }
    ).catch((err) => {
      console.error(`[SeedIntakeCompetitors] High-priority scrape failed for job ${researchJobId}:`, err);
    });
  }

  return { topPicks: created };
}
