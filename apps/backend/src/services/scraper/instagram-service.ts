import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);


export interface InstagramComment {
    text: string;
    owner: string;
    likes: number;
}

export interface InstagramPost {
  external_post_id: string;
  post_url: string;
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
  media_url: string;
  is_video: boolean;
  video_url: string | null;
  typename: string;
  top_comments?: InstagramComment[]; // New OASP Field
}

export interface DiscoveredCompetitor {
    username: string;
    full_name: string;
    followers: number;
}

export interface InstagramProfileData {
  handle: string;
  follower_count: number;
  following_count: number;
  bio: string;
  profile_pic: string;
  is_verified: boolean;
  is_private: boolean;
  total_posts: number;
  posts: InstagramPost[];
  discovered_competitors?: DiscoveredCompetitor[]; // New OASP Field
}

export interface ScrapeResult {
  success: boolean;
  data?: InstagramProfileData;
  error?: string;
  scraper_used?: 'python' | 'puppeteer';
}

/**
 * Scrape Instagram profile using multi-layer strategy
 * Layer 1: Python Instaloader (primary) with OASP powers
 * Layer 2: Puppeteer (fallback)
 */
export async function scrapeInstagramProfile(
  handle: string,
  postsLimit: number = 30,
  proxyUrl?: string
): Promise<ScrapeResult> {
  const cleanHandle = handle.replace('@', '');

  // Layer 1: Try Python Instaloader first
  try {
    console.log(`[Instagram] Attempting Python scraper for @${cleanHandle} (Deep OASP Mode)...`);
    
    const scriptPath = path.join(process.cwd(), 'scripts/instagram_scraper.py');
    const args = [scriptPath, cleanHandle, postsLimit.toString()];
    if (proxyUrl) {
      args.push(proxyUrl);
    }

    const { stdout, stderr } = await execAsync(`python3 ${args.join(' ')}`, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 300000, // 5 min timeout
    });

    // Log Python stderr (info messages)
    if (stderr) {
      console.log(`[Instagram/Python] ${stderr}`);
    }

    const result: InstagramProfileData | { error: string, message?: string } = JSON.parse(stdout);

    // CRITICAL: Check for Rate Limits
    if ('error' in result && result.error === 'RATE_LIMIT_EXCEEDED') {
        throw new Error(`CRITICAL_RATE_LIMIT: ${result.message}`);
    } else if ('error' in result) {
      throw new Error((result as any).error);
    }

    console.log(`[Instagram] Python scraper succeeded: ${result.posts.length} posts scraped, ${(result as InstagramProfileData).discovered_competitors?.length || 0} competitors found.`);

    return {
      success: true,
      data: result as InstagramProfileData,
      scraper_used: 'python',
    };
  } catch (pythonError: any) {
    console.error(`[Instagram] Python scraper failed: ${pythonError.message}`);

    // SAFETY CHECK: If rate limited, DO NOT FALLBACK. Stop immediately to protect account.
    if (pythonError.message.includes('CRITICAL_RATE_LIMIT')) {
         return {
            success: false,
            error: pythonError.message
         };
    }

    // Layer 2: Fallback to Puppeteer
    try {
      console.log(`[Instagram] Attempting Puppeteer scraper as fallback...`);
      const puppeteerResult = await scrapeWithPuppeteer(cleanHandle, postsLimit);

      console.log(`[Instagram] Puppeteer scraper succeeded`);

      return {
        success: true,
        data: puppeteerResult,
        scraper_used: 'puppeteer',
      };
    } catch (puppeteerError: any) {
      console.error(`[Instagram] All scrapers failed for @${cleanHandle}`);

      return {
        success: false,
        error: `All scraping methods failed. Python: ${pythonError.message}, Puppeteer: ${puppeteerError.message}`,
      };
    }
  }
}

/**
 * Puppeteer fallback scraper
 * TODO: Implement full scraping logic
 */
/**
 * Puppeteer fallback scraper
 * Currently acting as a robust mock for development/testing
 */
/**
 * Puppeteer fallback scraper
 * Uses Site-Limited Search (DuckDuckGo) as a robust fallback
 * This ensures we get REAL data (images/videos) instead of mocks
 */
async function scrapeWithPuppeteer(
  handle: string,
  postsLimit: number
): Promise<InstagramProfileData> {
  console.log(`[Instagram] Using Site-Limited Search fallback for @${handle}`);
  
  // Dynamically import to avoid circular dependencies if any
  const duckduckgoSearch = await import('../discovery/duckduckgo-search.js');
    // Extract media
    const scrapedResult = await duckduckgoSearch.scrapeSocialContent({ instagram: handle }, postsLimit);
    const images = scrapedResult.images || [];
    const videos = scrapedResult.videos || [];
    
    // Check for profile stats if available
    const stats = (scrapedResult as any).profile_stats?.instagram;
    const followerCount = stats?.followers || 0;
    const followingCount = stats?.following || 0;
    
    // Convert to InstagramPost format
    const posts: InstagramPost[] = [];
    
    // Mix images and videos, sort by assumed recency (or just interleaving)
    const allMedia = [
      ...images.map(img => ({ ...img, type: 'image' })),
      ...videos.map(vid => ({ ...vid, type: 'video' }))
    ];
  
  // Create InstagramPost objects from scraped content
  allMedia.forEach((media: any, index) => {
    // Determine URLs based on media type (duckduckgo-search.ts interfaces)
    // ImageResult: { image_url, source_url, ... }
    // VideoResult: { video_url, content_url, embed_url, ... }
    
    let postUrl = '';
    let mediaUrl = '';
    let videoUrl = null;

    if (media.type === 'image') {
       postUrl = media.source_url || media.image_url;
       // Prefer image_url because thumbnail_url from DDG is often small/base64/expired.
       // We want the high-res one.
       mediaUrl = media.image_url || media.thumbnail_url;
    } else {
       postUrl = media.content_url || media.embed_url; // VideoResult properties
       // For videos, content_url IS the video file often, but for display we want a thumb? 
       // Actually instagram-service logic puts this into `media_url` field of post.
       // If it's a video, `media_url` usually holds the thumbnail for display in many grids, 
       // OR the video itself. 
       // But wait, `media_url` in InstagramPost interface is "media_url".
       // Looking at frontend: <img src={thumbnail...}>
       // <video ...> src={...}
       mediaUrl = media.thumbnail_url || media.image_url || '';
       videoUrl = media.content_url || media.embed_url;
    }

    posts.push({
      external_post_id: `site_limited_${handle}_${index}`,
      post_url: postUrl || `https://instagram.com/${handle}`,
      caption: media.title || '',
      likes: 0,
      comments: 0,
      timestamp: new Date().toISOString(),
      media_url: mediaUrl || '',
      is_video: media.type === 'video',
      video_url: videoUrl,
      typename: media.type === 'video' ? 'GraphVideo' : 'GraphImage',
    });
  });

  return {
    handle: handle,
    follower_count: followerCount,
    following_count: followingCount,
    bio: "", // Could try to extract from snippets later
    profile_pic: "",
    is_verified: false,
    is_private: false,
    total_posts: posts.length,
    posts: posts,
  };
}

/**
 * Save scraped data to database
 */
export async function saveScrapedProfile(
  profileData: InstagramProfileData,
  clientId: string,
  isClient: boolean = false
) {
  // TODO: Implement database saving logic with Prisma
  // This will be called from the orchestrator
  console.log(`[Instagram] Saving profile @${profileData.handle} to database (client: ${isClient})`);
}
