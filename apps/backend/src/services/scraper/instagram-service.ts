import { exec } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import path from 'path';
import { createGraphQLScraper } from './instagram-graphql';
import axios from 'axios';
import { extractCsrf } from './instagram-cookie';

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
  media_urls?: string[];
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
  scraper_used?: 'apify' | 'camoufox' | 'graphql' | 'python' | 'puppeteer' | 'web_profile';
}

/** Returns true when profile metadata is missing or zero (needs GraphQL enrichment). */
function isProfileMetadataIncomplete(data: InstagramProfileData): boolean {
  const missingFollower = data.follower_count == null || data.follower_count === 0;
  const missingFollowing = data.following_count == null || data.following_count === 0;
  const missingBio = data.bio == null || String(data.bio).trim() === '';
  const missingTotalPosts = data.total_posts == null || data.total_posts === 0;
  return missingFollower || missingFollowing || missingBio || missingTotalPosts;
}

/** Enrich profile data with GraphQL when follower count, bio, etc. are missing. Mutates and returns data. */
async function enrichProfileMetadataIfNeeded(
  cleanHandle: string,
  data: InstagramProfileData
): Promise<InstagramProfileData> {
  if (!isProfileMetadataIncomplete(data)) return data;
  try {
    const graphqlScraper = createGraphQLScraper();
    const profile = await graphqlScraper.scrapeProfile(cleanHandle);
    data.follower_count = profile.follower_count ?? data.follower_count ?? 0;
    data.following_count = profile.following_count ?? data.following_count ?? 0;
    data.bio = (profile.biography ?? data.bio ?? '').trim() || data.bio || '';
    data.is_verified = profile.is_verified ?? data.is_verified;
    data.is_private = profile.is_private ?? data.is_private;
    data.profile_pic = profile.profile_pic_url || data.profile_pic || '';
    data.total_posts = profile.edge_owner_to_timeline_media?.count ?? data.total_posts ?? 0;
    console.log('[Instagram] ✓ Enriched with GraphQL profile stats');
  } catch (err: any) {
    console.warn('[Instagram] GraphQL enrichment failed:', err?.message);
  }
  return data;
}

// Web profile scraper using /api/v1/users/web_profile_info
async function scrapeViaWebProfile(username: string, postsLimit: number): Promise<InstagramProfileData | null> {
  const cookie = process.env.INSTAGRAM_SESSION_COOKIES || process.env.INSTAGRAM_SESSION_COOKIE;
  if (!cookie) throw new Error('No Instagram session cookies configured');
  const csrf = extractCsrf(cookie);

  const client = axios.create({
    baseURL: 'https://www.instagram.com',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-CSRFToken': csrf || '',
      'Cookie': cookie,
    },
    withCredentials: true,
    timeout: 30000,
  });

  const url = `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const res = await client.get(url);
  const user = res.data?.data?.user;
  if (!user) throw new Error('web_profile_info response missing user');

  const edges = user.edge_owner_to_timeline_media?.edges || [];
  const posts = edges.slice(0, postsLimit).map((e: any) => {
    const n = e.node;
    const isVideo = n.is_video;
    const mediaUrls: string[] = [];
    if (n.display_url) mediaUrls.push(n.display_url);
    if (n.video_url) mediaUrls.push(n.video_url);
    if (n.edge_sidecar_to_children?.edges) {
      n.edge_sidecar_to_children.edges.forEach((c: any) => {
        if (c.node.display_url) mediaUrls.push(c.node.display_url);
        if (c.node.video_url) mediaUrls.push(c.node.video_url);
      });
    }
    return {
      external_post_id: n.id,
      post_url: `https://www.instagram.com/p/${n.shortcode}/`,
      caption: n.edge_media_to_caption?.edges?.[0]?.node?.text || '',
      likes: n.edge_media_preview_like?.count || 0,
      comments: n.edge_media_to_comment?.count || 0,
      timestamp: new Date(n.taken_at_timestamp * 1000).toISOString(),
      media_url: n.display_url,
      is_video: isVideo,
      video_url: n.video_url || null,
      typename: n.__typename || (isVideo ? 'GraphVideo' : 'GraphImage'),
      media_urls: mediaUrls,
    } as InstagramPost;
  });

  const profileData: InstagramProfileData = {
    handle: user.username,
    follower_count: user.edge_followed_by?.count || 0,
    following_count: user.edge_follow?.count || 0,
    bio: user.biography || '',
    profile_pic: user.profile_pic_url_hd || user.profile_pic_url || '',
    is_verified: user.is_verified || false,
    is_private: user.is_private || false,
    total_posts: user.edge_owner_to_timeline_media?.count || posts.length,
    posts,
    discovered_competitors: []
  };
  return profileData;
}

/**
 * Scrape Instagram profile using multi-layer strategy
 * Layer 0: Apify API (primary) - most reliable with accurate post metrics
 * Layer 1: GraphQL API (secondary) - fast but may hit rate limits
 * Layer 2: Python Instaloader (tertiary) - with OASP powers
 * Layer 3: Puppeteer (fallback) - last resort
 */
export async function scrapeInstagramProfile(
  handle: string,
  postsLimit: number = 30,
  proxyUrl?: string
): Promise<ScrapeResult> {
  const cleanHandle = handle.replace('@', '');

  // Layer 0: Try Apify API first (most reliable, accurate metrics)
  try {
    console.log(`[Instagram] Attempting Apify scraper for @${cleanHandle}...`);
    
    const { scrapeWithApify } = await import('./apify-instagram-scraper');
    const result = await scrapeWithApify(cleanHandle, postsLimit);
    
    // Check if we got meaningful data with posts
    if (result.success && result.data && result.data.posts && result.data.posts.length > 0) {
      console.log(`[Instagram] ✓ Apify scraper succeeded with ${result.data.posts.length} posts`);
      await enrichProfileMetadataIfNeeded(cleanHandle, result.data);
      return {
        success: true,
        data: result.data as any,
        scraper_used: 'apify',
      };
    }
    
    // Apify succeeded but returned no posts - try next layer
    console.log('[Instagram] Apify returned no posts, trying Camoufox...');
  } catch (error: any) {
    console.log(`[Instagram] Apify scraper failed: ${error.message}, falling back to Camoufox...`);
  }

  // Layer 1: Try Camoufox (anti-detect browser fallback)
  try {
    console.log(`[Instagram] Attempting Camoufox scraper for @${cleanHandle}...`);
    const cwd = process.cwd();
    const candidates = [
      path.join(cwd, 'scripts/camoufox_instagram_scraper.py'),
      path.join(cwd, 'apps/backend/scripts/camoufox_instagram_scraper.py'),
    ];
    const resolvedPath = candidates.find((p) => existsSync(p));
    if (!resolvedPath) throw new Error('camoufox_instagram_scraper.py not found');

    const { stdout, stderr } = await execAsync(
      `python3 "${resolvedPath}" "${cleanHandle}" "${postsLimit}"`,
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024, timeout: 300000 }
    );
    if (stderr) console.log(`[Instagram/Camoufox] ${stderr}`);

    const camResult: InstagramProfileData | { error: string } = JSON.parse(stdout);
    if ('error' in camResult) throw new Error(camResult.error);

    const data = camResult as InstagramProfileData;
    if (data.posts && data.posts.length > 0) {
      console.log(`[Instagram] ✓ Camoufox scraper succeeded with ${data.posts.length} posts`);
      await enrichProfileMetadataIfNeeded(cleanHandle, data);
      return { success: true, data, scraper_used: 'camoufox' };
    }
    console.log('[Instagram] Camoufox returned no posts, trying GraphQL...');
  } catch (camoufoxError: any) {
    console.log(`[Instagram] Camoufox scraper failed: ${camoufoxError.message}, falling back to GraphQL...`);
  }

  // Layer 2: Try GraphQL API (fast, but may have rate limits)
  try {
    console.log(`[Instagram] Attempting GraphQL/web-profile scraper for @${cleanHandle}...`);
    const result = await scrapeViaWebProfile(cleanHandle, postsLimit);
    if (result && result.posts.length > 0) {
      console.log(`[Instagram] ✓ Web profile scraper succeeded with ${result.posts.length} posts`);
      return {
        success: true,
        data: result,
        scraper_used: 'web_profile'
      };
    }
    console.log('[Instagram] Web profile returned no posts, trying Python scraper...');
  } catch (error: any) {
    console.log(`[Instagram] Web/GraphQL scraper failed: ${error.message}, falling back to Python...`);
  }

  // Layer 1: Try Python Instaloader
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
    
    // CRITICAL: Check for "Partial Success" (Soft Ban)
    // If we got stats but 0 posts (and total_posts > 0), it implies we couldn't fetch posts.
    // We should fallback to Puppeteer/DDG to get at least some media.
    const profileData = result as InstagramProfileData;
    if (profileData.posts.length === 0 && profileData.total_posts > 0) {
         console.warn(`[Instagram] Partial success detected for @${cleanHandle}: Stats found but 0 posts. Likely Soft Ban. Triggering fallback.`);
         throw new Error('PARTIAL_SCRAPE_NO_POSTS');
    }

    console.log(`[Instagram] Python scraper succeeded: ${profileData.posts.length} posts scraped, ${profileData.discovered_competitors?.length || 0} competitors found.`);

    return {
      success: true,
      data: profileData,
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
  const duckduckgoSearch = await import('../discovery/duckduckgo-search');
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

  // Helper function to parse metrics from title/description
  function extractMetricsFromText(text: string): { likes: number; comments: number } {
    const likesMatch = text.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:likes?|❤️|hearts?)/i);
    const commentsMatch = text.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:comments?|💬)/i);
    
    return {
      likes: likesMatch ? parseInt(likesMatch[1].replace(/,/g, ''), 10) : 0,
      comments: commentsMatch ? parseInt(commentsMatch[1].replace(/,/g, ''), 10) : 0
    };
  }

  // Try to extract metrics from titles/descriptions
  allMedia.forEach((media: any, index) => {
    const textToSearch = `${media.title || ''} ${media.description || ''}`;
    const metrics = extractMetricsFromText(textToSearch);
    
    // Update the corresponding post with extracted metrics
    if (posts[index]) {
      posts[index].likes = metrics.likes;
      posts[index].comments = metrics.comments;
    }
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
