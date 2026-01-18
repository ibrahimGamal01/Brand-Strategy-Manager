/**
 * Community Detective (VoC Mining Service) v2
 * 
 * Enhanced with direct handle search on Reddit.
 * 
 * Capability: Uncovers "Emotional Truth" by analyzing Reddit/Forums.
 * 
 * Flow:
 * 1. Direct search: site:reddit.com "@handle"
 * 2. Search for brand mentions and reviews
 * 3. Use AI to extract: Pain Points, Desires, Marketing Hooks (Vernacular)
 * 4. Save to CommunityInsight
 */

import { PrismaClient } from '@prisma/client';
import { gatherAllDDG } from '../discovery/duckduckgo-search.js';
import { buildRedditQueries } from '../discovery/smart-query-builder.js';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface InsightExtraction {
  sentiment: 'positive' | 'negative' | 'neutral';
  painPoints: string[];
  desires: string[];
  marketingHooks: string[];
}

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
  
  if (brandName && brandName !== handle) {
    queries.push(`site:reddit.com "${brandName}"`);
    queries.push(`site:reddit.com "${brandName}" review`);
  }
  
  // Add niche discovery queries
  queries.push(`site:reddit.com ${niche} advice`);
  queries.push(`site:reddit.com ${niche} recommendation`);
  queries.push(`site:reddit.com ${niche} help`);
  
  // Deduplicate
  const uniqueQueries = Array.from(new Set(queries));
  
  console.log(`[CommunityDetective] Running ${uniqueQueries.length} queries...`);
  
  let totalInsights = 0;
  
  for (const query of uniqueQueries) {
    try {
      console.log(`[CommunityDetective] Searching: "${query}"`);
      
      const searchResult = await gatherAllDDG(query, niche, researchJobId);
      
      // Filter for community sources (Reddit, Quora, forums)
      const communityLinks = searchResult.text_results.filter(r => 
        r.href.includes('reddit.com') || 
        r.href.includes('quora.com') || 
        r.href.includes('trustpilot.com') ||
        r.href.includes('indiehackers.com') ||
        r.href.includes('community') ||
        r.href.includes('forum') ||
        r.href.includes('discuss')
      ).slice(0, 5); // Top 5 per query
      
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
        
        // Build context for AI analysis
        const contentContext = `Source: ${extractSource(link.href)}
Title: ${link.title}
Snippet: ${link.body}
Query Used: ${query}`;
        
        // Skip AI analysis to save costs/time as requested
        // const analysis = await analyzeContentWithAI(contentContext, brandName, niche);
        
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

async function analyzeContentWithAI(content: string, brand: string, niche: string): Promise<InsightExtraction> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are a Voice of Customer (VoC) analyst. Extract psychological insights from this discussion snippet about ${brand} (${niche}).
          
          Focus on:
          - Real pain points people mention
          - Unmet desires and wishes
          - Exact phrases that could be used in marketing (vernacular)
          
          Return JSON:
          {
            "sentiment": "positive" | "negative" | "neutral",
            "painPoints": ["specific complaint 1", "specific complaint 2"],
            "desires": ["I wish it had X", "Why can't I just Y"],
            "marketingHooks": ["Exact user phrasing 1", "Powerful emotional word 2"]
          }`
        },
        {
          role: 'user',
          content
        }
      ],
      response_format: { type: 'json_object' }
    });
    
    return JSON.parse(response.choices[0].message.content || '{}');
  } catch (e) {
    return {
      sentiment: 'neutral',
      painPoints: [],
      desires: [],
      marketingHooks: []
    };
  }
}
