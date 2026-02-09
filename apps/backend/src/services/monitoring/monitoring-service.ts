/**
 * Monitoring Service
 * 
 * Handles daily monitoring of client and competitor profiles
 * - Scrapes client profiles (Instagram + TikTok)
 * - Scrapes competitor profiles (Instagram + TikTok)
 * - Fetches latest posts for RAG context
 * - Tracks monitoring status and errors
 */

import { PrismaClient } from '@prisma/client';
import { scrapeProfileSafe } from '../social/scraper';

const prisma = new PrismaClient();

export interface MonitoringResult {
  clientId: string;
  profilesScraped: number;
  postsDiscovered: number;
  errors: string[];
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

/**
 * Get profiles that haven't been scraped in the last N hours
 */
export async function getStaleProfiles(hoursThreshold: number = 24) {
  const cutoffTime = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);
  
  const staleProfiles = await prisma.socialProfile.findMany({
    where: {
      OR: [
        { lastScrapedAt: null },
        { lastScrapedAt: { lt: cutoffTime } }
      ]
    },
    include: {
      researchJob: {
        include: {
          client: true
        }
      }
    },
    orderBy: {
      lastScrapedAt: 'asc' // Prioritize oldest profiles
    }
  });
  
  console.log(`[Monitoring] Found ${staleProfiles.length} stale profiles (not scraped in ${hoursThreshold}h)`);
  return staleProfiles;
}

/**
 * Monitor a single client: scrape their profiles and top competitors
 */
export async function monitorClient(clientId: string): Promise<MonitoringResult> {
  console.log(`[Monitoring] Starting monitoring for client ${clientId}`);
  
  const errors: string[] = [];
  let profilesScraped = 0;
  let postsDiscovered = 0;
  
  try {
    // 1. Get client's latest research job
    const latestJob = await prisma.researchJob.findFirst({
      where: { clientId },
      orderBy: { startedAt: 'desc' },
      include: {
        client: {
          include: {
            clientAccounts: true
          }
        }
      }
    });
    
    if (!latestJob) {
      errors.push('No research job found for client');
      return {
        clientId,
        profilesScraped: 0,
        postsDiscovered: 0,
        errors,
        status: 'FAILED'
      };
    }
    
    // 2. Scrape client's own handles (Instagram + TikTok)
    const clientAccounts = latestJob.client.clientAccounts;
    
    for (const account of clientAccounts) {
      try {
        console.log(`[Monitoring] Scraping client ${account.platform}: @${account.handle}`);
        const result = await scrapeProfileSafe(latestJob.id, account.platform, account.handle);
        
        if (result.success) {
          profilesScraped++;
          postsDiscovered += result.data?.posts?.length || 0;
        } else {
          errors.push(`Client ${account.platform}: ${result.error}`);
        }
        
        // Small delay between scrapes
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        errors.push(`Client ${account.platform} @${account.handle}: ${error.message}`);
      }
    }
    
    // 3. Get top 10 competitors for this client
    const competitors = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId: latestJob.id,
        status: 'SCRAPED' // Only monitor already-scraped competitors
      },
      orderBy: {
        relevanceScore: 'desc'
      },
      take: 10
    });
    
    console.log(`[Monitoring] Found ${competitors.length} competitors to monitor`);
    
    // 4. Scrape each competitor's profile
    for (const competitor of competitors) {
      try {
        console.log(`[Monitoring] Scraping competitor ${competitor.platform}: @${competitor.handle}`);
        const result = await scrapeProfileSafe(latestJob.id, competitor.platform, competitor.handle);
        
        if (result.success) {
          profilesScraped++;
          postsDiscovered += result.data?.posts?.length || 0;
          
          // Update lastCheckedAt timestamp
          await prisma.discoveredCompetitor.update({
            where: { id: competitor.id },
            data: { lastCheckedAt: new Date() }
          });
        } else {
          errors.push(`Competitor ${competitor.handle}: ${result.error}`);
        }
        
        // Small delay between scrapes
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        errors.push(`Competitor ${competitor.platform} @${competitor.handle}: ${error.message}`);
      }
    }
    
    // Determine overall status
    const status = errors.length === 0 ? 'SUCCESS' : 
                   profilesScraped > 0 ? 'PARTIAL' : 
                   'FAILED';
    
    console.log(`[Monitoring] Completed for client ${clientId}: ${profilesScraped} profiles, ${postsDiscovered} posts, status=${status}`);
    
    return {
      clientId,
      profilesScraped,
      postsDiscovered,
      errors,
      status
    };
    
  } catch (error: any) {
    console.error(`[Monitoring] Failed to monitor client ${clientId}:`, error.message);
    errors.push(`Fatal error: ${error.message}`);
    
    return {
      clientId,
      profilesScraped,
      postsDiscovered,
      errors,
      status: 'FAILED'
    };
  }
}

/**
 * Monitor all active clients (clients with research jobs)
 */
export async function monitorAllClients(): Promise<MonitoringResult[]> {
  console.log(`[Monitoring] Starting monitoring for all active clients...`);
  
  // Get all clients that have research jobs
  const activeClients = await prisma.client.findMany({
    where: {
      researchJobs: {
        some: {}
      }
    },
    select: {
      id: true,
      name: true
    }
  });
  
  console.log(`[Monitoring] Found ${activeClients.length} active clients`);
  
  const results: MonitoringResult[] = [];
  
  for (const client of activeClients) {
    console.log(`[Monitoring] Processing client: ${client.name}`);
    const result = await monitorClient(client.id);
    results.push(result);
    
    // Small delay between clients to avoid overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  // Log summary
  const totalProfiles = results.reduce((sum, r) => sum + r.profilesScraped, 0);
  const totalPosts = results.reduce((sum, r) => sum + r.postsDiscovered, 0);
  const successCount = results.filter(r => r.status === 'SUCCESS').length;
  const partialCount = results.filter(r => r.status === 'PARTIAL').length;
  const failedCount = results.filter(r => r.status === 'FAILED').length;
  
  console.log(`[Monitoring] SUMMARY: ${totalProfiles} profiles scraped, ${totalPosts} posts discovered`);
  console.log(`[Monitoring] Status: ${successCount} success, ${partialCount} partial, ${failedCount} failed`);
  
  return results;
}

/**
 * Update a single competitor profile
 */
export async function updateCompetitorProfile(
  researchJobId: string,
  competitorId: string
): Promise<boolean> {
  try {
    const competitor = await prisma.discoveredCompetitor.findUnique({
      where: { id: competitorId }
    });
    
    if (!competitor) {
      console.error(`[Monitoring] Competitor ${competitorId} not found`);
      return false;
    }
    
    console.log(`[Monitoring] Updating competitor ${competitor.platform}: @${competitor.handle}`);
    const result = await scrapeProfileSafe(researchJobId, competitor.platform, competitor.handle);
    
    if (result.success) {
      await prisma.discoveredCompetitor.update({
        where: { id: competitorId },
        data: { lastCheckedAt: new Date() }
      });
      console.log(`[Monitoring] ✓ Updated competitor @${competitor.handle}`);
      return true;
    } else {
      console.error(`[Monitoring] ✗ Failed to update competitor @${competitor.handle}: ${result.error}`);
      return false;
    }
  } catch (error: any) {
    console.error(`[Monitoring] Error updating competitor:`, error.message);
    return false;
  }
}
