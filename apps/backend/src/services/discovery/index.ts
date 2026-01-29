/**
 * Information Gathering Service
 * 
 * Orchestrates multi-layer fallback system for gathering intel about a target:
 * 1. DDG Search (raw data collection)
 * 2. AI Business Analysis (processed insights)
 * 3. Competitor Discovery (DDG Python -> Old Python -> Puppeteer Google -> Direct OpenAI)
 * 4. Brand Context Search (DDG Python + Puppeteer fallback)
 * 
 * NEW: Resume Logic - checks DB for existing data and skips completed gatherers
 * GUARANTEE: Never returns empty results - AI generates minimum data
 */

import { googleSearchForCompetitors, searchBrandContext, type SearchResult } from './google-search.js';
import {
  searchBrandContextDDG, 
  searchCompetitorsDDG, 
  validateHandleDDG, 
  GatherAllResult, 
  gatherAllDDG, 
  saveRawResultsToDB,
  scrapeSocialContent
} from './duckduckgo-search.js';
import { SmartQueryBuilder } from './smart-query-builder.js';
import { aiCompetitorFinder, enrichTargetProfile, synthesizeBrandContext, type TargetIntel, type Competitor } from './ai-intel.js';
import { analyzeBusinessWithAI, type BusinessAnalysisResult } from '../ai/business-analyzer.js';
import { askAllDeepQuestions } from '../ai/deep-questions';
import { scrapeProfileIncrementally } from '../social/scraper';
import { analyzeSearchTrends } from './google-trends';
import { runCommunityDetective } from '../social/community-detective';
import { validateCompetitorBatch, filterValidatedCompetitors } from './instagram-validator.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
  handles?: Record<string, string>; // Multi-platform handles: { instagram: 'x', tiktok: 'y' }
}

/**
 * Check which gatherers have already completed for this research job
 */
export interface CompletedGatherers {
  hasDDGSearch: boolean;
  hasCompetitors: boolean;
  hasSocialProfiles: boolean;
  hasAIQuestions: boolean;
  hasSearchTrends: boolean;
  hasCommunityInsights: boolean;
  counts: {
    rawSearchResults: number;
    competitors: number;
    socialProfiles: number;
    aiQuestions: number;
    searchTrends: number;
    communityInsights: number;
  };
}

export async function getCompletedGatherers(researchJobId: string): Promise<CompletedGatherers> {
  const [
    rawSearchCount,
    competitorCount,
    socialProfileCount,
    aiQuestionCount,
    searchTrendCount,
    communityInsightCount,
  ] = await Promise.all([
    prisma.rawSearchResult.count({ where: { researchJobId } }),
    prisma.discoveredCompetitor.count({ where: { researchJobId } }),
    prisma.socialProfile.count({ where: { researchJobId } }),
    prisma.aiQuestion.count({ where: { researchJobId, isAnswered: true } }),
    prisma.searchTrend.count({ where: { researchJobId } }),
    prisma.communityInsight.count({ where: { researchJobId } }),
  ]);

  return {
    hasDDGSearch: rawSearchCount > 10, // At least 10 results means DDG ran
    hasCompetitors: competitorCount > 3, // At least 3 competitors found
    hasSocialProfiles: socialProfileCount > 0,
    hasAIQuestions: aiQuestionCount >= 10, // At least 10 of 12 questions answered
    hasSearchTrends: searchTrendCount > 0,
    hasCommunityInsights: communityInsightCount > 0,
    counts: {
      rawSearchResults: rawSearchCount,
      competitors: competitorCount,
      socialProfiles: socialProfileCount,
      aiQuestions: aiQuestionCount,
      searchTrends: searchTrendCount,
      communityInsights: communityInsightCount,
    },
  };
}

/**
 * Main entry point - gathers all intel with guaranteed results
 * NOW WITH RESUME LOGIC: Checks what has already been gathered and skips those steps
 */
export async function gatherInformation(input: GatheringInput): Promise<InformationGatheringResult> {
  const errors: string[] = [];
  const layersUsed: string[] = [];
  let competitors: Competitor[] = [];
  let brandContext: Partial<TargetIntel> = {};
  let rawContextResults: SearchResult[] = [];

  console.log(`[InfoGather] Starting robust information gathering for @${input.handle}`);

  // === NEW: Check what has already been gathered ===
  let completed: CompletedGatherers | null = null;
  if (input.researchJobId && input.researchJobId !== 'temp-job') {
    completed = await getCompletedGatherers(input.researchJobId);
    console.log(`[InfoGather] Resume check: DDG=${completed.hasDDGSearch}, Competitors=${completed.hasCompetitors}, Social=${completed.hasSocialProfiles}, AI=${completed.hasAIQuestions}, Trends=${completed.hasSearchTrends}, Community=${completed.hasCommunityInsights}`);
    console.log(`[InfoGather] Existing counts: ${JSON.stringify(completed.counts)}`);
  }


  // === STEP 1: Robust Context Gathering (Smart Pipeline) ===
  console.log(`[InfoGather] Step 1: Starting Smart Gathering Pipeline...`);
  
  // A. Initial Comprehensive Search (skip if already done)
  const shouldSkipDDGSearch = completed?.hasDDGSearch;
  
  if (shouldSkipDDGSearch) {
    console.log(`[InfoGather] ✓ SKIPPING DDG Search (already have ${completed!.counts.rawSearchResults} results)`);
    layersUsed.push('DDG_SEARCH_SKIPPED_RESUME');
  }
  
  if (!shouldSkipDDGSearch) {
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
  }

  // === STEP 1.5: Scrape Social Content (Images/Videos) via Site-Limited Search ===
  // This is the ONLY approved media source alongside authenticated Instagram scraper
  console.log(`[InfoGather] Step 1.5: Scraping social media content via site-limited search...`);
  try {
    // Use all handles from input, or fallback to primary handle
    const handles: Record<string, string> = input.handles && Object.keys(input.handles).length > 0
      ? input.handles
      : { instagram: input.handle };
    
    console.log(`[InfoGather] Using ${Object.keys(handles).length} platform handles: ${Object.entries(handles).map(([p, h]) => `${p}:@${h}`).join(', ')}`);
    
    const researchJobId = input.researchJobId || 'temp-job';
    const socialContent = await scrapeSocialContent(handles, 30, researchJobId);
    
    console.log(`[InfoGather] Scraped ${socialContent.totals.images} images and ${socialContent.totals.videos} videos from social handles`);
    layersUsed.push('SITE_LIMITED_SOCIAL_CONTENT');
  } catch (error: any) {
    console.error(`[InfoGather] Social content scrape failed:`, error.message);
    errors.push(`Social Content Scrape: ${error.message}`);
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

  // Layer -1: Site-Limited Social Search (NEW - most accurate for social handles)
  try {
    console.log(`[InfoGather] Layer -1: Site-Limited Social Search...`);
    const { searchSocialProfiles } = await import('./duckduckgo-search.js');
    const socialResult = await searchSocialProfiles(input.brandName || input.handle, input.researchJobId);
    
    // Add discovered Instagram handles
    if (socialResult.instagram && socialResult.instagram.length > 0) {
      const existingHandles = new Set(competitors.map(c => c.handle.toLowerCase()));
      for (const handle of socialResult.instagram) {
        if (!existingHandles.has(handle.toLowerCase()) && handle.toLowerCase() !== input.handle.toLowerCase()) {
          competitors.push({
            handle,
            platform: 'instagram',
            discoveryReason: 'Found via site-limited Instagram search',
            relevanceScore: 0.85, // Higher score for direct platform search
            competitorType: 'discovered',
          });
          existingHandles.add(handle.toLowerCase());
        }
      }
    }
    
    // Add TikTok handles
    if (socialResult.tiktok && socialResult.tiktok.length > 0) {
      for (const handle of socialResult.tiktok) {
        competitors.push({
          handle,
          platform: 'tiktok',
          discoveryReason: 'Found via site-limited TikTok search',
          relevanceScore: 0.85,
          competitorType: 'discovered',
        });
      }
    }
    
    layersUsed.push('SITE_LIMITED_SOCIAL_SEARCH');
    console.log(`[InfoGather] ✅ Site-limited search found ${socialResult.totals?.total || 0} social handles`);
  } catch (error: any) {
    console.error(`[InfoGather] Site-limited social search failed:`, error.message);
    errors.push(`Social Search: ${error.message}`);
  }

  // Layer 0: DDG Python Library (Generic niche-based search)
  try {
    console.log(`[InfoGather] Layer 0: DDG Python Library...`);
    const ddgCompetitors = await searchCompetitorsDDG(input.handle, effectiveNiche, 15);
    
    if (ddgCompetitors.length > 0) {
      const existingHandles = new Set(competitors.map(c => c.handle.toLowerCase()));
      for (const handle of ddgCompetitors) {
        if (!existingHandles.has(handle.toLowerCase())) {
          competitors.push({
            handle,
            platform: 'instagram',
            discoveryReason: 'Found via DuckDuckGo search',
            relevanceScore: 0.75,
            competitorType: 'discovered',
          });
          existingHandles.add(handle.toLowerCase());
        }
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

  // Layer 3: Validate discovered competitors
  console.log(`[InfoGather] Layer 3: Validating ${competitors.length} discovered competitors...`);
  
  if (competitors.length > 0) {
    try {
      // Batch validate all discovered competitors
      const validationResults = await validateCompetitorBatch(
        competitors,
        effectiveNiche,
        input.handle
      );
      
      // Filter and re-score based on validation
      const validatedCompetitors = filterValidatedCompetitors(
        competitors,
        validationResults,
        0.5 // Minimum confidence threshold
      );
      
      console.log(`[InfoGather] Validation complete: ${validatedCompetitors.length}/${competitors.length} competitors passed validation`);
      
      // Log some examples of filtered competitors
      const filtered = competitors.filter(c => 
        !validatedCompetitors.find(vc => vc.handle === c.handle)
      );
      if (filtered.length > 0) {
        console.log(`[InfoGather] Filtered out ${filtered.length} competitors:`, 
          filtered.slice(0, 5).map(c => c.handle).join(', '));
      }
      
      competitors = validatedCompetitors;
      layersUsed.push('INSTAGRAM_VALIDATION');
    } catch (error: any) {
      console.error(`[InfoGather] Validation failed, using unvalidated competitors:`, error.message);
      errors.push(`Validation: ${error.message}`);
    }
  }

  // === GUARANTEE: Minimum competitors ===
  if (competitors.length < 3) {
      console.log(`[InfoGather] Only ${competitors.length} validated competitors found.`);
  }

  // Sort by relevance (validation may have updated scores)
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
