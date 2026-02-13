import { prisma } from '../../lib/prisma';
import { scrapeProfileSafe } from '../social/scraper';
import { emitResearchJobEvent } from '../social/research-job-events';

interface CompetitorScrapingResult {
  competitorId: string;
  handle: string;
  platform: string;
  status: 'SUCCESS' | 'FAILED';
  profileScraped: boolean;
  postsScraped: number;
  error?: string;
}

/**
 * Update competitor status in database
 */
export async function updateCompetitorStatus(
  competitorId: string,
  status: 'SUGGESTED' | 'SCRAPING' | 'SCRAPED' | 'FAILED'
) {
  await prisma.discoveredCompetitor.update({
    where: { id: competitorId },
    data: { 
      status,
      scrapedAt: status === 'SCRAPED' ? new Date() : undefined
    }
  });
}

/**
 * Scrape a single competitor incrementally
 * - Updates status to SCRAPING
 * - Scrapes profile data
 * - Scrapes ALL posts with engagement metrics
 * - Updates status to SCRAPED on success
 * - Non-blocking: runs independently per competitor
 */
export async function scrapeCompetitorIncremental(
  jobId: string,
  competitorId: string,
  platform: string,
  handle: string,
  options: { runId?: string; source?: string } = {}
): Promise<CompetitorScrapingResult> {
  console.log(`[CompetitorScraper] Starting scrape for ${platform}:${handle}`);

  emitResearchJobEvent({
    researchJobId: jobId,
    runId: options.runId,
    source: 'competitor',
    code: 'competitor.scrape.started',
    level: 'info',
    message: `Competitor scrape started for ${platform} @${handle}`,
    platform,
    handle,
    entityType: 'competitor',
    entityId: competitorId,
    metadata: {
      source: options.source || 'module',
    },
  });
  
  try {
    // 1. Update status to SCRAPING
    await updateCompetitorStatus(competitorId, 'SCRAPING');
    
    // 2. Scrape profile using universal scraper (works for Instagram and TikTok)
    const result = await scrapeProfileSafe(jobId, platform, handle, {
      runId: options.runId,
      source: options.source || 'competitor-scraper',
      entityType: 'competitor',
      entityId: competitorId,
    });
    
    if (!result.success || !result.data) {
      throw new Error(`Failed to scrape ${platform} profile for ${handle}`);
    }
    
    const postsScraped = result.data.posts?.length || 0;
    
    console.log(`[CompetitorScraper] ✓ ${platform} ${handle}: ${postsScraped} posts scraped`);

    // 2.5. Ensure Competitor record exists and update follower count if available
    const { ensureCompetitorExists } = await import('./competitor-posts-storage');
    const linkedCompetitorId = await ensureCompetitorExists(competitorId, jobId);
    const followerCount = result.data.followers || 0;
    await prisma.competitor.update({
      where: { id: linkedCompetitorId },
      data: {
        lastScrapedAt: new Date(),
        ...(followerCount > 0 ? { followerCount } : {})
      }
    });

    // 3. Save posts to database if we got any
    if (postsScraped > 0 && result.data.posts) {
      const { saveCompetitorPosts } = await import('./competitor-posts-storage');
      
      // Save all posts to RawPost → CleanedPost
      await saveCompetitorPosts(linkedCompetitorId, platform, result.data.posts);
    }

    // 3.5. Trigger media download for competitor snapshot (scraper already creates snapshot;
    // this ensures download runs if snapshot exists with posts lacking media)
    const latestSnapshot = await prisma.competitorProfileSnapshot.findFirst({
      where: {
        competitorProfile: { competitorId: linkedCompetitorId },
      },
      orderBy: { scrapedAt: 'desc' },
      select: { id: true },
    });
    if (latestSnapshot) {
      const { downloadSnapshotMedia } = await import('../media/downloader');
      downloadSnapshotMedia('competitor', latestSnapshot.id).catch((err) =>
        console.warn('[CompetitorScraper] Media download failed for snapshot:', err?.message)
      );
    }
    
    // 4. Update status to SCRAPED
    await updateCompetitorStatus(competitorId, 'SCRAPED');
    
    // 5. Update posts count
    await prisma.discoveredCompetitor.update({
      where: { id: competitorId },
      data: { postsScraped }
    });

    emitResearchJobEvent({
      researchJobId: jobId,
      runId: options.runId,
      source: 'competitor',
      code: 'competitor.scrape.completed',
      level: 'info',
      message: `Competitor scrape completed for ${platform} @${handle}`,
      platform,
      handle,
      entityType: 'competitor',
      entityId: competitorId,
      metrics: {
        postsScraped,
      },
    });
    
    return {
      competitorId,
      handle,
      platform,
      status: 'SUCCESS',
      profileScraped: true,
      postsScraped
    };
    
  } catch (error) {
    console.error(`[CompetitorScraper] ✗ Failed to scrape ${platform}:${handle}:`, error);

    emitResearchJobEvent({
      researchJobId: jobId,
      runId: options.runId,
      source: 'competitor',
      code: 'competitor.scrape.failed',
      level: 'error',
      message: `Competitor scrape failed for ${platform} @${handle}`,
      platform,
      handle,
      entityType: 'competitor',
      entityId: competitorId,
      metadata: {
        error: (error as Error).message || 'Unknown scrape error',
      },
    });
    
    // Update status to FAILED
    await updateCompetitorStatus(competitorId, 'FAILED');
    
    return {
      competitorId,
      handle,
      platform,
      status: 'FAILED',
      profileScraped: false,
      postsScraped: 0,
      error: (error as Error).message
    };
  }
}

/**
 * Scrape multiple competitors incrementally
 * - Processes each competitor independently
 * - Does NOT block on failures
 * - Returns results as they complete
 * - Suitable for background processing
 */
export async function scrapeCompetitorsIncremental(
  jobId: string,
  competitors: Array<{
    id: string;
    handle: string;
    platform: string;
  }>,
  options: { runId?: string; source?: string } = {}
): Promise<CompetitorScrapingResult[]> {
  console.log(`[CompetitorScraper] Starting incremental scrape for ${competitors.length} competitors`);
  
  const results: CompetitorScrapingResult[] = [];
  
  // Process each competitor sequentially to avoid overwhelming the system
  for (const competitor of competitors) {
    const result = await scrapeCompetitorIncremental(
      jobId,
      competitor.id,
      competitor.platform,
      competitor.handle,
      options
    );
    
    results.push(result);
    
    // Small delay between competitors to be polite to scrapers
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  const successCount = results.filter(r => r.status === 'SUCCESS').length;
  const failedCount = results.filter(r => r.status === 'FAILED').length;
  const totalPosts = results.reduce((sum, r) => sum + r.postsScraped, 0);
  
  console.log(`[CompetitorScraper] Completed: ${successCount} success, ${failedCount} failed, ${totalPosts} total posts`);
  
  return results;
}

/**
 * Get competitors by status
 */
export async function getCompetitorsByStatus(
  jobId: string,
  status: 'SUGGESTED' | 'SCRAPING' | 'SCRAPED' | 'FAILED'
) {
  return await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId: jobId,
      status
    },
    orderBy: {
      relevanceScore: 'desc'
    }
  });
}

/**
 * Get scraping progress summary
 */
export async function getScrapingProgress(jobId: string) {
  const [total, suggested, scraping, scraped, failed] = await Promise.all([
    prisma.discoveredCompetitor.count({ where: { researchJobId: jobId } }),
    prisma.discoveredCompetitor.count({ where: { researchJobId: jobId, status: 'SUGGESTED' } }),
    prisma.discoveredCompetitor.count({ where: { researchJobId: jobId, status: 'SCRAPING' } }),
    prisma.discoveredCompetitor.count({ where: { researchJobId: jobId, status: 'SCRAPED' } }),
    prisma.discoveredCompetitor.count({ where: { researchJobId: jobId, status: 'FAILED' } })
  ]);
  
  const competitors = await prisma.discoveredCompetitor.findMany({
    where: { researchJobId: jobId },
    select: {
      id: true,
      handle: true,
      platform: true,
      status: true,
      postsScraped: true,
      scrapedAt: true
    },
    orderBy: { relevanceScore: 'desc' }
  });
  
  return {
    total,
    byStatus: {
      suggested,
      scraping,
      scraped,
      failed
    },
    competitors
  };
}
