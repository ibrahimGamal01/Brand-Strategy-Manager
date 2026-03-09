/**
 * Instagram GraphQL API Scraper
 *
 * Direct GraphQL queries to Instagram's API for reliable data retrieval.
 * Based on doc_ids extracted from Instaloader library.
 */

import axios, { AxiosInstance } from 'axios';
import { extractCsrf } from './instagram-cookie';
import {
  acquireInstagramSession,
  getInstagramGlobalGateRemainingMs,
  getInstagramSessionPool,
  isInstagramLoginGatePayload,
  recordInstagramSessionFailure,
  recordInstagramSessionSuccess,
} from './instagram-session-pool';
import { proxyUrlToAxiosConfig } from '../network/proxy-rotation';

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
const GRAPHQL_MAX_AUTH_RETRIES = Math.max(0, Number(process.env.INSTAGRAM_GRAPHQL_MAX_AUTH_RETRIES || 3));
const GRAPHQL_RETRY_BASE_DELAY_MS = Math.max(250, Number(process.env.INSTAGRAM_GRAPHQL_RETRY_BASE_DELAY_MS || 750));
const GRAPHQL_RETRY_MAX_DELAY_MS = Math.max(
  GRAPHQL_RETRY_BASE_DELAY_MS,
  Number(process.env.INSTAGRAM_GRAPHQL_RETRY_MAX_DELAY_MS || 5000)
);

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
  private activeSessionId: string | null = null;
  private readonly fixedSessionCookie: string | null = null;

  constructor(options: InstagramGraphQLOptions = {}) {
    this.fixedSessionCookie = options.sessionCookie?.trim() || null;
    const csrf = extractCsrf(this.fixedSessionCookie);
    const shouldUseProxy = Boolean(options.useProxy && options.proxyUrl);
    const proxyConfig = shouldUseProxy ? proxyUrlToAxiosConfig(options.proxyUrl || null) : null;
    if (shouldUseProxy && !proxyConfig) {
      throw new Error('Unsupported proxy protocol for Instagram GraphQL client');
    }

    this.client = axios.create({
      baseURL: INSTAGRAM_BASE_URL,
      headers: {
        'User-Agent': options.userAgent || this.getRandomUserAgent(),
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'X-IG-App-ID': INSTAGRAM_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.instagram.com/',
        Origin: 'https://www.instagram.com',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
        ...(this.fixedSessionCookie ? { Cookie: this.fixedSessionCookie } : {}),
      },
      timeout: 30_000,
      proxy: proxyConfig ?? false,
    });

    if (this.fixedSessionCookie) {
      this.applySessionCookie(this.fixedSessionCookie, null);
    } else {
      this.assignNextSession(new Set<string>());
    }

  }

  private applySessionCookie(cookie: string | null, sessionId: string | null): void {
    this.sessionCookie = cookie;
    this.activeSessionId = sessionId;

    if (cookie) {
      this.client.defaults.headers.common.Cookie = cookie;
      const csrf = extractCsrf(cookie);
      if (csrf) this.client.defaults.headers.common['X-CSRFToken'] = csrf;
      else delete this.client.defaults.headers.common['X-CSRFToken'];
      return;
    }

    delete this.client.defaults.headers.common.Cookie;
    delete this.client.defaults.headers.common['X-CSRFToken'];
  }

  private assignNextSession(excludedSessionIds: Set<string>): boolean {
    if (this.fixedSessionCookie) {
      this.applySessionCookie(this.fixedSessionCookie, null);
      return true;
    }

    const session = acquireInstagramSession({ excludeSessionIds: excludedSessionIds });
    if (!session) {
      this.applySessionCookie(null, null);
      return false;
    }

    this.applySessionCookie(session.cookie, session.id);
    return true;
  }

  private ensureInitialSession(): void {
    if (this.fixedSessionCookie || this.sessionCookie) {
      return;
    }
    this.assignNextSession(new Set<string>());
  }

  private getRetryDelayMs(attempt: number): number {
    const exp = Math.min(
      GRAPHQL_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)),
      GRAPHQL_RETRY_MAX_DELAY_MS
    );
    const jitter = Math.floor(Math.random() * 200);
    return exp + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private makeLoginGateError(retryInMs: number): Error {
    const err: any = new Error(
      `INSTAGRAM_LOGIN_GATE_ACTIVE: Instagram GraphQL temporarily blocked. Retry in ${Math.ceil(
        retryInMs / 1000
      )}s.`
    );
    err.code = 'INSTAGRAM_LOGIN_GATE_ACTIVE';
    err.retryInMs = retryInMs;
    return err;
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  private async graphqlQuery(docId: string, variables: Record<string, any>): Promise<any> {
    const gateState = isInstagramGraphQLTemporarilyBlocked();
    if (gateState.blocked) {
      throw this.makeLoginGateError(gateState.retryInMs);
    }

    const attemptedSessionIds = new Set<string>();
    let attempt = 0;

    while (attempt <= GRAPHQL_MAX_AUTH_RETRIES) {
      if (this.activeSessionId) {
        attemptedSessionIds.add(this.activeSessionId);
      } else if (!this.fixedSessionCookie && getInstagramSessionPool().hasAnySessions()) {
        const assigned = this.assignNextSession(attemptedSessionIds);
        if (assigned && this.activeSessionId) {
          attemptedSessionIds.add(this.activeSessionId);
        }
      }

      try {
        const params = new URLSearchParams({
          doc_id: docId,
          variables: JSON.stringify(variables),
        });
        const response = await this.client.get(`/graphql/query?${params.toString()}`);
        const data = response.data;

        if (data?.status === 'fail') {
          throw new Error(`Instagram API error: ${data.message || 'Unknown error'}`);
        }

        if (data?.errors && data.errors.length > 0) {
          const errorMsg = data.errors.map((entry: any) => entry.message).join(', ');
          throw new Error(`GraphQL execution error: ${errorMsg}`);
        }

        if (this.activeSessionId) {
          recordInstagramSessionSuccess(this.activeSessionId);
        }
        return data;
      } catch (error: any) {
        if (!axios.isAxiosError(error)) {
          throw error;
        }

        const status = error.response?.status;
        const responseBody = error.response?.data;
        console.error(`[GraphQL] Request failed with status: ${status} ${error.response?.statusText}`);
        if (responseBody) {
          console.error(`[GraphQL] Response body: ${JSON.stringify(responseBody).substring(0, 500)}`);
        }

        const retryableAuthError = status === 401 || status === 403 || status === 429;
        if (!retryableAuthError) {
          throw error;
        }

        const loginGate = isInstagramLoginGatePayload(responseBody);
        if (this.activeSessionId) {
          recordInstagramSessionFailure(
            this.activeSessionId,
            loginGate ? 'LOGIN_GATE' : status === 429 ? 'RATE_429' : 'AUTH_401'
          );
        }

        if (loginGate) {
          const retryInMs = getInstagramGlobalGateRemainingMs();
          throw this.makeLoginGateError(retryInMs || 60_000);
        }

        if (attempt >= GRAPHQL_MAX_AUTH_RETRIES) {
          throw new Error(`Instagram GraphQL request failed after ${attempt + 1} attempts (status ${status || 'unknown'}).`);
        }

        if (this.fixedSessionCookie) {
          throw new Error(`Instagram GraphQL fixed session cookie failed with status ${status || 'unknown'}.`);
        }

        attempt += 1;
        const rotated = this.assignNextSession(attemptedSessionIds);
        if (!rotated || !this.activeSessionId) {
          throw new Error('Instagram GraphQL session pool has no healthy sessions available.');
        }

        const delayMs = this.getRetryDelayMs(attempt);
        console.warn(`[GraphQL] Rotating session cookie and retrying (${attempt}/${GRAPHQL_MAX_AUTH_RETRIES}) after ${delayMs}ms...`);
        await this.sleep(delayMs);
      }
    }

    throw new Error('Instagram GraphQL request failed unexpectedly.');
  }

  async scrapeProfile(username: string): Promise<InstagramProfile> {
    console.log(`[GraphQL] Scraping profile: @${username}`);
    this.ensureInitialSession();

    const docId = this.sessionCookie ? DOC_IDS.USER_PROFILE_LOGGED_IN : DOC_IDS.USER_PROFILE_PUBLIC;
    const variables = {
      username,
      render_surface: 'PROFILE',
    };

    const data = await this.graphqlQuery(docId, variables);
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

  async scrapePosts(username: string, maxPosts: number = 12): Promise<InstagramPost[]> {
    console.log(`[GraphQL] Scraping posts for @${username}, max: ${maxPosts}`);
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

  private extractCaption(node: any): string {
    if (node.edge_media_to_caption?.edges?.length > 0) {
      return node.edge_media_to_caption.edges[0].node.text || '';
    }
    if (node.caption) {
      return node.caption;
    }
    return '';
  }

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
      posts: posts.map((post) => ({
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

export function createGraphQLScraper(options?: InstagramGraphQLOptions): InstagramGraphQLScraper {
  return new InstagramGraphQLScraper(options);
}

export function isInstagramGraphQLTemporarilyBlocked(): { blocked: boolean; retryInMs: number } {
  const retryInMs = getInstagramGlobalGateRemainingMs();
  return {
    blocked: retryInMs > 0,
    retryInMs,
  };
}
