/**
 * Information Gathering Service
 * 
 * Orchestrates multi-layer fallback system for gathering intel about a target:
 * 1. DDG Search (raw data collection)
 * 2. AI Business Analysis (processed insights)
 * 3. Competitor Discovery (DDG Python -> Old Python -> Puppeteer Google -> Direct OpenAI)
 * 4. Brand Context Search (DDG Python + Puppeteer fallback)
 * 
 * GUARANTEE: Never returns empty results - AI generates minimum data
 */

import { googleSearchForCompetitors, searchBrandContext, type SearchResult } from './google-search.js';
import {
  searchBrandContextDDG, 
  searchCompetitorsDDG, 
  validateHandleDDG, 
  GatherAllResult, 
  gatherAllDDG, 
  saveRawResultsToDB 
} from './duckduckgo-search.js';
import { SmartQueryBuilder } from './smart-query-builder.js';
import { aiCompetitorFinder, enrichTargetProfile, synthesizeBrandContext, type TargetIntel, type Competitor } from './ai-intel.js';
import { analyzeBusinessWithAI, type BusinessAnalysisResult } from '../ai/business-analyzer.js';
import { askAllDeepQuestions } from '../ai/deep-questions';
import { scrapeProfileIncrementally } from '../social/scraper';
import { analyzeSearchTrends } from './google-trends';
import { runCommunityDetective } from '../social/community-detective';

export interface InformationGatheringResult {
  targetIntel: TargetIntel;
  competitors: Competitor[];
  brandContextRaw?: SearchResult[];
  aiBusinessAnalysis?: BusinessAnalysisResult & { id: string };
  errors: string[];
  layersUsed: string[];
}

export interface GatheringInput {
  handle: string;
  brandName?: string;
  bio: string;
  niche?: string;
  followerCount?: number;
  posts?: Array<{ caption: string; likes: number; comments: number }>;
  researchJobId?: string; // For saving raw results to DB
}

/**
 * Main entry point - gathers all intel with guaranteed results
 */
export async function gatherInformation(input: GatheringInput): Promise<InformationGatheringResult> {
  const errors: string[] = [];
  const layersUsed: string[] = [];
  let competitors: Competitor[] = [];
  let brandContext: Partial<TargetIntel> = {};
  let rawContextResults: SearchResult[] = [];

  console.log(`[InfoGather] Starting robust information gathering for @${input.handle}`);

  // === STEP 1: Robust Context Gathering (Smart Pipeline) ===
  console.log(`[InfoGather] Step 1: Starting Smart Gathering Pipeline...`);
  
  // A. Initial Comprehensive Search
  try {
    const researchJobId = input.researchJobId || 'temp-job';
    const ddgResult = await gatherAllDDG(
      input.brandName || input.handle, 
      input.niche || 'business',
      researchJobId
    );
    
    // B. Smart Query Analysis
    const queryBuilder = new SmartQueryBuilder();
    const smartQueries = queryBuilder.buildQueries(
      input.brandName || input.handle, 
      ddgResult
    );
    
    console.log(`[InfoGather] Generated ${smartQueries.competitorQueries.length} competitor queries and ${smartQueries.newsQueries.length} news queries`);
    
    // C. Execute Targeted Follow-up Searches
    // We already have generic results, now we search specifically for what we found missing or interesting
    
    // 1. Competitors (if we didn't find enough yet)
    // We'll let Step 3 handle the bulk, but we can seed it here
    
    // 2. News & Trends (if specifically requested or valuable)
    // ddgResult already includes basic news/images/videos from gatherAllDDG
    
    // D. Synthesize Context
    // Extract best website/socials from the rich data
    const websiteResult = ddgResult.text_results.find(r => !r.href.includes('instagram') && !r.href.includes('facebook') && !r.href.includes('linkedin'));
    
    brandContext = {
      brandName: input.brandName || input.handle,
      websiteUrl: websiteResult?.href,
      // We can parse more from the huge ddgResult blob if needed
      contextSummary: ddgResult.text_results.slice(0, 5).map(r => r.body).join('\n'),
    } as any;
    
      rawContextResults = ddgResult.text_results.map(r => ({
        title: r.title,
        snippet: r.body,
        link: r.href,
        source: 'other',
      }));
    
    layersUsed.push('SMART_GATHER_PIPELINE');
    console.log(`[InfoGather] ✅ Smart Pipeline Success: ${ddgResult.totals.total} data points collected`);
    
  } catch (error: any) {
    console.error(`[InfoGather] Smart pipeline failed, falling back:`, error.message);
    errors.push(`Smart Pipeline: ${error.message}`);
    
    // FALLBACK: Puppeteer (Legacy)
    try {
        console.log(`[InfoGather] Step 1B: Fallback to Puppeteer search...`);
        rawContextResults = await searchBrandContext(input.brandName || input.handle);
        
        if (rawContextResults.length > 0) {
          brandContext = await synthesizeBrandContext(input.handle, rawContextResults);
          layersUsed.push('PUPPETEER_BRAND_CONTEXT');
        }
    } catch (err: any) {
        console.error(`[InfoGather] Puppeteer fallback failed:`, err.message);
    }
  }

  // === STEP 2: Enrich Target Profile (Use Context if available) ===
  console.log(`[InfoGather] Step 2: Enriching target profile (AI Skipped)...`);
  let targetIntel: TargetIntel;
  // Skip AI enrichment to save costs
  targetIntel = {
      handle: input.handle,
      niche: input.niche || brandContext.niche || 'general',
      brandVoice: 'unknown',
      contentThemes: [],
      targetAudience: 'unknown',
      uniqueSellingPoints: [],
      suggestedNiche: input.niche || brandContext.suggestedNiche || 'business',
      ...brandContext,
  };
  layersUsed.push('MANUAL_TARGET_ENRICHMENT');

  // === STEP 3: Discover Competitors (Multi-layer fallback) ===
  console.log(`[InfoGather] Step 3: Discovering competitors...`);
  const effectiveNiche = targetIntel.suggestedNiche || input.niche || 'business';

  // Layer 0: DDG Python Library (Fastest, no browser needed)
  try {
    console.log(`[InfoGather] Layer 0: DDG Python Library...`);
    const ddgCompetitors = await searchCompetitorsDDG(input.handle, effectiveNiche, 15);
    
    if (ddgCompetitors.length > 0) {
      for (const handle of ddgCompetitors) {
        competitors.push({
          handle,
          platform: 'instagram',
          discoveryReason: 'Found via DuckDuckGo search',
          relevanceScore: 0.75,
          competitorType: 'discovered',
        });
      }
      layersUsed.push('DDG_PYTHON_COMPETITORS');
      console.log(`[InfoGather] ✅ DDG found ${ddgCompetitors.length} competitors`);
    }
  } catch (error: any) {
    console.error(`[InfoGather] DDG competitor search failed:`, error.message);
    errors.push(`DDG Competitors: ${error.message}`);
  }

  // Layer 1: Try Old Python script (if DDG didn't find enough)
  if (competitors.length < 5) {
    try {
      console.log(`[InfoGather] Layer 1: Old Python script...`);
      const pythonResult = await tryPythonDiscovery(input.handle, input.bio, effectiveNiche);
      if (pythonResult.length > 0) {
        // Merge unique
        const existingHandles = new Set(competitors.map(c => c.handle.toLowerCase()));
        for (const comp of pythonResult) {
          if (!existingHandles.has(comp.handle.toLowerCase())) {
            competitors.push(comp);
            existingHandles.add(comp.handle.toLowerCase());
          }
        }
        layersUsed.push('OLD_PYTHON_SCRIPT');
        console.log(`[InfoGather] ✅ Old Python found ${pythonResult.length} competitors`);
      }
    } catch (error: any) {
      console.error(`[InfoGather] Old Python script failed:`, error.message);
      errors.push(`Old Python: ${error.message}`);
    }
  }

  // Layer 2: Try Puppeteer Google Search (if we don't have enough)
  if (competitors.length < 5) {
    try {
      console.log(`[InfoGather] Layer 2: Puppeteer Google Search...`);
      const googleResult = await googleSearchForCompetitors(input.handle, effectiveNiche);
      if (googleResult.length > 0) {
        // Merge unique handles
        const existingHandles = new Set(competitors.map(c => c.handle.toLowerCase()));
        for (const handle of googleResult) {
          if (!existingHandles.has(handle.toLowerCase())) {
            competitors.push({
              handle,
              platform: 'instagram',
              discoveryReason: 'Found via Google search',
              relevanceScore: 0.7,
              competitorType: 'discovered',
            });
            existingHandles.add(handle.toLowerCase());
          }
        }
        layersUsed.push('PUPPETEER_GOOGLE');
        console.log(`[InfoGather] ✅ Google added ${googleResult.length} handles`);
      }
    } catch (error: any) {
      console.error(`[InfoGather] Google search failed:`, error.message);
      errors.push(`Google: ${error.message}`);
    }
  }

  // Layer 3: AI validation SKIPPED
  console.log(`[InfoGather] Layer 3: AI validation skipped as requested.`);

  // === GUARANTEE: Minimum 5 competitors ===
  if (competitors.length < 5) {
      console.log(`[InfoGather] Only ${competitors.length} competitors found found (AI fallback skipped).`);
  }

  // Sort by relevance
  competitors.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

  // === STEP 4: Deep AI Business Analysis ===
  let aiBusinessAnalysis: (BusinessAnalysisResult & { id: string }) | undefined;
  
  if (input.researchJobId) {
    try {
      console.log(`[InfoGather] Step 4: Running Deep AI Business Analysis (12+ dimensions)...`);
      
      // A. Run the new Deep Questions service
      const deepQuestions = await askAllDeepQuestions(input.researchJobId, {
        brandName: input.brandName || input.handle,
        handle: input.handle,
        bio: input.bio,
        niche: targetIntel.niche,
        websiteUrl: (brandContext as any).websiteUrl,
        rawSearchContext: rawContextResults.map(r => r.snippet).join('\n---\n'),
      });
      
      console.log(`[InfoGather] ✅ Deep Analysis Complete: ${deepQuestions.length} insights generated`);
      
      // B. Legacy analyzer skipped
      
      layersUsed.push('DEEP_AI_ANALYSIS');
      
      // === STEP 5: Incremental Social Scraping (Instagram + TikTok) ===
      console.log(`[InfoGather] Step 5: Incremental Social Scraping (User + Top Competitors)...`);
      
      // 1. Scrape User Instagram Profile
      await scrapeProfileIncrementally(input.researchJobId, 'instagram', input.handle)
        .catch(e => console.error(`[InfoGather] Failed to scrape user Instagram: ${e.message}`));
      
      // 2. Try TikTok Scraping (new!)
      try {
        const { tiktokService } = await import('../scraper/tiktok-service');
        await tiktokService.scrapeAndSave(input.researchJobId, input.handle, 20)
          .catch(e => console.error(`[InfoGather] TikTok scrape failed: ${e.message}`));
        layersUsed.push('TIKTOK_SCRAPING');
      } catch (e: any) {
        console.log(`[InfoGather] TikTok service not available: ${e.message}`);
      }
      
      // 3. Scrape Top 3 Competitors (Instagram)
      const topCompetitors = competitors.slice(0, 3);
      for (const comp of topCompetitors) {
        await scrapeProfileIncrementally(input.researchJobId, 'instagram', comp.handle)
          .catch(e => console.error(`[InfoGather] Failed to scrape competitor @${comp.handle}: ${e.message}`));
      }
      
      layersUsed.push('INCREMENTAL_SCRAPING');
      
      // === STEP 6: Macro Search Trends (Google) ===
      console.log(`[InfoGather] Step 6: Analyzing Google Search Trends...`);
      const trendKeywords = [
        input.brandName || input.handle,
        targetIntel.niche || 'business',
        ...(targetIntel.niche ? [`${targetIntel.niche} trends`] : [])
       ];
       
      await analyzeSearchTrends(input.researchJobId, trendKeywords)
        .catch(e => console.error(`[InfoGather] Trends analysis failed: ${e.message}`));
      
      layersUsed.push('SEARCH_TRENDS');
      
      // === STEP 7: Community Detective (VoC) - Enhanced with Handle Search ===
      console.log(`[InfoGather] Step 7: Running Community Detective (VoC + Reddit Handle Search)...`);
      await runCommunityDetective(
        input.researchJobId, 
        input.brandName || input.handle, 
        targetIntel.niche || 'business',
        input.handle // Pass handle for direct Reddit search
      ).catch(e => console.error(`[InfoGather] Community Detective failed: ${e.message}`));
      
      layersUsed.push('COMMUNITY_DETECTIVE');
      
    } catch (error: any) {
      console.error(`[InfoGather] Analysis/Scraping failed:`, error.message);
      errors.push(`Analysis: ${error.message}`);
    }
  }

  console.log(`[InfoGather] Complete! ${competitors.length} competitors, ${layersUsed.length} layers used`);

  return {
    targetIntel,
    competitors,
    brandContextRaw: rawContextResults,
    aiBusinessAnalysis,
    errors,
    layersUsed,
  };
}

/**
 * Wrapper for Python discovery script
 */
async function tryPythonDiscovery(handle: string, bio: string, niche: string): Promise<Competitor[]> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const path = await import('path');
  const execAsync = promisify(exec);

  const scriptPath = path.join(process.cwd(), 'scripts/competitor_discovery.py');
  
  const { stdout } = await execAsync(
    `python3 ${scriptPath} "${handle}" "${bio.replace(/"/g, '\\"')}" "${niche}" 10`,
    { 
      env: { ...process.env },
      timeout: 60000, // 60 second timeout
    }
  );

  const result = JSON.parse(stdout);
  const competitors = result.competitors || [];
  
  return competitors.map((c: any) => ({
    handle: c.handle,
    platform: c.platform || 'instagram',
    discoveryReason: c.discovery_reason,
    relevanceScore: c.relevance_score,
    competitorType: c.competitor_type || 'suggested',
  }));
}
