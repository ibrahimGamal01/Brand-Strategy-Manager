/**
 * Community Detective (VoC Mining Service) v2
 * 
 * Enhanced with direct handle search on Reddit.
 * 
 * Capability: Uncovers "Emotional Truth" by analyzing Reddit/Forums.
 * 
 * Flow:
 * 1. Direct search: site:reddit.com "@handle"
 * 3. Save to CommunityInsight directly
 */

import { PrismaClient } from '@prisma/client';
import { gatherAllDDG } from '../discovery/duckduckgo-search.js';
import { buildRedditQueries } from '../discovery/smart-query-builder.js';
const prisma = new PrismaClient();



/**
 * Main entry point for Community Detective
 */
export async function runCommunityDetective(
  researchJobId: string,
  brandName: string,
  niche: string,
  handle?: string
): Promise<void> {
  console.log(`[CommunityDetective] Starting investigation for ${brandName} (@${handle || 'no-handle'}) in ${niche}...`);
  
  // Use fixed comprehensive Reddit queries
  const redditQueries = buildRedditQueries(handle || brandName, niche);
  
  // Add brand-specific queries if different from handle
  const queries: string[] = [...redditQueries];
  

  

  // Removed generic niche discovery queries to enforce handle presence as per user request

  
  // Deduplicate
  const uniqueQueries = Array.from(new Set(queries));
  
  console.log(`[CommunityDetective] Running ${uniqueQueries.length} queries...`);
  
  let totalInsights = 0;
  
  for (const query of uniqueQueries) {
    try {
      console.log(`[CommunityDetective] Searching: "${query}"`);
      
      const searchResult = await gatherAllDDG(query, niche, researchJobId);
      
      // Filter for community sources (Reddit, Quora, forums)
      // Filter for community sources (Reddit, Quora, forums)
      // AND STRICTLY enforce that the result contains the handle/brand
      const communityLinks = searchResult.text_results.filter(r => {
        // 1. Source check
        const isCommunity = r.href.includes('reddit.com') || 
          r.href.includes('quora.com') || 
          r.href.includes('trustpilot.com') ||
          r.href.includes('indiehackers.com') ||
          r.href.includes('community') ||
          r.href.includes('forum') ||
          r.href.includes('discuss');

        if (!isCommunity) return false;

        // 2. Strict Content Check (Force Handle)
        const target = (handle || brandName).toLowerCase().replace('@', '');
        const text = (r.title + ' ' + r.body).toLowerCase();
        
        return text.includes(target); 
      }).slice(0, 5); // Top 5 per query
      
      if (communityLinks.length === 0) {
        console.log(`[CommunityDetective] No community links found for "${query}"`);
        continue;
      }
      
      console.log(`[CommunityDetective] Found ${communityLinks.length} community sources`);
      
      for (const link of communityLinks) {
        // Check if already analyzed
        const existing = await prisma.communityInsight.findFirst({
          where: { researchJobId, url: link.href }
        });
        
        if (existing) continue;
        
        // Build context for storage
        const contentContext = `Source: ${extractSource(link.href)}
Title: ${link.title}
Snippet: ${link.body}
Query Used: ${query}`;

        // AI analysis removed as per user request. Saving raw search results.
        const analysis = {
            sentiment: 'neutral',
            painPoints: [],
            desires: [],
            marketingHooks: []
        };

        // Save to DB
        await prisma.communityInsight.create({
          data: {
            researchJobId,
            source: extractSource(link.href),
            url: link.href,
            content: contentContext,
            sentiment: 'neutral',
            painPoints: [],
            desires: [],
            marketingHooks: [],
            metric: 'search_rank',
            metricValue: 0,
          }
        });
        
        totalInsights++;
        console.log(`[CommunityDetective] Saved insight from ${extractSource(link.href)}: ${link.title.slice(0, 50)}...`);
      }
      
    } catch (e: any) {
      console.error(`[CommunityDetective] Failed query "${query}": ${e.message}`);
    }
  }
  
  console.log(`[CommunityDetective] Complete! ${totalInsights} new insights gathered.`);
}

function extractSource(url: string): string {
  if (url.includes('reddit')) return 'reddit';
  if (url.includes('quora')) return 'quora';
  if (url.includes('trustpilot')) return 'trustpilot';
  if (url.includes('indiehackers')) return 'indiehackers';
  return 'forum';
}

