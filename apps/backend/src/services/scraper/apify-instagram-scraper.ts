/**
 * Apify Instagram API Scraper
 * 
 * Uses Apify's commercial Instagram scraper as the primary data source.
 * Provides the most reliable and complete data including accurate post metrics.
 */

import axios from 'axios';

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'apify~instagram-api-scraper';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

export interface ApifyInstagramPost {
  id: string;
  shortCode: string;
  caption?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  displayUrl?: string;
  videoUrl?: string;
  type?: string;
  url?: string;
}

export interface ApifyInstagramProfile {
  username: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  verified?: boolean;
  private?: boolean;
  profilePicUrl?: string;
  posts?: ApifyInstagramPost[];
}

export interface ApifyScrapeResult {
  success: boolean;
  data?: any;
  error?: string;
  scraper_used: string;
}

/**
 * Scrape Instagram profile using Apify API
 */
export async function scrapeWithApify(
  username: string,
  postsLimit: number = 30
): Promise<ApifyScrapeResult> {
  if (!APIFY_API_TOKEN) {
    console.warn('[Apify] API token not configured, skipping');
    return {
      success: false,
      error: 'Apify API token not configured',
      scraper_used: 'apify'
    };
  }

  const cleanUsername = username.replace('@', '');
  
  console.log(`[Apify] Scraping @${cleanUsername} with limit ${postsLimit}`);

  try {
    // Use synchronous endpoint to get results immediately
    const endpoint = `${APIFY_BASE_URL}/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;
    
    // Apify expects full URLs, not just usernames
    const profileUrl = `https://www.instagram.com/${cleanUsername}/`;
    const requestConfig = {
      params: {
        token: APIFY_API_TOKEN
      },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 2 minute timeout for actor to run
    };
    
    const input = {
      directUrls: [profileUrl], // Array of Instagram URLs to scrape
      resultsType: 'posts', // What to scrape: posts, details, or comments
      resultsLimit: Math.max(postsLimit, 50), // At least 50 per call (cost is per run)
      additionalFields: ['images', 'displayResources', 'carouselItems', 'childPosts'],
      // Use Apify's residential proxies for better reliability
      proxy: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL']
      }
    };

    console.log('[Apify] Sending input:', JSON.stringify(input, null, 2));

    const response = await axios.post(endpoint, input, requestConfig);

    const items = response.data;

    console.log('[Apify] Raw API response items:', JSON.stringify(items, null, 2).substring(0, 1500));

    if (!items || items.length === 0) {
      console.warn('[Apify] No data returned from scraper');
      return {
        success: false,
        error: 'No data returned',
        scraper_used: 'apify'
      };
    }

    // Check if the first item is an error
    const firstItem = items[0];
    if (firstItem.error) {
      console.warn(`[Apify] API returned error: ${firstItem.error} - ${firstItem.errorDescription}`);
      return {
        success: false,
        error: `Apify error: ${firstItem.errorDescription || firstItem.error}`,
        scraper_used: 'apify'
      };
    }

    // Apify returns an array of posts directly (not a profile object)
    // We need to extract profile info from the posts themselves (owner data)
    const posts = items;
    let details: any = null;
    
    console.log(`[Apify] ✓ Scraped ${posts.length} posts`);

    if (posts.length === 0) {
      return {
        success: false,
        error: 'No posts returned from Apify',
        scraper_used: 'apify'
      };
    }

    // Extract owner info from first post for auxiliary metadata only.
    // Important: keep the requested handle as source of truth to avoid
    // accidental handle drift on collaborative/reposted posts.
    const ownerData = posts[0].ownerUsername ? {
      username: posts[0].ownerUsername,
      fullName: posts[0].ownerFullName,
      profilePicUrl: posts[0].ownerProfilePicUrl
    } : null;

    if (ownerData?.username && ownerData.username.toLowerCase() !== cleanUsername.toLowerCase()) {
      console.warn(
        `[Apify] Owner username @${ownerData.username} differs from requested @${cleanUsername}; preserving requested handle`
      );
    }

    // Second call: profile details (followersCount, followsCount, etc.) for follower count and bio
    try {
      const detailsInput = {
        directUrls: [profileUrl],
        resultsType: 'details',
        resultsLimit: 1,
        proxy: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL']
        }
      };
      const detailsResponse = await axios.post(endpoint, detailsInput, requestConfig);
      const detailItems = Array.isArray(detailsResponse.data) ? detailsResponse.data : [];
      const firstDetail = detailItems[0];
      if (firstDetail && !firstDetail.error) {
        details = firstDetail;
      } else {
        console.warn('[Apify] Profile details call returned no usable record');
      }
    } catch (detailsError: any) {
      console.warn(`[Apify] Failed to fetch profile details: ${detailsError.message}`);
    }

    // Map to our existing data structure
    const mappedData = {
      handle: cleanUsername,
      follower_count: Number(details?.followersCount || 0),
      following_count: Number(details?.followsCount || 0),
      bio: details?.biography || '',
      profile_pic: details?.profilePicUrlHD || details?.profilePicUrl || ownerData?.profilePicUrl || '',
      is_verified: Boolean(details?.verified),
      is_private: Boolean(details?.private),
      total_posts: Number(details?.postsCount || posts.length),
      posts: posts.map((post: any) => {
        const mediaUrls: string[] = [];
        const push = (u?: string) => { if (u) mediaUrls.push(u); };

        push(post.displayUrl);
        push(post.videoUrl);
        if (Array.isArray(post.images)) mediaUrls.push(...post.images);
        if (Array.isArray(post.displayResources)) {
          post.displayResources.forEach((r: any) => push(r?.src || r?.url));
        }
        if (Array.isArray(post.carouselItems)) {
          post.carouselItems.forEach((c: any) => {
            push(c.displayUrl);
            push(c.videoUrl);
            if (Array.isArray(c.displayResources)) {
              c.displayResources.forEach((r: any) => push(r?.src || r?.url));
            }
          });
        }
        // Apify sidecar children
        if (Array.isArray(post.childPosts)) {
          post.childPosts.forEach((c: any) => {
            push(c.displayUrl);
            push(c.videoUrl);
            if (Array.isArray(c.images)) mediaUrls.push(...c.images);
            if (Array.isArray(c.displayResources)) {
              c.displayResources.forEach((r: any) => push(r?.src || r?.url));
            }
          });
        }

        const primary = mediaUrls[0] || post.displayUrl || post.videoUrl || '';

        return {
          external_post_id: post.id,
          post_url: post.url || `https://www.instagram.com/p/${post.shortCode}/`,
          caption: post.caption || '',
          likes: post.likesCount || 0,
          comments: post.commentsCount || 0,
          timestamp: post.timestamp || new Date().toISOString(),
          media_url: primary,
          is_video: post.type === 'Video',
          video_url: post.videoUrl || null,
          typename: post.type || 'GraphImage',
          media_urls: mediaUrls.filter(Boolean),
        };
      }),
      discovered_competitors: [] // Apify doesn't provide this
    };

    return {
      success: true,
      data: mappedData,
      scraper_used: 'apify'
    };

  } catch (error: any) {
    console.error('[Apify] Scraping failed:', error.message);
    
    // Check for specific errors
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.error?.message || error.message;
      
      if (status === 401) {
        return {
          success: false,
          error: 'Invalid Apify API token',
          scraper_used: 'apify'
        };
      }
      
      if (status === 429) {
        return {
          success: false,
          error: 'Apify rate limit exceeded',
          scraper_used: 'apify'
        };
      }

      return {
        success: false,
        error: `Apify API error (${status}): ${message}`,
        scraper_used: 'apify'
      };
    }

    return {
      success: false,
      error: error.message || 'Unknown Apify error',
      scraper_used: 'apify'
    };
  }
}
