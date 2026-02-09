import { prisma } from '../../lib/prisma';

/**
 * Save competitor posts to RawPost and CleanedPost tables
 * This enables the card-based posts display feature
 */
export async function saveCompetitorPosts(
  competitorId: string,
  platform: string,
  posts: Array<{
    externalId: string;
    url?: string;
    caption?: string;
    likesCount?: number;
    commentsCount?: number;
    sharesCount?: number;
    viewsCount?: number;
    playsCount?: number;
    postedAt?: string;
    thumbnailUrl?: string;
    type?: string;
  }>
): Promise<number> {
  console.log(`[CompetitorPosts] Saving ${posts.length} posts for competitor ${competitorId}`);
  
  let savedCount = 0;
  
  for (const post of posts) {
    try {
      // Handle both snake_case (from Instagram/TikTok APIs) and camelCase (from interface)
      const externalId = (post as any).external_post_id || post.externalId;
      const postUrl = (post as any).post_url || post.url;
      const likesCount = (post as any).likes || post.likesCount || 0;
      const commentsCount = (post as any).comments || post.commentsCount || 0;
      const sharesCount = (post as any).shares || post.sharesCount || 0;
      const viewsCount = (post as any).views || post.viewsCount || 0;
      const playsCount = (post as any).plays_count || post.playsCount || 0;
      const caption = (post as any).caption || '';
      const postType = (post as any).is_video ? 'video' : (post as any).type || 'image';
      const timestamp = (post as any).timestamp || post.postedAt;
      
      console.log(`[CompetitorPosts] Processing post ${externalId} with ${likesCount} likes, ${commentsCount} comments...`);
      
      // 1. Create or update RawPost
      const rawPost = await prisma.rawPost.upsert({
        where: {
          externalPostId: externalId,
        },
        update: {
          postUrl: postUrl || null,
          rawApiResponse: post, // Store full post data as JSON
          scrapeSource: 'competitor_scraper',
          status: 'PENDING', // Will be processed into CleanedPost
        },
        create: {
          competitorId,
          externalPostId: externalId,
          platform,
          postUrl: postUrl || null,
          rawApiResponse: post,
          scrapeSource: 'competitor_scraper',
          status: 'PENDING',
        },
      });

      console.log(`[CompetitorPosts] ✓ Saved RawPost ${rawPost.id}`);

      // 2. Create or update CleanedPost
      await prisma.cleanedPost.upsert({
        where: {
          rawPostId: rawPost.id,
        },
        update: {
          caption: caption || null,
          likes: likesCount,
          comments: commentsCount,
          shares: sharesCount,
          saves: 0, // TikTok doesn't provide saves
          engagementRate: calculateEngagement({ likesCount, commentsCount, viewsCount, playsCount }),
          postedAt: parsePostDate(timestamp),
        },
        create: {
          rawPostId: rawPost.id,
          competitorId,
          externalPostId: externalId,
          postUrl: postUrl || null,
          caption: caption || null,
          format: postType,
          likes: likesCount,
          comments: commentsCount,
          shares: sharesCount,
          saves: 0,
          engagementRate: calculateEngagement({ likesCount, commentsCount, viewsCount, playsCount }),
          postedAt: parsePostDate(timestamp),
        },
      });

      console.log(`[CompetitorPosts] ✓ Saved CleanedPost for ${externalId} with ${likesCount} likes`);
      savedCount++;
    } catch (error: any) {
      console.error(`[CompetitorPosts] ❌ FAILED to save post:`);
      console.error(`[CompetitorPosts] Error: ${error.message}`);
      console.error(`[CompetitorPosts] Stack: ${error.stack}`);
    }
  }

  console.log(`[CompetitorPosts] ✓ Saved ${savedCount}/${posts.length} posts`);
  return savedCount;
}

/**
 * Calculate engagement rate from post metrics
 */
function calculateEngagement(metrics: { likesCount?: number; commentsCount?: number; viewsCount?: number; playsCount?: number }): number {
  const likes = metrics.likesCount || 0;
  const comments = metrics.commentsCount || 0;
  const views = metrics.viewsCount || metrics.playsCount || 1;
  
  // Engagement = (likes + comments) / views
  return (likes + comments) / Math.max(views, 1);
}

/**
 * Parse post date string which might be YYYYMMDD or ISO format
 */
function parsePostDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  
  // Handle YYYYMMDD format (e.g. "20260205")
  if (/^\d{8}$/.test(dateStr)) {
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Months are 0-indexed
    const day = parseInt(dateStr.substring(6, 8));
    return new Date(year, month, day);
  }
  
  // Try standard parsing
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Ensure competitor record exists
 * Creates one if the discovered competitor doesn't have a linked Competitor yet
 */
export async function ensureCompetitorExists(
  discoveredCompetitorId: string,
  researchJobId: string
): Promise<string> {
  const discovered = await prisma.discoveredCompetitor.findUnique({
    where: { id: discoveredCompetitorId },
    include: { researchJob: true },
  });

  if (!discovered) {
    throw new Error(`Discovered competitor ${discoveredCompetitorId} not found`);
  }

  // If already linked to a Competitor, return it
  if (discovered.competitorId) {
    return discovered.competitorId;
  }

  // Create new Competitor record
  const competitor = await prisma.competitor.create({
    data: {
      clientId: discovered.researchJob.clientId,
      handle: discovered.handle,
      platform: discovered.platform,
      isPriority: false,
    },
  });

  // Link to discovered competitor
  await prisma.discoveredCompetitor.update({
    where: { id: discoveredCompetitorId },
    data: { competitorId: competitor.id },
  });

  console.log(`[CompetitorPosts] Created Competitor record for @${discovered.handle}`);
  return competitor.id;
}
