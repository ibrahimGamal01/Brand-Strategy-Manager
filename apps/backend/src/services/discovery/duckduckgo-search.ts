/**
 * DuckDuckGo Search Service (Python-backed) v2
 * 
 * Uses the ddgs Python library for fast, reliable search
 * Saves RAW results to database for multi-purpose processing
 * 
 * Capabilities:
 * 1. Brand Context Search (website, socials, summary)
 * 2. Competitor Discovery (finding similar accounts)
 * 3. Handle Validation (checking if handle is legitimate)
 * 4. Raw Results Storage (for later processing)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

export interface RawSearchResult {
  query: string;
  title: string;
  href: string;
  body: string;
}

export interface BrandContextResult {
  brand_name: string;
  website_url: string | null;
  instagram_handle: string | null;
  facebook_url: string | null;
  tiktok_handle: string | null;
  linkedin_url: string | null;
  twitter_handle: string | null;
  youtube_channel: string | null;
  context_summary: string;
  raw_results: RawSearchResult[];
  error?: string;
}

export interface CompetitorSearchResult {
  competitors: string[];
  raw_results: RawSearchResult[];
  total_raw: number;
  total_handles: number;
}

export interface HandleValidationResult {
  handle: string;
  platform: string;
  is_valid: boolean;
  confidence: number;
  reason: string;
  found_urls: string[];
  raw_results: RawSearchResult[];
  error?: string;
}

export interface SocialSearchResult {
  brand_name: string;
  instagram: string[];
  tiktok: string[];
  youtube: string[];
  twitter: string[];
  linkedin: string[];
  facebook: string[];
  raw_results: Array<RawSearchResult & { platform: string }>;
  totals: {
    instagram: number;
    tiktok: number;
    youtube: number;
    twitter: number;
    linkedin: number;
    facebook: number;
    total: number;
    raw: number;
  };
  error?: string;
}

/**
 * Save raw search results to database for later processing
 */
export async function saveRawResultsToDB(
  researchJobId: string,
  results: RawSearchResult[],
  source: string = 'duckduckgo'
): Promise<number> {
  if (!results || results.length === 0) return 0;
  
  try {
    const data = results.map(r => ({
      researchJobId,
      query: r.query,
      source,
      title: r.title,
      href: r.href,
      body: r.body,
    }));
    
    const created = await prisma.rawSearchResult.createMany({
      data,
      skipDuplicates: true,
    });
    
    console.log(`[DDGSearch] Saved ${created.count} raw results to DB`);
    return created.count;
    
  } catch (error: any) {
    console.error(`[DDGSearch] Failed to save raw results:`, error.message);
    return 0;
  }
}

/**
 * Search for brand context using DuckDuckGo
 * Returns website, social handles, context summary, AND raw results
 */
export async function searchBrandContextDDG(
  brandName: string,
  researchJobId?: string
): Promise<BrandContextResult> {
  console.log(`[DDGSearch] Searching brand context for: "${brandName}"`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/ddg_search.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} brand_context "${brandName}"`,
      {
        cwd: process.cwd(),
        timeout: 120000, // 2 min timeout for more results
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large results
      }
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: BrandContextResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Found: website=${result.website_url}, instagram=@${result.instagram_handle}, raw=${result.raw_results?.length || 0}`);
    
    // Save raw results to DB if research job provided
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(researchJobId, result.raw_results, 'duckduckgo_brand_context');
    }
    
    return result;
    
  } catch (error: any) {
    console.error(`[DDGSearch] Brand context search failed:`, error.message);
    return {
      brand_name: brandName,
      website_url: null,
      instagram_handle: null,
      facebook_url: null,
      tiktok_handle: null,
      linkedin_url: null,
      twitter_handle: null,
      youtube_channel: null,
      context_summary: '',
      raw_results: [],
      error: error.message,
    };
  }
}

/**
 * Search for competitor Instagram handles using DuckDuckGo
 * Returns competitors AND raw results for DB storage
 */
export async function searchCompetitorsDDG(
  handle: string,
  niche: string,
  maxResults: number = 100,
  researchJobId?: string
): Promise<string[]> {
  console.log(`[DDGSearch] Searching competitors for @${handle} in "${niche}"`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/ddg_search.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} competitors "${handle}" "${niche}" ${maxResults}`,
      {
        cwd: process.cwd(),
        timeout: 180000, // 3 min timeout for extensive search
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: CompetitorSearchResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Found ${result.competitors.length} competitors from ${result.total_raw} raw results`);
    
    // Save raw results to DB if research job provided
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(researchJobId, result.raw_results, 'duckduckgo_competitors');
    }
    
    return result.competitors || [];
    
  } catch (error: any) {
    console.error(`[DDGSearch] Competitor search failed:`, error.message);
    return [];
  }
}


/**
 * Perform a direct search for competitors using a specific query
 * e.g., "Brand Name competitors instagram"
 */
export async function performDirectCompetitorSearch(query: string): Promise<string[]> {
    console.log(`[DDGSearch] Running direct competitor search: "${query}"`);
    // Re-use the existing search logic but purely as a discovery mechanism
    // In reality this might need a specific python script mode, but for now 
    // we can reuse the 'competitors' mode if we pass the query as the 'handle' 
    // effectively tricking the script or using a new mode. 
    // For simplicity/robustness, let's use searchCompetitorsDDG logic but 
    // we might need to adjust the python script to handle freeform queries better.
    // Assuming searchCompetitorsDDG handles the query construction internally mostly.
    
    // Actually, looking at the python script usage in searchCompetitorsDDG:
    // python3 scripts/ddg_search.py competitors "handle" "niche"
    
    // We should probably rely on the gather_all or a raw search for this 
    // to explain "Direct Query".
    
    // For MVP efficiency: We will use the existing searchCompetitorsDDG 
    // but pass our constructed query as the "niche" to influence results
    // while passing strict handle. This is a bit hacky.
    
    // BETTER APPROACH: Use the new AI service for parsing, but here we want
    // raw DDG results.
    
    // Let's implement a simple raw search wrapper here if needed, 
    // OR just alias it to searchCompetitorsDDG for now, acknowledging limitation.
    
    // It seems searchCompetitorsDDG uses the brand handle + "competitors" + niche.
    // If we want "Direct Query", we effectively want to customize that string.
    
    // We will return an empty array for now and rely on Source 1 & 3 
    // until we verify the python script supports raw queries. 
    // Wait, the user wants "Direct Query: DDG Search for '${brand} competitors'".
    
    // Let's use searchCompetitorsDDG but utilize the 'niche' param to pass 'competitors' context
    return searchCompetitorsDDG(query, 'competitors', 20);
}

/**
 * Full competitor search including raw results (for when you need everything)
 */
export async function searchCompetitorsDDGFull(
  handle: string,
  niche: string,
  maxResults: number = 100,
  researchJobId?: string
): Promise<CompetitorSearchResult> {
  console.log(`[DDGSearch] Full competitor search for @${handle} in "${niche}"`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/ddg_search.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} competitors "${handle}" "${niche}" ${maxResults}`,
      {
        cwd: process.cwd(),
        timeout: 180000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: CompetitorSearchResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Full search: ${result.competitors.length} handles, ${result.total_raw} raw results`);
    
    // Save raw results to DB
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(researchJobId, result.raw_results, 'duckduckgo_competitors');
    }
    
    return result;
    
  } catch (error: any) {
    console.error(`[DDGSearch] Full competitor search failed:`, error.message);
    return {
      competitors: [],
      raw_results: [],
      total_raw: 0,
      total_handles: 0,
    };
  }
}

/**
 * Validate if a handle appears to be legitimate using DuckDuckGo
 */
export async function validateHandleDDG(
  handle: string,
  platform: string = 'instagram'
): Promise<HandleValidationResult> {
  console.log(`[DDGSearch] Validating @${handle} on ${platform}`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/ddg_search.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} validate "${handle}" "${platform}"`,
      {
        cwd: process.cwd(),
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: HandleValidationResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Validation: ${result.is_valid ? 'VALID' : 'INVALID'} (${Math.round(result.confidence * 100)}%)`);
    
    return result;
    
  } catch (error: any) {
    console.error(`[DDGSearch] Handle validation failed:`, error.message);
    return {
      handle,
      platform,
      is_valid: false,
      confidence: 0,
      reason: `Validation failed: ${error.message}`,
      found_urls: [],
      raw_results: [],
      error: error.message,
    };
  }
}

/**
 * Site-limited search for social media profiles
 * Uses site: operator to find profiles on specific platforms
 */
export async function searchSocialProfiles(
  brandName: string,
  researchJobId?: string
): Promise<SocialSearchResult> {
  console.log(`[DDGSearch] Site-limited social search for: "${brandName}"`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/ddg_search.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} social_search "${brandName}"`,
      {
        cwd: process.cwd(),
        timeout: 180000, // 3 min timeout for comprehensive search
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: SocialSearchResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Social search found: Instagram=${result.instagram?.length || 0}, TikTok=${result.tiktok?.length || 0}, YouTube=${result.youtube?.length || 0}`);
    
    // Save raw results to DB if research job provided
    if (researchJobId && result.raw_results?.length > 0) {
      await saveRawResultsToDB(
        researchJobId, 
        result.raw_results.map(r => ({
          query: r.query,
          title: r.title,
          href: r.href,
          body: r.body,
        })), 
        'duckduckgo_social_search'
      );
    }
    
    return result;
    
  } catch (error: any) {
    console.error(`[DDGSearch] Social search failed:`, error.message);
    return {
      brand_name: brandName,
      instagram: [],
      tiktok: [],
      youtube: [],
      twitter: [],
      linkedin: [],
      facebook: [],
      raw_results: [],
      totals: {
        instagram: 0,
        tiktok: 0,
        youtube: 0,
        twitter: 0,
        linkedin: 0,
        facebook: 0,
        total: 0,
        raw: 0,
      },
      error: error.message,
    };
  }
}

// Interfaces for gather_all results
export interface NewsResult {
  query: string;
  title: string;
  body: string;
  url: string;
  source: string;
  image_url: string;
  published_at: string;
}

export interface VideoResult {
  query: string;
  title: string;
  description: string;
  url: string;
  embed_url: string;
  duration: string;
  publisher: string;
  uploader: string;
  view_count: number | null;
  thumbnail_url: string;
  published_at: string;
}

export interface ImageResult {
  query: string;
  title: string;
  image_url: string;
  thumbnail_url: string;
  source_url: string;
  width: number | null;
  height: number | null;
}

export interface GatherAllResult {
  brand_name: string;
  niche: string;
  text_results: RawSearchResult[];
  news_results: NewsResult[];
  video_results: VideoResult[];
  image_results: ImageResult[];
  totals: {
    text: number;
    news: number;
    videos: number;
    images: number;
    total: number;
  };
}

/**
 * COMPREHENSIVE: Gather ALL DDG data and save to DB
 * This is the main entry point for maximizing data collection
 */
export async function gatherAllDDG(
  brandName: string,
  niche: string,
  researchJobId: string
): Promise<GatherAllResult> {
  console.log(`[DDGSearch] Starting comprehensive gather for "${brandName}" in "${niche}"`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/ddg_search.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} gather_all "${brandName}" "${niche}"`,
      {
        cwd: process.cwd(),
        timeout: 300000, // 5 min timeout for comprehensive search
        maxBuffer: 100 * 1024 * 1024, // 100MB buffer
      }
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: GatherAllResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Gathered: ${result.totals.total} total (${result.totals.text} text, ${result.totals.news} news, ${result.totals.videos} videos, ${result.totals.images} images)`);
    
    // Save all results to DB
    await saveAllResultsToDB(researchJobId, result);
    
    // NEW: Also scrape social content for images/videos using site-limited search
    // This ensures we get media from the actual social profiles, not generic search
    console.log(`[DDGSearch] Scraping social content for images/videos...`);
    
    // First, try to find social handles from the brand context search
    const brandContext = await searchBrandContextDDG(brandName, researchJobId);
    
    // Build handles object from discovered socials
    const handles: Record<string, string> = {};
    if (brandContext.instagram_handle) handles.instagram = brandContext.instagram_handle;
    if (brandContext.tiktok_handle) handles.tiktok = brandContext.tiktok_handle;
    
    // Scrape social content if we found any handles
    if (Object.keys(handles).length > 0) {
      const socialContent = await scrapeSocialContent(handles, 30, researchJobId);
      console.log(`[DDGSearch] Scraped ${socialContent.totals.images} images, ${socialContent.totals.videos} videos from social profiles`);
    } else {
      console.log(`[DDGSearch] No social handles found, skipping social content scrape`);
    }
    
    return result;
    
  } catch (error: any) {
    console.error(`[DDGSearch] Gather all failed:`, error.message);
    throw error;
  }
}

/**
 * Save all gathered results to their respective DB tables
 */
async function saveAllResultsToDB(researchJobId: string, result: GatherAllResult): Promise<void> {
  console.log(`[DDGSearch] Saving ${result.totals.total} results to DB (with deduplication)...`);
  
  // Save text results with upsert for proper deduplication
  if (result.text_results.length > 0) {
    let newCount = 0;
    let updatedCount = 0;
    
    for (const r of result.text_results) {
      try {
        const existing = await prisma.rawSearchResult.findUnique({
          where: {
            researchJobId_href: { researchJobId, href: r.href },
          },
        });
        
        if (existing) {
          // Update seen count
          await prisma.rawSearchResult.update({
            where: { id: existing.id },
            data: {
              lastSeenAt: new Date(),
              seenCount: existing.seenCount + 1,
            },
          });
          updatedCount++;
        } else {
          // Create new
          await prisma.rawSearchResult.create({
            data: {
              researchJobId,
              query: r.query,
              source: 'duckduckgo',
              title: r.title,
              href: r.href,
              body: r.body,
            },
          });
          newCount++;
        }
      } catch (error: any) {
        // Skip duplicates
        if (!error.message?.includes('Unique constraint')) {
          console.error(`[DDGSearch] Error saving result:`, error.message);
        }
      }
    }
    console.log(`[DDGSearch] Text: ${newCount} new, ${updatedCount} updated`);
  }
  
  // Save news results
  if (result.news_results.length > 0) {
    const newsData = result.news_results.map(r => ({
      researchJobId,
      query: r.query,
      title: r.title,
      body: r.body || null,
      url: r.url,
      source: r.source || null,
      imageUrl: r.image_url || null,
      publishedAt: r.published_at || null,
    }));
    
    const newsCreated = await prisma.ddgNewsResult.createMany({
      data: newsData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${newsCreated.count} news results`);
  }
  
  // Save video results
  if (result.video_results.length > 0) {
    const videoData = result.video_results.map(r => ({
      researchJobId,
      query: r.query,
      title: r.title,
      description: r.description || null,
      url: r.url,
      embedUrl: r.embed_url || null,
      duration: r.duration || null,
      publisher: r.publisher || null,
      uploader: r.uploader || null,
      viewCount: r.view_count || null,
      thumbnailUrl: r.thumbnail_url || null,
      publishedAt: r.published_at || null,
    }));
    
    const videoCreated = await prisma.ddgVideoResult.createMany({
      data: videoData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${videoCreated.count} video results`);
  }
  
  // Save image results
  if (result.image_results.length > 0) {
    const imageData = result.image_results.map(r => ({
      researchJobId,
      query: r.query,
      title: r.title,
      imageUrl: r.image_url,
      thumbnailUrl: r.thumbnail_url || null,
      sourceUrl: r.source_url,
      width: r.width || null,
      height: r.height || null,
    }));
    
    const imageCreated = await prisma.ddgImageResult.createMany({
      data: imageData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${imageCreated.count} image results`);
  }
  
  console.log(`[DDGSearch] All results saved to DB`);
}

// Interfaces for scrape_social_content results
export interface ScrapedSocialImage {
  platform: string;
  handle: string;
  image_url: string;
  thumbnail_url: string;
  source_url: string;
  title: string;
  width: number | null;
  height: number | null;
}

export interface ScrapedSocialVideo {
  platform: string;
  handle: string;
  video_url: string;
  embed_url: string;
  thumbnail_url: string;
  title: string;
  description: string;
  duration: string;
  publisher: string;
}

export interface ScrapedSocialPost {
  platform: string;
  handle: string;
  caption_snippet: string;
  source_url: string;
  has_media: boolean;
  is_video?: boolean;
}

export interface ScrapeSocialContentResult {
  handles: Record<string, string>;
  images: ScrapedSocialImage[];
  videos: ScrapedSocialVideo[];
  posts: ScrapedSocialPost[];
  platforms_searched: string[];
  totals: {
    images: number;
    videos: number;
    posts: number;
    platforms: number;
  };
  error?: string;
}

/**
 * Scrape images and videos for social handles using site-limited search
 * This is the workaround for direct API access when rate-limited
 * 
 * IMPORTANT: This is the ONLY source for media alongside authenticated Instagram
 */
export async function scrapeSocialContent(
  handles: Record<string, string>,
  maxItems: number = 30,
  researchJobId?: string
): Promise<ScrapeSocialContentResult> {
  // Build args string like: instagram:handle tiktok:handle
  const handleArgs = Object.entries(handles)
    .filter(([_, handle]) => handle)
    .map(([platform, handle]) => `${platform}:${handle}`)
    .join(' ');
  
  if (!handleArgs) {
    return {
      handles: {},
      images: [],
      videos: [],
      posts: [],
      platforms_searched: [],
      totals: { images: 0, videos: 0, posts: 0, platforms: 0 },
      error: 'No handles provided',
    };
  }
  
  console.log(`[DDGSearch] Scraping social content: ${handleArgs} (max ${maxItems})`);
  
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/ddg_search.py');
    
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} scrape_content ${handleArgs} ${maxItems}`,
      {
        cwd: process.cwd(),
        timeout: 180000, // 3 min timeout
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    
    if (stderr) {
      console.log(`[DDGSearch] ${stderr}`);
    }
    
    const result: ScrapeSocialContentResult = JSON.parse(stdout);
    
    console.log(`[DDGSearch] Scraped: ${result.totals.images} images, ${result.totals.videos} videos from ${result.platforms_searched.join(', ')}`);
    
    // Save to DB if researchJobId provided
    if (researchJobId) {
      await saveSocialContentToDB(researchJobId, result);
    }
    
    return result;
    
  } catch (error: any) {
    console.error(`[DDGSearch] Social content scrape failed:`, error.message);
    return {
      handles,
      images: [],
      videos: [],
      posts: [],
      platforms_searched: [],
      totals: { images: 0, videos: 0, posts: 0, platforms: 0 },
      error: error.message,
    };
  }
}

/**
 * Save scraped social content to DB
 * Marks source as 'site_limited_social' to distinguish from generic DDG
 */
async function saveSocialContentToDB(
  researchJobId: string,
  result: ScrapeSocialContentResult
): Promise<void> {
  console.log(`[DDGSearch] Saving ${result.totals.images} images and ${result.totals.videos} videos to DB...`);
  
  // Save images
  if (result.images.length > 0) {
    const imageData = result.images.map(img => ({
      researchJobId,
      query: `site:${img.platform}.com @${img.handle}`, // Reconstruct query for consistency
      title: img.title,
      imageUrl: img.image_url,
      thumbnailUrl: img.thumbnail_url,
      sourceUrl: img.source_url,
      width: img.width,
      height: img.height,
    }));
    
    const created = await prisma.ddgImageResult.createMany({
      data: imageData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${created.count} social images`);
  }
  
  // Save videos
  if (result.videos.length > 0) {
    const videoData = result.videos.map(vid => ({
      researchJobId,
      query: `site:${vid.platform}.com @${vid.handle}`,
      title: vid.title,
      description: vid.description,
      url: vid.video_url,
      embedUrl: vid.embed_url,
      duration: vid.duration,
      publisher: vid.publisher,
      thumbnailUrl: vid.thumbnail_url,
    }));
    
    const created = await prisma.ddgVideoResult.createMany({
      data: videoData,
      skipDuplicates: true,
    });
    console.log(`[DDGSearch] Saved ${created.count} social videos`);
  }
}

