import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';

/** Throttle expensive client scrapes (Apify Instagram, etc.) to avoid burning cost when gaps re-trigger every cycle. */
const CLIENT_SCRAPE_THROTTLE_MS =
  (typeof process.env.ORCHESTRATOR_CLIENT_SCRAPE_THROTTLE_HOURS !== 'undefined'
    ? Math.max(0, Number(process.env.ORCHESTRATOR_CLIENT_SCRAPE_THROTTLE_HOURS))
    : 6) *
  60 *
  60 *
  1000;
const lastClientScrapeAtByJob = new Map<string, number>();

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

  // If ANY Instagram account has followerCount and bio, we're OK (handles duplicate URL vs handle)
  const anyComplete = job.client.clientAccounts.some((account) => {
    const hasFollowerCount = account.followerCount != null && account.followerCount > 0;
    const hasBio = account.bio != null && String(account.bio).trim() !== '';
    return hasFollowerCount && hasBio;
  });
  return !anyComplete;
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

  // If ANY TikTok account is fresh (scraped in last 24h), we're OK (handles duplicate URL vs handle)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const anyFresh = job.client.clientAccounts.some(
    (acc) => acc.lastScrapedAt != null && acc.lastScrapedAt >= oneDayAgo
  );
  return !anyFresh;
}

/**
 * Check for stale follower counts.
 * Per platform: if ANY account for that platform is fresh (recent lastScrapedAt + has followerCount), we consider the platform OK (handles duplicate URL vs handle accounts).
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
  const platformsNeedingRefresh: string[] = [];
  const platformFresh = new Map<string, boolean>();

  for (const account of job.client.clientAccounts) {
    const key = account.platform;
    const scrapedFresh = account.lastScrapedAt != null && account.lastScrapedAt >= sevenDaysAgo;
    const hasFollowers = account.followerCount != null && account.followerCount > 0;
    if (scrapedFresh && hasFollowers) {
      platformFresh.set(key, true);
    } else if (!platformFresh.has(key)) {
      platformFresh.set(key, false);
    }
  }
  for (const [platform, fresh] of platformFresh) {
    if (!fresh) platformsNeedingRefresh.push(platform);
  }
  return platformsNeedingRefresh;
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
 * Resolve last client scrape timestamp: in-memory first, then persisted (inputData) for throttle across restarts.
 */
async function getLastClientScrapeAt(researchJobId: string): Promise<number | null> {
  const fromMemory = lastClientScrapeAtByJob.get(researchJobId);
  if (fromMemory != null) return fromMemory;
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { inputData: true },
  });
  const inputData = (job?.inputData ?? {}) as Record<string, unknown>;
  const iso = inputData?.lastClientScrapeAt;
  if (typeof iso !== 'string') return null;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Queue client scraping tasks
 * Triggers client scrape when TikTok is missing/stale or when follower counts are stale (e.g. Instagram).
 * Throttled per job to avoid costly repeated Apify/API runs (see CLIENT_SCRAPE_THROTTLE_MS).
 */
export async function queueClientTasks(researchJobId: string, gaps: DataGaps['client']): Promise<void> {
  const needsScrape =
    gaps.missingTikTok ||
    gaps.staleFollowerCounts.length > 0 ||
    gaps.incompleteInstagramMetadata;

  if (needsScrape) {
    const lastAt = await getLastClientScrapeAt(researchJobId);
    const now = Date.now();
    const throttleHours = CLIENT_SCRAPE_THROTTLE_MS / (60 * 60 * 1000);
    if (lastAt != null && now - lastAt < CLIENT_SCRAPE_THROTTLE_MS) {
      const minAgo = Math.round((now - lastAt) / 60000);
      console.log(
        `[ClientCompleteness] Skipping client scrape: throttle (last run ${minAgo} min ago, throttle ${throttleHours}h). Cost protection.`
      );
      if (gaps.staleFollowerCounts.length > 0) {
        emitResearchJobEvent({
          researchJobId,
          source: 'continuous-orchestrator',
          code: 'client.stale_followers.detected',
          level: 'warn',
          message: `Stale follower counts detected for ${gaps.staleFollowerCounts.length} platform(s)`,
          metadata: { platforms: gaps.staleFollowerCounts },
        });
      }
      return;
    }

    if (gaps.missingTikTok) {
      console.log('[ClientCompleteness] Queuing client TikTok scraping...');
    }
    if (gaps.staleFollowerCounts.length > 0) {
      console.log(`[ClientCompleteness] Queuing client scrape for stale follower counts: ${gaps.staleFollowerCounts.join(', ')}`);
    }
    if (gaps.incompleteInstagramMetadata) {
      console.log('[ClientCompleteness] Queuing client scrape for incomplete Instagram metadata');
    }
    console.log(`[ClientCompleteness] Queueing client scrape (cost: Apify/API). Next allowed after ${throttleHours}h throttle window.`);

    lastClientScrapeAtByJob.set(researchJobId, now);

    const { autoScrapeClientProfiles } = await import('../social/auto-scraper');

    autoScrapeClientProfiles(researchJobId).then(async (result) => {
      console.log('[ClientCompleteness] Client scraping complete:', result);

      if (result?.success) {
        lastClientScrapeAtByJob.set(researchJobId, Date.now());
        const job = await prisma.researchJob.findUnique({
          where: { id: researchJobId },
          select: { inputData: true },
        });
        const current = (job?.inputData ?? {}) as Record<string, unknown>;
        await prisma.researchJob.update({
          where: { id: researchJobId },
          data: {
            inputData: { ...current, lastClientScrapeAt: new Date().toISOString() } as object,
          },
        });
      }

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
