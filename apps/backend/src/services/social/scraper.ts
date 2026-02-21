/**
 * Social Scraper Service (Incremental & Meta-Rich)
 * 
 * Capability:
 * 1. Scrapes social profiles (Instagram, TikTok, etc.)
 * 2. INCREMENTAL: Checks lastPostId and only scrapes new posts
 * 3. META-RICH: Captures likes, views, shares, engagement rate
 * 4. TRENDS: Extracts hashtags and trends from posts
 */

import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { mediaDownloader } from '../media/downloader';
import { downloadSnapshotMedia } from '../media/downloader';
import { calculatePostRankings } from '../scrapers/post-ranking-service';
import { emitResearchJobEvent } from './research-job-events';

const prisma = new PrismaClient();
const execAsync = promisify(exec);

export interface ScrapedPost {
  externalId: string;
  url: string;
  type: string; // image, video, carousel
  caption: string;
  hashtags: string[];
  mentions: string[];
  thumbnailUrl?: string;
  mediaUrls?: string[];
  
  // Metrics
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  playsCount: number;
  duration: number; // seconds
  
  postedAt: string; // ISO date string
}

export interface ScrapedProfile {
  handle: string;
  platform: string;
  url: string;
  followers: number;
  following: number;
  postsCount: number;
  bio: string;
  website: string;
  isVerified: boolean;
  posts: ScrapedPost[];
  discoveredCompetitors?: Array<{ // New field
    username: string;
    full_name: string;
    followers: number;
  }>;
}

export interface ScrapeExecutionContext {
  runId?: string;
  source?: string;
  entityType?: string;
  entityId?: string;
}

// Concurrency Control
class ScraperLockManager {
  private locks: Set<string> = new Set();

  getLockId(platform: string, handle: string): string {
    return `${platform}:${handle}`;
  }

  tryAcquire(platform: string, handle: string): boolean {
    const id = this.getLockId(platform, handle);
    if (this.locks.has(id)) return false;
    this.locks.add(id);
    return true;
  }

  release(platform: string, handle: string): void {
    const id = this.getLockId(platform, handle);
    this.locks.delete(id);
  }
  
  isLocked(platform: string, handle: string): boolean {
      return this.locks.has(this.getLockId(platform, handle));
  }
}

export const scraperLock = new ScraperLockManager();

/**
 * Robust wrapper for scraping that handles errors and concurrency
 */
export async function scrapeProfileSafe(
    researchJobId: string, 
    platform: string, 
    handle: string,
    context: ScrapeExecutionContext = {}
) {
    // 1. Concurrency Check
    if (!scraperLock.tryAcquire(platform, handle)) {
        console.warn(`[SocialScraper] Skipped: ${platform} @${handle} is already being scraped.`);
        return { success: false, error: 'Scrape already in progress for this profile' };
    }

    const start = Date.now();
    try {
        console.log(`[SocialScraper] Starting safe scrape: ${platform} @${handle}`);
        
        // 2. Execute Core Logic
        const result = await scrapeProfileIncrementally(researchJobId, platform, handle, undefined, context);
        
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[SocialScraper] Completed ${platform} @${handle} in ${duration}s`);
        
        return { success: true, data: result };

    } catch (error: any) {
        console.error(`[SocialScraper] CRITICAL FAILURE for ${platform} @${handle}:`, error);
        return { success: false, error: error.message || 'Unknown critical error' };
    } finally {
        // 3. Always Release Lock
        scraperLock.release(platform, handle);
    }
}

/**
 * Scrape a social profile incrementally
 * Checks DB for last scraped post and stops when reached
 */
export async function scrapeProfileIncrementally(
  researchJobId: string,
  platform: string,
  handle: string,
  postsLimit: number = parseInt(process.env.SOCIAL_SCRAPE_POST_LIMIT || '4', 10),
  context: ScrapeExecutionContext = {}
): Promise<ScrapedProfile | null> {
  console.log(`[SocialScraper] Starting incremental scrape for @${handle} on ${platform}`);

  emitResearchJobEvent({
    researchJobId,
    runId: context.runId,
    source: 'scraper',
    code: 'scrape.started',
    level: 'info',
    message: `Started ${platform} scrape for @${handle}`,
    platform,
    handle,
    entityType: context.entityType,
    entityId: context.entityId,
    metrics: {
      postsLimit,
    },
    metadata: {
      source: context.source || 'manual',
    },
  });
  
  // 1. Get existing profile state to find checkpoint
  const existingProfile = await prisma.socialProfile.findUnique({
    where: {
      researchJobId_platform_handle: {
        researchJobId,
        platform,
        handle,
      },
    },
  });
  
  const lastPostId = existingProfile?.lastPostId;
  console.log(`[SocialScraper] Checkpoint: ${lastPostId ? `Last post ${lastPostId}` : 'None (Full scrape)'}`);

  emitResearchJobEvent({
    researchJobId,
    runId: context.runId,
    source: 'scraper',
    code: 'scrape.checkpoint',
    level: 'info',
    message: lastPostId
      ? `Resuming ${platform} @${handle} from checkpoint ${lastPostId}`
      : `No checkpoint for ${platform} @${handle}; running full pass`,
    platform,
    handle,
    entityType: context.entityType,
    entityId: context.entityId,
    metrics: {
      hasCheckpoint: Boolean(lastPostId),
    },
    metadata: lastPostId ? { lastPostId } : null,
  });
  
  // 2. Run platform-specific scraper
  try {
    let scrapedData: ScrapedProfile | null = null;
    
    if (platform === 'instagram') {
      // Instagram: default 50 (Apify cost is per run, not per post). Override with INSTAGRAM_POST_LIMIT.
      const instagramPostsLimit = Math.max(
        1,
        parseInt(String(process.env.INSTAGRAM_POST_LIMIT || 50), 10) || 50
      );
      const { scrapeInstagramProfile } = await import('../scraper/instagram-service');
      const result = await scrapeInstagramProfile(handle, instagramPostsLimit);
      
      if (result.success && result.data) {
        scrapedData = {
          handle: result.data.handle,
          platform: 'instagram',
          url: `https://instagram.com/${result.data.handle}`,
          followers: result.data.follower_count,
          following: result.data.following_count,
          postsCount: result.data.total_posts,
          bio: result.data.bio,
          website: '',
          isVerified: result.data.is_verified,
          posts: result.data.posts.map(p => {
            const mediaUrls = (p as any).media_urls || [];
            const thumb = (p as any).media_url || (p as any).video_url || mediaUrls[0];
            return {
              externalId: p.external_post_id,
              url: p.post_url,
              type: p.is_video ? 'video' : 'image',
              caption: p.caption,
              hashtags: extractHashtags(p.caption),
              mentions: extractMentions(p.caption),
              thumbnailUrl: thumb,
              likesCount: p.likes,
              commentsCount: p.comments,
              sharesCount: 0,
              viewsCount: 0,
              playsCount: 0,
              duration: 0,
              postedAt: p.timestamp,
              mediaUrls,
            };
          }),
          discoveredCompetitors: result.data.discovered_competitors, // Pass discovered competitors
        };
        console.log(`[SocialScraper] Instagram scraper used: ${result.scraper_used}`);

        if (String(result.scraper_used || '').includes('apify')) {
          emitResearchJobEvent({
            researchJobId,
            runId: context.runId,
            source: 'scraper',
            code: 'scrape.apify.used',
            level: 'info',
            message: `Apify scraper used for @${handle}`,
            platform,
            handle,
            entityType: context.entityType,
            entityId: context.entityId,
            metadata: {
              scraperUsed: result.scraper_used,
            },
          });
        }
      } else {
        console.warn(`[SocialScraper] Instagram scrape failed: ${result.error}`);
        return null;
      }
    } else if (platform === 'tiktok') {
      // Use the tiktok-service
      const { tiktokService } = await import('../scraper/tiktok-service');
      const result = await tiktokService.scrapeProfile(handle, postsLimit);
      
      if (result.success && result.profile) {
        scrapedData = {
          handle: result.profile.handle,
          platform: 'tiktok',
          url: result.profile.profile_url,
          followers: result.profile.follower_count || 0,
          following: 0,
          postsCount: result.total_videos || 0,
          bio: '',
          website: '',
          isVerified: false,
          posts: (result.videos || []).map(v => {
            const mediaUrls = [
              v.url,
              (v as any).play_url,
              (v as any).download_url,
            ].filter(Boolean);
            const thumb = (v as any).thumbnail || (v as any).cover || (v as any).origin_cover;
            return {
              externalId: v.video_id,
              url: v.url,
              type: 'video',
              caption: v.description || v.title,
              hashtags: extractHashtags(v.description || ''),
              mentions: [],
              thumbnailUrl: thumb || mediaUrls[0],
              likesCount: v.like_count || 0,
              commentsCount: v.comment_count || 0,
              sharesCount: v.share_count || 0,
              viewsCount: v.view_count || 0,
              playsCount: v.view_count || 0,
              duration: v.duration || 0,
              postedAt: v.upload_date || new Date().toISOString(),
              mediaUrls,
            };
          }),
        };
      } else {
        console.warn(`[SocialScraper] TikTok scrape failed: ${result.error}`);
        return null;
      }
    } else {
      console.warn(`[SocialScraper] Unsupported platform: ${platform}`);
      return null;
    }
    
    if (!scrapedData) return null;
    
    // Filter out posts we've already seen (if we have a checkpoint)
    if (lastPostId && scrapedData.posts.length > 0) {
      const lastIdx = scrapedData.posts.findIndex(p => p.externalId === lastPostId);
      if (lastIdx > 0) {
        scrapedData.posts = scrapedData.posts.slice(0, lastIdx);
        console.log(`[SocialScraper] Filtered to ${scrapedData.posts.length} new posts (checkpoint hit)`);
      }
    }
    
    console.log(`[SocialScraper] Scraped ${scrapedData.posts.length} posts for @${handle}`);
    
    // 3. Save Profile & Posts to DB (Transactional)
    const savedProfile = await saveScrapedData(researchJobId, scrapedData);

    emitResearchJobEvent({
      researchJobId,
      runId: context.runId,
      source: 'scraper',
      code: 'scrape.saved',
      level: 'info',
      message: `Saved @${handle} with ${scrapedData.posts.length} posts`,
      platform,
      handle,
      entityType: context.entityType,
      entityId: context.entityId || savedProfile?.id || null,
      metrics: {
        postsScraped: scrapedData.posts.length,
        followers: scrapedData.followers,
        profilePostsCount: scrapedData.postsCount,
      },
      metadata: {
        source: context.source || 'manual',
      },
    });

    // 4. Trigger Media Download (Robust/Grep mode)
    if (savedProfile && scrapedData.posts.length > 0) {
        // Bound media download scope to the newest scraped posts to keep scrape cycles responsive.
        const recentPostLimit = Math.max(scrapedData.posts.length, 4);
        await mediaDownloader.downloadSocialProfileMedia(savedProfile.id, {
          recentPostLimit,
          runId: context.runId,
          source: context.source,
        });
    }
    
    return scrapedData;
    
  } catch (error: any) {
    console.error(`[SocialScraper] Failed to scrape @${handle}:`, error.message);
    // Don't throw - return null so pipeline can continue
    return null;
  }
}

/**
 * Extract hashtags from caption
 */
function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w]+/g) || [];
  return matches.map(h => h.replace('#', '').toLowerCase());
}

/**
 * Extract mentions from caption
 */
function extractMentions(text: string): string[] {
  const matches = text.match(/@[\w.]+/g) || [];
  return matches.map(m => m.replace('@', '').toLowerCase());
}

/**
 * Save scraped data to DB using transaction
 * Updates profile stats and inserts/updates posts
 */
async function saveScrapedData(researchJobId: string, data: ScrapedProfile) {
  // Resolve whether this scrape is for the client or a competitor
  const context = await resolveProfileContext(researchJobId, data.platform, data.handle);

  return prisma.$transaction(async (tx) => {
    // 1. Upsert Profile
    const profile = await tx.socialProfile.upsert({
      where: {
        researchJobId_platform_handle: {
          researchJobId,
          platform: data.platform,
          handle: data.handle,
        },
      },
      update: {
        followers: data.followers,
        following: data.following,
        postsCount: data.postsCount,
        bio: data.bio,
        website: data.website,
        isVerified: data.isVerified,
        lastScrapedAt: new Date(),
        // Update cursor if we got new posts
        lastPostId: data.posts.length > 0 ? data.posts[0].externalId : undefined,
      },
      create: {
        researchJobId,
        platform: data.platform,
        handle: data.handle,
        url: data.url,
        followers: data.followers,
        following: data.following,
        postsCount: data.postsCount,
        bio: data.bio,
        website: data.website,
        isVerified: data.isVerified,
        lastScrapedAt: new Date(),
        lastPostId: data.posts.length > 0 ? data.posts[0].externalId : null,
      },
    });
    
    // 2. Calculate post rankings
    const rankingsMap = calculatePostRankings(
      data.posts,
      data.followers,
      data.platform
    );
    
    // 3. Process Posts & Trends
    let newPosts = 0;
    
    for (const post of data.posts) {
      const metadata = rankingsMap.get(post.externalId);
      const enrichedMetadata = {
        ...(metadata || {}),
        media_urls: post.mediaUrls || [],
      };
      
      // Save Post
      const savedPost = await tx.socialPost.upsert({
        where: {
          socialProfileId_externalId: {
            socialProfileId: profile.id,
            externalId: post.externalId,
          },
        },
        update: {
          // Update volatile metrics
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          sharesCount: post.sharesCount,
          viewsCount: post.viewsCount,
          playsCount: post.playsCount,
          thumbnailUrl: post.thumbnailUrl,
          metadata: enrichedMetadata as any, // Performance rankings + media urls
          scrapedAt: new Date(),
        },
        create: {
          socialProfileId: profile.id,
          externalId: post.externalId,
          url: post.url,
          type: post.type,
          caption: post.caption,
          hashtags: post.hashtags,
          mentions: post.mentions,
          thumbnailUrl: post.thumbnailUrl,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          sharesCount: post.sharesCount,
          viewsCount: post.viewsCount,
          duration: post.duration,
          postedAt: safeDate(post.postedAt),
          metadata: enrichedMetadata as any, // Performance rankings + media urls
          scrapedAt: new Date(),
        },
      });
      
      newPosts++;
      
      // 3. Extract & Save Trends (Hashtags)
      if (post.hashtags && post.hashtags.length > 0) {
        for (const tag of post.hashtags) {
          await tx.socialTrend.create({
            data: {
              researchJobId, // Link to job for broad analysis
              socialPostId: savedPost.id, // Link to specific post source
              name: tag.toLowerCase(),
              platform: data.platform,
              type: 'hashtag',
              volume: post.viewsCount || post.likesCount || 0, // Proxy volume
              firstSeenAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        }
      }
    }

    // 4. Save Discovered Competitors (OASP Integration)
    if (data.discoveredCompetitors && data.discoveredCompetitors.length > 0) {
        let newCompetitors = 0;
        
        // Real Logic for Competitors
        for (const comp of data.discoveredCompetitors) {
             // Basic validation
             if (!comp.username) continue;

            const exists = await tx.discoveredCompetitor.findFirst({
                where: {
                    researchJobId,
                    handle: comp.username
                }
            });

            if (!exists) {
                await tx.discoveredCompetitor.create({
                    data: {
                        researchJobId,
                        handle: comp.username,
                        platform: data.platform,
                        profileUrl: `https://instagram.com/${comp.username}`,
                        discoveryReason: `Discovered via @${data.handle} (OASP)`,
                        relevanceScore: 0.8, // Initial high relevance for discovered similar accounts
                        status: 'SUGGESTED',
                        discoveredAt: new Date()
                    }
                });
                newCompetitors++;
            }
        }
        console.log(`[SocialScraper] Saved ${newCompetitors} new competitors discovered via @${data.handle}`);
    }

    // ---------------------------
    // Snapshot layer (new design)
    // ---------------------------
    try {
      if (context?.type === 'client') {
        // Preserve last-known-good metadata when scrape returns 0/empty (avoid overwriting with bad data)
        const existingAccount = await tx.clientAccount.findUnique({
          where: {
            clientId_platform_handle: {
              clientId: context.clientId,
              platform: data.platform,
              handle: data.handle,
            },
          },
        });
        const safeFollowerCount =
          data.followers != null && data.followers > 0
            ? data.followers
            : (existingAccount?.followerCount ?? data.followers ?? undefined);
        const safeFollowingCount =
          data.following != null && data.following > 0
            ? data.following
            : (existingAccount?.followingCount ?? data.following ?? undefined);
        const safeBio =
          data.bio != null && String(data.bio).trim() !== ''
            ? data.bio
            : (existingAccount?.bio ?? data.bio ?? undefined);

        const clientProfile = await tx.clientProfile.upsert({
          where: {
            clientId_platform_handle: {
              clientId: context.clientId,
              platform: data.platform,
              handle: data.handle,
            },
          },
          update: {
            followerCount: safeFollowerCount,
            followingCount: safeFollowingCount,
            bio: safeBio,
            profileImageUrl: data.posts[0]?.thumbnailUrl || undefined,
            isVerified: data.isVerified,
            isPrivate: false,
            lastScrapedAt: new Date(),
          },
          create: {
            clientId: context.clientId,
            platform: data.platform,
            handle: data.handle,
            profileUrl: data.url,
            followerCount: data.followers,
            followingCount: data.following,
            bio: data.bio,
            profileImageUrl: data.posts[0]?.thumbnailUrl || undefined,
            isVerified: data.isVerified,
            isPrivate: false,
            lastScrapedAt: new Date(),
          },
        });

        // Sync ALL ClientAccount rows for this client+platform so orchestration (client-completeness) gap checks clear.
        // Duplicate rows (e.g. URL vs handle) all get the same lastScrapedAt/followerCount/bio.
        const accounts = await tx.clientAccount.findMany({
          where: { clientId: context.clientId, platform: data.platform },
          select: { id: true, handle: true },
        });
        const updatePayload = {
          followerCount: safeFollowerCount ?? undefined,
          followingCount: safeFollowingCount ?? undefined,
          bio: safeBio ?? undefined,
          profileUrl: data.url ?? undefined,
          profileImageUrl: data.posts[0]?.thumbnailUrl ?? undefined,
          lastScrapedAt: new Date(),
        };
        if (accounts.length > 0) {
          for (const acc of accounts) {
            await tx.clientAccount.update({
              where: { id: acc.id },
              data: updatePayload,
            });
          }
          console.log(
            `[SocialScraper] Updated ${accounts.length} ClientAccount(s) for client+platform (orchestration gap checks).`
          );
        } else {
          await tx.clientAccount.upsert({
            where: {
              clientId_platform_handle: {
                clientId: context.clientId,
                platform: data.platform,
                handle: data.handle,
              },
            },
            update: updatePayload,
            create: {
              clientId: context.clientId,
              platform: data.platform,
              handle: data.handle,
              profileUrl: data.url ?? undefined,
              followerCount: data.followers ?? undefined,
              followingCount: data.following ?? undefined,
              bio: data.bio ?? undefined,
              profileImageUrl: data.posts[0]?.thumbnailUrl ?? undefined,
              lastScrapedAt: new Date(),
            },
          });
        }

        const snapshot = await tx.clientProfileSnapshot.create({
          data: {
            clientProfileId: clientProfile.id,
            researchJobId,
            followerCount: safeFollowerCount ?? data.followers,
            followingCount: safeFollowingCount ?? data.following,
            bio: safeBio ?? data.bio,
            profileImageUrl: data.posts[0]?.thumbnailUrl || undefined,
            postsCount: data.postsCount,
            isVerified: data.isVerified,
            isPrivate: false,
            scrapedAt: new Date(),
          },
        });

        const followerBase = (safeFollowerCount ?? data.followers) || 0;
        for (const post of data.posts) {
          await tx.clientPostSnapshot.upsert({
            where: {
              clientProfileSnapshotId_externalPostId: {
                clientProfileSnapshotId: snapshot.id,
                externalPostId: post.externalId,
              },
            },
            update: {
              likesCount: post.likesCount,
              commentsCount: post.commentsCount,
              sharesCount: post.sharesCount,
              viewsCount: post.viewsCount,
              playsCount: post.playsCount,
              engagementRate: followerBase ? (post.likesCount + post.commentsCount) / Math.max(followerBase, 1) : null,
              scrapedAt: new Date(),
            },
            create: {
              clientProfileSnapshotId: snapshot.id,
              externalPostId: post.externalId,
              postUrl: post.url,
              caption: post.caption,
              format: post.type,
              likesCount: post.likesCount,
              commentsCount: post.commentsCount,
              sharesCount: post.sharesCount,
              viewsCount: post.viewsCount,
              playsCount: post.playsCount,
              postedAt: safeDate(post.postedAt),
              engagementRate: followerBase ? (post.likesCount + post.commentsCount) / Math.max(followerBase, 1) : null,
              scrapedAt: new Date(),
            },
          });
        }

        // Trigger media download for snapshot posts (non-blocking best-effort)
        downloadSnapshotMedia('client', snapshot.id).catch(err =>
          console.warn('[SocialScraper] Snapshot media download (client) failed', err?.message)
        );
      } else if (context?.type === 'competitor') {
        const competitorProfile = await tx.competitorProfile.upsert({
          where: {
            competitorId_platform_handle: {
              competitorId: context.competitorId,
              platform: data.platform,
              handle: data.handle,
            },
          },
          update: {
            followerCount: data.followers,
            followingCount: data.following,
            bio: data.bio,
            profileImageUrl: data.posts[0]?.thumbnailUrl || undefined,
            isVerified: data.isVerified,
            isPrivate: false,
            lastScrapedAt: new Date(),
          },
          create: {
            competitorId: context.competitorId,
            platform: data.platform,
            handle: data.handle,
            profileUrl: data.url,
            followerCount: data.followers,
            followingCount: data.following,
            bio: data.bio,
            profileImageUrl: data.posts[0]?.thumbnailUrl || undefined,
            isVerified: data.isVerified,
            isPrivate: false,
            lastScrapedAt: new Date(),
          },
        });

        const snapshot = await tx.competitorProfileSnapshot.create({
          data: {
            competitorProfileId: competitorProfile.id,
            researchJobId,
            followerCount: data.followers,
            followingCount: data.following,
            bio: data.bio,
            profileImageUrl: data.posts[0]?.thumbnailUrl || undefined,
            postsCount: data.postsCount,
            isVerified: data.isVerified,
            isPrivate: false,
            scrapedAt: new Date(),
          },
        });

        const followerBase = data.followers || 0;
        for (const post of data.posts) {
          await tx.competitorPostSnapshot.upsert({
            where: {
              competitorProfileSnapshotId_externalPostId: {
                competitorProfileSnapshotId: snapshot.id,
                externalPostId: post.externalId,
              },
            },
            update: {
              likesCount: post.likesCount,
              commentsCount: post.commentsCount,
              sharesCount: post.sharesCount,
              viewsCount: post.viewsCount,
              playsCount: post.playsCount,
              engagementRate: followerBase ? (post.likesCount + post.commentsCount) / Math.max(followerBase, 1) : null,
              scrapedAt: new Date(),
            },
            create: {
              competitorProfileSnapshotId: snapshot.id,
              externalPostId: post.externalId,
              postUrl: post.url,
              caption: post.caption,
              format: post.type,
              likesCount: post.likesCount,
              commentsCount: post.commentsCount,
              sharesCount: post.sharesCount,
              viewsCount: post.viewsCount,
              playsCount: post.playsCount,
              postedAt: safeDate(post.postedAt),
              engagementRate: followerBase ? (post.likesCount + post.commentsCount) / Math.max(followerBase, 1) : null,
              scrapedAt: new Date(),
            },
          });
        }

        downloadSnapshotMedia('competitor', snapshot.id).catch(err =>
          console.warn('[SocialScraper] Snapshot media download (competitor) failed', err?.message)
        );
      }
    } catch (snapshotError) {
      console.warn('[SocialScraper] Snapshot write skipped:', (snapshotError as any).message);
    }

    console.log(`[SocialScraper] Saved profile @${data.handle} and ${newPosts} posts`);
    return profile;
  });
}

/**
 * Determine whether the scraped profile belongs to the client or a competitor.
 */
async function resolveProfileContext(researchJobId: string, platform: string, handle: string): Promise<
  | { type: 'client'; clientId: string }
  | { type: 'competitor'; competitorId: string }
  | null
> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: { clientAccounts: true },
      },
      discoveredCompetitors: true,
    },
  });

  if (!job || !job.client) return null;

  const { normalizeHandle } = await import('../intake/brain-intake-utils');
  const normalizedScraped = normalizeHandle(handle);
  if (!normalizedScraped) return null;
  const isClient = job.client.clientAccounts.some(
    (acc) => acc.platform === platform && normalizeHandle(acc.handle) === normalizedScraped
  );

  if (isClient) {
    return { type: 'client', clientId: job.client.id };
  }

  const discovered = job.discoveredCompetitors.find(
    (dc) => dc.platform === platform && normalizeHandle(dc.handle) === normalizedScraped
  );

  if (discovered?.competitorId) {
    return { type: 'competitor', competitorId: discovered.competitorId };
  }

  // If discovered competitor exists but not linked, create competitor record
  if (discovered) {
    const competitor = await prisma.competitor.create({
      data: {
        clientId: job.client.id,
        handle: discovered.handle,
        platform: discovered.platform,
        isPriority: false,
      },
    });
    await prisma.discoveredCompetitor.update({
      where: { id: discovered.id },
      data: { competitorId: competitor.id },
    });
    return { type: 'competitor', competitorId: competitor.id };
  }

  return null;
}

// Helper to safely parse dates
function safeDate(dateStr: string | undefined): Date {
  if (!dateStr) return new Date();
  
  // Handle YYYYMMDD format (common in some scrapers)
  if (/^\d{8}$/.test(dateStr)) {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return new Date(`${year}-${month}-${day}`);
  }

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    console.warn(`[SocialScraper] Invalid date encountered: ${dateStr}. Fallback to now.`);
    return new Date();
  }
  return d;
}
