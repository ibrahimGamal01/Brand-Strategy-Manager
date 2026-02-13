import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';

export interface DataGaps {
  client: {
    missingTikTok: boolean;
    staleFollowerCounts: string[]; // platforms with stale counts
    missingRecentPosts: boolean;
    incompleteInstagramMetadata: boolean;
  };
  competitors: {
    unscrapedProfiles: string[]; // discovered competitor IDs
    staleProfiles: string[]; // IDs of profiles >7 days old
    missingPosts: string[]; // IDs with no posts
  };
  media: {
    missingDownloads: number;
    failedDownloads: number;
    clientSnapshotIds?: string[];
    competitorSnapshotIds?: string[];
  };
  secondPhase: {
    filteredToReview: number;
  };
}

interface ClientAccount {
  id: string;
  platform: string;
  handle: string;
  followerCount?: number | null;
  bio?: string | null;
  lastScrapedAt?: Date | null;
}

/**
 * Check if the client has an Instagram account with incomplete profile metadata
 * (e.g. from a non-Apify fallback). Triggers a full scrape so Apify can fill metadata + posts in one call.
 */
async function hasIncompleteInstagramMetadata(researchJobId: string): Promise<boolean> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          clientAccounts: {
            where: { platform: 'instagram' },
          },
        },
      },
    },
  });

  if (!job?.client?.clientAccounts?.length) {
    return false;
  }

  for (const account of job.client.clientAccounts) {
    const missingFollowerCount = account.followerCount == null || account.followerCount === 0;
    const missingBio = account.bio == null || String(account.bio).trim() === '';
    if (missingFollowerCount || missingBio) {
      return true;
    }
  }

  return false;
}

/**
 * Check if client TikTok accounts need scraping
 */
async function checkClientTikTok(researchJobId: string): Promise<boolean> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          clientAccounts: {
            where: { platform: 'tiktok' },
          },
        },
      },
    },
  });

  if (!job?.client?.clientAccounts || job.client.clientAccounts.length === 0) {
    return false; // No TikTok account to scrape
  }

  // Check if any TikTok account is missing scraping or is stale (>24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  for (const account of job.client.clientAccounts) {
    if (!account.lastScrapedAt || account.lastScrapedAt < oneDayAgo) {
      return true; // Needs scraping
    }
  }

  return false;
}

/**
 * Check for stale follower counts
 */
async function checkStaleFollowerCounts(researchJobId: string): Promise<string[]> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          clientAccounts: true,
        },
      },
    },
  });

  if (!job?.client?.clientAccounts) {
    return [];
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stalePlatforms: string[] = [];
  const seen = new Set<string>();

  for (const account of job.client.clientAccounts) {
    const key = account.platform;
    if (seen.has(key)) continue;
    const scrapedStale = !account.lastScrapedAt || account.lastScrapedAt < sevenDaysAgo;
    const missingOrZeroFollowers =
      account.followerCount == null || account.followerCount === 0;
    if (scrapedStale || missingOrZeroFollowers) {
      seen.add(key);
      stalePlatforms.push(account.platform);
    }
  }

  return stalePlatforms;
}

/**
 * Check for missing recent client posts
 */
async function checkMissingRecentPosts(researchJobId: string): Promise<boolean> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { clientId: true },
  });
  if (!job?.clientId) return false;

  const recentPosts = await prisma.clientPost.count({
    where: {
      clientAccount: { clientId: job.clientId },
      postedAt: { gte: thirtyDaysAgo },
    },
  });

  return recentPosts < 10;
}

/**
 * Check client data completeness
 */
export async function checkClientCompleteness(researchJobId: string): Promise<DataGaps['client']> {
  const [missingTikTok, staleFollowerCounts, missingRecentPosts, incompleteInstagramMetadata] = await Promise.all([
    checkClientTikTok(researchJobId),
    checkStaleFollowerCounts(researchJobId),
    checkMissingRecentPosts(researchJobId),
    hasIncompleteInstagramMetadata(researchJobId),
  ]);

  return {
    missingTikTok,
    staleFollowerCounts,
    missingRecentPosts,
    incompleteInstagramMetadata,
  };
}

/**
 * Queue client scraping tasks
 * Triggers client scrape when TikTok is missing/stale or when follower counts are stale (e.g. Instagram).
 * auto-scraper rate limiting applies to avoid over-hitting APIs.
 */
export async function queueClientTasks(researchJobId: string, gaps: DataGaps['client']): Promise<void> {
  const needsScrape =
    gaps.missingTikTok ||
    gaps.staleFollowerCounts.length > 0 ||
    gaps.incompleteInstagramMetadata;

  if (needsScrape) {
    if (gaps.missingTikTok) {
      console.log('[ClientCompleteness] Queuing client TikTok scraping...');
    }
    if (gaps.staleFollowerCounts.length > 0) {
      console.log(`[ClientCompleteness] Queuing client scrape for stale follower counts: ${gaps.staleFollowerCounts.join(', ')}`);
    }
    if (gaps.incompleteInstagramMetadata) {
      console.log('[ClientCompleteness] Queuing client scrape for incomplete Instagram metadata');
    }

    const { autoScrapeClientProfiles } = await import('../social/auto-scraper');

    autoScrapeClientProfiles(researchJobId).then((result) => {
      console.log('[ClientCompleteness] Client scraping complete:', result);

      emitResearchJobEvent({
        researchJobId,
        source: 'continuous-orchestrator',
        code: 'client.scraping.triggered',
        level: 'info',
        message: 'Client scraping triggered by orchestrator',
        metrics: result,
      });
    }).catch((error) => {
      console.error('[ClientCompleteness] Client scraping failed:', error);
    });
  }

  if (gaps.staleFollowerCounts.length > 0) {
    emitResearchJobEvent({
      researchJobId,
      source: 'continuous-orchestrator',
      code: 'client.stale_followers.detected',
      level: 'warn',
      message: `Stale follower counts detected for ${gaps.staleFollowerCounts.length} platform(s)`,
      metadata: {
        platforms: gaps.staleFollowerCounts,
      },
    });
  }
}
