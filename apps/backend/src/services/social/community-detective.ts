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

const ALLOWED_SOURCES = new Set(['reddit', 'quora', 'trustpilot', 'forum']);

export interface CommunityDetectiveOptions {
  runId?: string;
  allowedSources?: Array<'reddit' | 'quora' | 'trustpilot' | 'forum'>;
}

export interface CommunityDetectiveResult {
  queriesRun: number;
  linksCollected: number;
  insightsSaved: number;
  skippedExisting: number;
  filteredOut: number;
}


/**
 * Main entry point for Community Detective
 */
export async function runCommunityDetective(
  researchJobId: string,
  brandName: string,
  niche: string,
  handle?: string,
  options: CommunityDetectiveOptions = {}
): Promise<CommunityDetectiveResult> {
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
  let collectedLinks = 0;
  let skippedExisting = 0;
  let filteredOut = 0;
  const allowedSources = options.allowedSources && options.allowedSources.length > 0
    ? new Set(options.allowedSources.filter((source) => ALLOWED_SOURCES.has(source)))
    : null;
  
  for (const query of uniqueQueries) {
    try {
      console.log(`[CommunityDetective] Searching: "${query}"`);
      
      const searchResult = await gatherAllDDG(query, niche, researchJobId);
      
      // Filter for community sources (Reddit, Quora, forums)
      // Filter for community sources (Reddit, Quora, forums)
      // STRICT REQUIREMENTS:
      // 1. Must be community source
      // 2. Must mention brand/handle
      // 3. Must NOT contain irrelevant keywords
      // 4. Should relate to niche
      const communityLinks = searchResult.text_results.filter(r => {
        // 1. Source check
        const isCommunity = r.href.includes('reddit.com') || 
          r.href.includes('quora.com') || 
          r.href.includes('trustpilot.com') ||
          r.href.includes('indiehackers.com') ||
          r.href.includes('community') ||
          r.href.includes('forum') ||
          r.href.includes('discuss');

        if (!isCommunity) {
          filteredOut += 1;
          return false;
        }

        const text = (r.title + ' ' + r.body).toLowerCase();
        
        // 2. CRITICAL: Must mention brand/handle
        const target = (handle || brandName).toLowerCase().replace('@', '');
        const hasBrandMention = text.includes(target);
        
        if (!hasBrandMention) {
          console.log(`[Filter] Rejected: No brand mention in "${r.title.slice(0, 50)}..."`);
          filteredOut += 1;
          return false;
        }
        
        // 3. SIMPLE: Just check if it relates to the niche
        const nicheKeywords = niche.toLowerCase().split(' ').filter(w => w.length > 3);
        const hasNicheMatch = nicheKeywords.some(kw => text.includes(kw));
        
        // Log if weak niche match but keep it (brand mention is what matters)
        if (!hasNicheMatch) {
          console.log(`[Info] Weak niche match but has brand mention: "${r.title.slice(0, 50)}..."`);
        }
        
        const source = extractSource(r.href);
        if (allowedSources && !allowedSources.has(source as any)) {
          filteredOut += 1;
          return false;
        }

        return true; // Passed: has brand mention + source filter
      }).slice(0, 5); // Top 5 per query
      
      if (communityLinks.length === 0) {
        console.log(`[CommunityDetective] No community links found for "${query}"`);
        continue;
      }
      
      console.log(`[CommunityDetective] Found ${communityLinks.length} community sources`);
      collectedLinks += communityLinks.length;
      
      for (const link of communityLinks) {
        // Check if already analyzed
        const existing = await prisma.communityInsight.findFirst({
          where: { researchJobId, url: link.href }
        });
        
        if (existing) {
          skippedExisting += 1;
          continue;
        }
        
        // Build context for storage
        const contentContext = `Source: ${extractSource(link.href)}
Title: ${link.title}
Snippet: ${link.body}
Query Used: ${query}`;

        // Save to DB
        await prisma.communityInsight.create({
          data: {
            researchJobId,
            brandIntelligenceRunId: options.runId || null,
            source: extractSource(link.href),
            url: link.href,
            content: contentContext,
            sourceQuery: query,
            evidence: {
              title: link.title,
              snippet: link.body,
            },
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
  return {
    queriesRun: uniqueQueries.length,
    linksCollected: collectedLinks,
    insightsSaved: totalInsights,
    skippedExisting,
    filteredOut,
  };
}

function extractSource(url: string): string {
  if (url.includes('reddit')) return 'reddit';
  if (url.includes('quora')) return 'quora';
  if (url.includes('trustpilot')) return 'trustpilot';
  if (url.includes('indiehackers')) return 'forum';
  return 'forum';
}
