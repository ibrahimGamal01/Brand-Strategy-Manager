import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import type { DataGaps } from './client-completeness';

/**
 * Check for unscraped competitor profiles
 */
async function checkUnscrapedProfiles(researchJobId: string): Promise<string[]> {
  const unscraped = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      status: { in: ['SUGGESTED', 'FAILED'] },
      selectionState: {
        in: ['TOP_PICK', 'SHORTLISTED', 'APPROVED'],
      },
    },
    select: { id: true },
  });

  return unscraped.map((c) => c.id);
}

/**
 * Check for stale competitor profiles (scraped >7 days ago)
 */
async function checkStaleProfiles(researchJobId: string): Promise<string[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const stale = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      status: 'SCRAPED',
      scrapedAt: { lt: sevenDaysAgo },
      selectionState: {
        in: ['TOP_PICK', 'SHORTLISTED'],
      },
    },
    select: { id: true },
  });

  return stale.map((c) => c.id);
}

/**
 * Check for competitors with missing posts
 */
async function checkMissingPosts(researchJobId: string): Promise<string[]> {
  const missing = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      status: 'SCRAPED',
      postsScraped: { lte: 0 },
      selectionState: {
        in: ['TOP_PICK', 'SHORTLISTED'],
      },
    },
    select: { id: true },
  });

  return missing.map((c) => c.id);
}

/**
 * Check competitor data completeness
 */
export async function checkCompetitorCompleteness(
  researchJobId: string
): Promise<DataGaps['competitors']> {
  const [unscrapedProfiles, staleProfiles, missingPosts] = await Promise.all([
    checkUnscrapedProfiles(researchJobId),
    checkStaleProfiles(researchJobId),
    checkMissingPosts(researchJobId),
  ]);

  return {
    unscrapedProfiles,
    staleProfiles,
    missingPosts,
  };
}

/**
 * Queue competitor scraping tasks
 */
export async function queueCompetitorTasks(
  researchJobId: string,
  gaps: DataGaps['competitors']
): Promise<void> {
  const totalTasks = gaps.unscrapedProfiles.length + gaps.staleProfiles.length + gaps.missingPosts.length;

  if (totalTasks === 0) {
    return;
  }

  console.log(
    `[CompetitorCompleteness] Queuing ${totalTasks} competitor tasks: ` +
    `${gaps.unscrapedProfiles.length} unscraped, ` +
    `${gaps.staleProfiles.length} stale, ` +
    `${gaps.missingPosts.length} missing posts`
  );

  // Combine all IDs that need scraping (remove duplicates)
  const allIds = Array.from(new Set([
    ...gaps.unscrapedProfiles,
    ...gaps.staleProfiles,
    ...gaps.missingPosts,
  ]));

  // Get competitor details for scraping
  const competitors = await prisma.discoveredCompetitor.findMany({
    where: {
      id: { in: allIds },
    },
    select: {
      id: true,
      handle: true,
      platform: true,
    },
  });

  // Queue scraping using existing scraper
  const { scrapeCompetitorsIncremental } = await import('../discovery/competitor-scraper');

  // Process in background
  scrapeCompetitorsIncremental(
    researchJobId,
    competitors.map((c) => ({
      id: c.id,
      handle: c.handle,
      platform: c.platform,
    })),
    { source: 'continuous-orchestrator' }
  ).then((results) => {
    const successCount = results.filter((r) => r.status === 'SUCCESS').length;
    console.log(`[CompetitorCompleteness] Scraping complete: ${successCount}/${results.length} succeeded`);

    emitResearchJobEvent({
      researchJobId,
      source: 'continuous-orchestrator',
      code: 'competitor.bulk_scraping.completed',
      level: 'info',
      message: `Bulk competitor scraping complete: ${successCount}/${results.length} succeeded`,
      metrics: {
        total: results.length,
        success: successCount,
        failed: results.length - successCount,
      },
    });
  }).catch((error) => {
    console.error('[CompetitorCompleteness] Scraping failed:', error);
  });
}
