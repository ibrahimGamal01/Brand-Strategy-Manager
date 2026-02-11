/**
 * Instagram GraphQL API Scraper
 * 
 * Direct GraphQL queries to Instagram's API for reliable data retrieval.
 * Based on doc_ids extracted from Instaloader library.
 * 
 * Key advantages:
 * - Returns structured JSON with all metrics
 * - Faster than HTML parsing
 * - Most reliable for engagement data
 */

import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { extractCsrf } from './instagram-cookie';

/**
 * Instagram GraphQL Document IDs
 * These are extracted from Instaloader and may need periodic updates
 */
const DOC_IDS = {
  POST_METADATA: '8845758582119845',
  USER_PROFILE_LOGGED_IN: '7898261790222653',
  USER_PROFILE_PUBLIC: '7950326061742207',
  USER_TIMELINE: '7845543455542541',
  POST_COMMENTS: '97b41c52301f77ce508f55e66d17620e',
  POST_LIKES: '1cb6ec562846122743b61e492c85999f',
} as const;

const INSTAGRAM_APP_ID = '124024574287414';
const INSTAGRAM_BASE_URL = 'https://www.instagram.com';

// Rotate multiple session cookies to spread rate limits
function loadSessionPool(): string[] {
  const raw = process.env.INSTAGRAM_SESSION_COOKIES || process.env.INSTAGRAM_SESSION_COOKIE || '';
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export interface InstagramGraphQLOptions {
  sessionCookie?: string;
  userAgent?: string;
  useProxy?: boolean;
  proxyUrl?: string;
}

export interface InstagramProfile {
  id: string;
  username: string;
  full_name: string;
  biography: string;
  follower_count: number;
  following_count: number;
  is_verified: boolean;
  is_private?: boolean;
  profile_pic_url: string;
  edge_owner_to_timeline_media?: {
    count: number;
    edges: Array<{ node: any }>;
  };
}

export interface InstagramPost {
  id: string;
  shortcode: string;
  caption: string;
  timestamp: number;
  like_count: number;
  comment_count: number;
  is_video: boolean;
  display_url: string;
  video_url?: string;
}

export class InstagramGraphQLScraper {
  private client: AxiosInstance;
  private sessionCookie: string | null = null;
  private sessionPool: string[] = [];
  private poolIndex = 0;

  constructor(options: InstagramGraphQLOptions = {}) {
    this.sessionPool = loadSessionPool();
    this.sessionCookie = options.sessionCookie || this.pickSession();

    const csrf = extractCsrf(this.sessionCookie);

    this.client = axios.create({
      baseURL: INSTAGRAM_BASE_URL,
      headers: {
        'User-Agent': options.userAgent || this.getRandomUserAgent(),
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'X-IG-App-ID': INSTAGRAM_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
        ...(this.sessionCookie ? { 'Cookie': this.sessionCookie } : {}),
      },
      timeout: 30000,
    });

    if (options.useProxy && options.proxyUrl) {
      // TODO: Add proxy support when needed
      console.log('[GraphQL] Proxy support not yet implemented');
    }
  }

  /**
   * Pick a session cookie from pool (round-robin)
   */
  private pickSession(): string | null {
    if (this.sessionPool.length === 0) {
      return process.env.INSTAGRAM_SESSION_COOKIE || null;
    }
    const cookie = this.sessionPool[this.poolIndex % this.sessionPool.length];
    this.poolIndex++;
    return cookie || null;
  }

  private rotateSession(): string | null {
    if (this.sessionPool.length === 0) return this.sessionCookie;
    this.sessionCookie = this.pickSession();
    if (this.sessionCookie) {
      this.client.defaults.headers.common['Cookie'] = this.sessionCookie;
      const csrf = extractCsrf(this.sessionCookie);
      if (csrf) this.client.defaults.headers.common['X-CSRFToken'] = csrf;
    }
    return this.sessionCookie;
  }

  /**
   * Get a random user agent to avoid detection
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Execute a GraphQL query
   */
  private async graphqlQuery(docId: string, variables: Record<string, any>): Promise<any> {
    try {
      const params = new URLSearchParams({
        doc_id: docId,
        variables: JSON.stringify(variables),
      });

      // Use the axios client which already has headers and cookies configured
      const response = await this.client.get(`/graphql/query?${params.toString()}`);

      const data = response.data;
      
      if (data?.status === 'fail') {
        throw new Error(`Instagram API error: ${data.message || 'Unknown error'}`);
      }

      if (data?.errors && data.errors.length > 0) {
        const errorMsg = data.errors.map((e: any) => e.message).join(', ');
        throw new Error(`GraphQL execution error: ${errorMsg}`);
      }

      return data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error(`[GraphQL] Request failed with status: ${error.response?.status} ${error.response?.statusText}`);
        if (error.response?.data) {
           console.error(`[GraphQL] Response body: ${JSON.stringify(error.response.data).substring(0, 500)}`);
        }

        // Rotate session on auth/rate errors and retry once
        if (error.response?.status === 401 || error.response?.status === 429) {
          const newSession = this.rotateSession();
          if (newSession) {
            console.warn('[GraphQL] Rotating session cookie and retrying...');
            return this.graphqlQuery(docId, variables);
          }
          throw new Error('Session expired or invalid. Please provide a fresh session cookie.');
        }
      }
      throw error;
    }
  }

  /**
   * Scrape user profile information
   */
  async scrapeProfile(username: string): Promise<InstagramProfile> {
    console.log(`[GraphQL] Scraping profile: @${username}`);

    const docId = this.sessionCookie 
      ? DOC_IDS.USER_PROFILE_LOGGED_IN 
      : DOC_IDS.USER_PROFILE_PUBLIC;

    const variables = {
      username,
      render_surface: 'PROFILE',
    };

    const data = await this.graphqlQuery(docId, variables);
    
    // The response structure varies based on logged-in state
    const userData = data.data?.user || data.data?.xdt_api__v1__users__web_profile_info?.user;

    if (!userData) {
      console.error('[GraphQL] Unexpected response structure:', JSON.stringify(data, null, 2).substring(0, 1000));
      throw new Error(`Profile @${username} not found or response structure changed`);
    }

    return {
      id: userData.id,
      username: userData.username,
      full_name: userData.full_name || '',
      biography: userData.biography || '',
      follower_count: userData.edge_followed_by?.count || 0,
      following_count: userData.edge_follow?.count || 0,
      is_verified: userData.is_verified || false,
      is_private: userData.is_private || false,
      profile_pic_url: userData.profile_pic_url || '',
      edge_owner_to_timeline_media: userData.edge_owner_to_timeline_media,
    };
  }

  /**
   * Scrape user timeline posts
   */
  async scrapePosts(username: string, maxPosts: number = 12): Promise<InstagramPost[]> {
    console.log(`[GraphQL] Scraping posts for @${username}, max: ${maxPosts}`);

    // First get the profile to access timeline
    const profile = await this.scrapeProfile(username);

    if (!profile.edge_owner_to_timeline_media) {
      console.warn('[GraphQL] No timeline data in profile response');
      return [];
    }

    const posts: InstagramPost[] = [];
    const edges = profile.edge_owner_to_timeline_media.edges || [];

    for (const edge of edges.slice(0, maxPosts)) {
      const node = edge.node;
      
      posts.push({
        id: node.id,
        shortcode: node.shortcode,
        caption: this.extractCaption(node),
        timestamp: node.taken_at_timestamp,
        like_count: node.edge_media_preview_like?.count || node.edge_liked_by?.count || 0,
        comment_count: node.edge_media_to_comment?.count || 0,
        is_video: node.is_video || false,
        display_url: node.display_url || '',
        video_url: node.video_url,
      });
    }

    console.log(`[GraphQL] Scraped ${posts.length} posts`);
    return posts;
  }

  /**
   * Extract caption from node structure
   */
  private extractCaption(node: any): string {
    if (node.edge_media_to_caption?.edges?.length > 0) {
      return node.edge_media_to_caption.edges[0].node.text || '';
    }
    if (node.caption) {
      return node.caption;
    }
    return '';
  }

  /**
   * Full scrape: profile + posts
   */
  async scrapeFullProfile(username: string, maxPosts: number = 30) {
    const profile = await this.scrapeProfile(username);
    const posts = await this.scrapePosts(username, maxPosts);

    return {
      success: true,
      profile: {
        handle: profile.username,
        follower_count: profile.follower_count,
        following_count: profile.following_count,
        total_posts: profile.edge_owner_to_timeline_media?.count || 0,
        bio: profile.biography,
        is_verified: profile.is_verified,
        is_private: profile.is_private || false,
        profile_pic: profile.profile_pic_url || '',
      },
      posts: posts.map(post => ({
        external_post_id: post.id,
        post_url: `https://www.instagram.com/p/${post.shortcode}/`,
        caption: post.caption,
        timestamp: new Date(post.timestamp * 1000).toISOString(),
        likes: post.like_count,
        comments: post.comment_count,
        is_video: post.is_video,
        media_url: post.display_url,
        video_url: post.video_url,
      })),
      scraper_used: 'graphql',
    };
  }
}

/**
 * Factory function for creating scraper instance
 */
export function createGraphQLScraper(options?: InstagramGraphQLOptions): InstagramGraphQLScraper {
  return new InstagramGraphQLScraper(options);
}
