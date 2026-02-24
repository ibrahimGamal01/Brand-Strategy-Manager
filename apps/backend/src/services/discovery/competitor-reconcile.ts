import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { deriveCandidateEligibility } from './competitor-pipeline-rules';
import { normalizeHandleFromUrlOrHandle } from '../handles/platform-handle';

type ScrapePlatform = 'instagram' | 'tiktok';

export async function reconcileCandidateAfterScrape(input: {
  researchJobId: string;
  competitorId?: string;
  platform: ScrapePlatform;
  handle: string;
  source?: string;
}): Promise<{
  normalizedHandle: string;
  candidateProfilesUpdated: number;
  discoveredRowsUpdated: number;
}> {
  const normalizedHandle = normalizeHandleFromUrlOrHandle(input.handle, input.platform);
  if (!normalizedHandle) {
    return {
      normalizedHandle: '',
      candidateProfilesUpdated: 0,
      discoveredRowsUpdated: 0,
    };
  }

  const now = new Date();
  const eligibility = deriveCandidateEligibility({
    platformOrInputType: input.platform,
    availabilityStatus: 'VERIFIED',
  });
  const availabilityReason = `scraped_successfully:${input.source || 'competitor_scraper'}`;

  const profiles = await prisma.competitorCandidateProfile.findMany({
    where: {
      researchJobId: input.researchJobId,
      platform: input.platform,
      normalizedHandle,
    },
    select: { id: true },
  });

  if (profiles.length > 0) {
    await prisma.$transaction(
      profiles.map((profile) =>
        prisma.competitorCandidateProfile.update({
          where: { id: profile.id },
          data: {
            inputType: eligibility.inputType,
            scrapeEligible: eligibility.scrapeEligible,
            blockerReasonCode: eligibility.blockerReasonCode,
            availabilityStatus: 'VERIFIED',
            availabilityReason,
            lastVerifiedAt: now,
            verificationAttempts: { increment: 1 },
            verificationSource: input.source || 'competitor_scraper',
          },
        })
      )
    );
  }

  const discoveredFilters: Prisma.DiscoveredCompetitorWhereInput[] = [
    {
      platform: input.platform,
      handle: normalizedHandle,
    },
  ];
  if (input.competitorId) discoveredFilters.push({ id: input.competitorId });
  if (profiles.length > 0) {
    discoveredFilters.push({
      candidateProfileId: { in: profiles.map((row) => row.id) },
    });
  }

  const discoveredResult = await prisma.discoveredCompetitor.updateMany({
    where: {
      researchJobId: input.researchJobId,
      OR: discoveredFilters,
    },
    data: {
      availabilityStatus: 'VERIFIED',
      availabilityReason,
    },
  });

  return {
    normalizedHandle,
    candidateProfilesUpdated: profiles.length,
    discoveredRowsUpdated: discoveredResult.count,
  };
}

export async function reconcileScrapedCandidatesForJob(input: {
  researchJobId: string;
  runId?: string;
  source?: string;
}): Promise<{
  discoveredRowsChecked: number;
  handlesReconciled: number;
  candidateProfilesUpdated: number;
  discoveredRowsUpdated: number;
}> {
  const rows = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId: input.researchJobId,
      orchestrationRunId: input.runId || undefined,
      platform: { in: ['instagram', 'tiktok'] },
      status: { in: ['SCRAPED', 'CONFIRMED'] },
    },
    select: {
      id: true,
      platform: true,
      handle: true,
    },
  });

  const uniqueHandles = new Map<string, { id: string; platform: ScrapePlatform; handle: string }>();
  for (const row of rows) {
    const platform = row.platform as ScrapePlatform;
    const normalizedHandle = normalizeHandleFromUrlOrHandle(row.handle, platform);
    if (!normalizedHandle) continue;
    const key = `${platform}:${normalizedHandle}`;
    if (!uniqueHandles.has(key)) {
      uniqueHandles.set(key, {
        id: row.id,
        platform,
        handle: normalizedHandle,
      });
    }
  }

  let candidateProfilesUpdated = 0;
  let discoveredRowsUpdated = 0;
  for (const row of uniqueHandles.values()) {
    const result = await reconcileCandidateAfterScrape({
      researchJobId: input.researchJobId,
      competitorId: row.id,
      platform: row.platform,
      handle: row.handle,
      source: input.source || 'repair_endpoint',
    });
    candidateProfilesUpdated += result.candidateProfilesUpdated;
    discoveredRowsUpdated += result.discoveredRowsUpdated;
  }

  return {
    discoveredRowsChecked: rows.length,
    handlesReconciled: uniqueHandles.size,
    candidateProfilesUpdated,
    discoveredRowsUpdated,
  };
}
