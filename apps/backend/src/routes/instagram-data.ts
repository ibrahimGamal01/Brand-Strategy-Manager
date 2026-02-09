import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { scrapeInstagramProfile } from '../services/scraper/instagram-service';

const router = Router();
const prisma = new PrismaClient();

/**
 * DELETE /api/instagram/profile/:profileId
 * Delete all posts and data for a specific Instagram profile
 */
router.delete('/profile/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params;

    // Validate profileId
    const profile = await prisma.socialProfile.findUnique({
      where: { id: profileId },
      include: { posts: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Delete all posts (cascades via Prisma schema)
    const deletedCount = await prisma.socialPost.deleteMany({
      where: { socialProfileId: profileId }
    });

    // ALSO delete Client Posts if they exist (sync UI view)
    let deletedClientPosts = 0;
    try {
      // Find associated ResearchJob -> Client -> ClientAccount
      const socialProfile = await prisma.socialProfile.findUnique({
        where: { id: profileId },
        include: { researchJob: true }
      });

      if (socialProfile && socialProfile.researchJob?.clientId) {
        const clientAccount = await prisma.clientAccount.findFirst({
          where: {
            clientId: socialProfile.researchJob.clientId,
            platform: socialProfile.platform,
            handle: socialProfile.handle
          }
        });

        if (clientAccount) {
          const clientPostsResult = await prisma.clientPost.deleteMany({
            where: { clientAccountId: clientAccount.id }
          });
          deletedClientPosts = clientPostsResult.count;
          console.log(`[Instagram] Also deleted ${deletedClientPosts} ClientPosts for account ${clientAccount.id}`);
        }
      }
    } catch (err) {
      console.warn('[Instagram] Failed to clean up ClientPosts:', err);
    }

    // Update profile to reset metrics
    await prisma.socialProfile.update({
      where: { id: profileId },
      data: {
        lastScrapedAt: null,
        followers: 0,
        following: 0,
      }
    });

    console.log(`[Instagram] Deleted ${deletedCount.count} posts for profile ${profile.handle}`);

    res.json({
      success: true,
      deletedCount: deletedCount.count,
      deletedClientPosts,
      message: `Successfully deleted ${deletedCount.count} posts for @${profile.handle}`
    });
  } catch (error: any) {
    console.error('[Instagram] Delete error:', error);
    res.status(500).json({ 
      error: 'Failed to delete profile data', 
      details: error.message 
    });
  }
});

/**
 * POST /api/instagram/scrape/:profileId
 * Trigger re-scrape for a specific Instagram profile
 */
router.post('/scrape/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params;
    const { postsLimit = 30 } = req.body;

    // Validate profileId and get profile
    const profile = await prisma.socialProfile.findUnique({
      where: { id: profileId },
      include: { researchJob: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (!profile.handle) {
      return res.status(400).json({ error: 'Profile has no handle' });
    }

    console.log(`[Instagram] Re-scraping @${profile.handle} (Layer 0: GraphQL)`);

    // Delete existing posts before re-scraping
    await prisma.socialPost.deleteMany({
      where: { socialProfileId: profileId }
    });

    // Scrape using the multi-layer strategy (GraphQL -> Python -> Puppeteer)
    const scrapeResult = await scrapeInstagramProfile(
      profile.handle,
      postsLimit
    );

    if (!scrapeResult.success || !scrapeResult.data) {
      throw new Error(scrapeResult.error || 'Scraping failed');
    }

    const data = scrapeResult.data;

    // Update profile with new scraped data
    await prisma.socialProfile.update({
      where: { id: profileId },
      data: {
        followers: data.follower_count,
        following: data.following_count,
        postsCount: data.total_posts,
        bio: data.bio,
        isVerified: data.is_verified,
        lastScrapedAt: new Date(),
      }
    });

    // Save posts and create ClientPost links for client profiles
    for (const post of data.posts) {
      const socialPost = await prisma.socialPost.upsert({
        where: {
          socialProfileId_externalId: {
            socialProfileId: profileId,
            externalId: post.external_post_id
          }
        },
        update: {
          likesCount: post.likes,
          commentsCount: post.comments,
          scrapedAt: new Date(),
        },
        create: {
          socialProfileId: profileId,
          externalId: post.external_post_id,
          url: post.post_url,
          caption: post.caption || '',
          likesCount: post.likes,
          commentsCount: post.comments,
          postedAt: new Date(post.timestamp),
          thumbnailUrl: post.media_url,
          type: post.typename || 'GraphImage',
          scrapedAt: new Date(),
        }
      });

      // ClientPost linking is disabled - schema doesn't support socialPostId unique field
      // TODO: Re-implement when schema is updated with proper relations
      // if (profile.researchJobId) {
      //   const clientAccount = await prisma.clientAccount.findFirst({
      //     where: { /* need proper relation field */ }
      //   });
      //   if (clientAccount) {
      //     await prisma.clientPost.upsert({ /* ... */ });
      //   }
      // }
    }

    console.log(`[Instagram] ✓ Re-scraped ${data.posts.length} posts using ${scrapeResult.scraper_used}`);

    res.json({
      success: true,
      postsCount: data.posts.length,
      scraper: scrapeResult.scraper_used,
      profile: {
        handle: profile.handle,
        followers: data.follower_count,
        following: data.following_count
      },
      message: `Successfully scraped ${data.posts.length} posts using ${scrapeResult.scraper_used}`
    });
  } catch (error: any) {
    console.error('[Instagram] Re-scrape error:', error);
    res.status(500).json({ 
      error: 'Failed to re-scrape profile', 
      details: error.message 
    });
  }
});

export default router;
