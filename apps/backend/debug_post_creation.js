
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debug() {
  const competitorId = '1fa1452e-72a2-4d0f-869d-62fccea1c6cd'; // islamicfinanceguru
  
  // 1. Get ALL RawPosts
  const rawPosts = await prisma.rawPost.findMany({
    where: { competitorId }
  });
  
  if (rawPosts.length === 0) {
    console.log('No RawPosts found!');
    return;
  }
  
  console.log(`Found ${rawPosts.length} RawPosts. Processing...`);

  // Helper function
  function parsePostDate(dateStr) {
    if (!dateStr) return null;
    if (/^\d{8}$/.test(dateStr)) {
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6)) - 1;
      const day = parseInt(dateStr.substring(6, 8));
      return new Date(year, month, day);
    }
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }

  let successCount = 0;

  for (const rawPost of rawPosts) {
    const post = rawPost.rawApiResponse;
    try {
        await prisma.cleanedPost.upsert({
            where: {
            rawPostId: rawPost.id,
            },
            update: {
            caption: post.caption || null,
            likes: post.likesCount || 0,
            comments: post.commentsCount || 0,
            shares: post.sharesCount || 0,
            saves: 0,
            engagementRate: 0.05,
            postedAt: parsePostDate(post.postedAt),
            },
            create: {
            rawPostId: rawPost.id,
            competitorId,
            externalPostId: post.externalId,
            postUrl: post.url || null,
            caption: post.caption || null,
            format: post.type || 'video',
            likes: post.likesCount || 0,
            comments: post.commentsCount || 0,
            shares: post.sharesCount || 0,
            saves: 0,
            engagementRate: 0.05,
            postedAt: parsePostDate(post.postedAt),
            },
        });
        successCount++;
    } catch (error) {
        console.error(`Failed to process ${rawPost.id}:`, error.message);
    }
  }
  console.log(`Successfully processed ${successCount}/${rawPosts.length} posts.`);
}

debug()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
