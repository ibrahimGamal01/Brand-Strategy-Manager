
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkStatus() {
  const jobID = 'c505769a-4470-45a6-bee0-7883f9ef3f36';
  const handle = 'ummahpreneur';
  
  console.log(`Checking scrape status for @${handle}...`);

  const profile = await prisma.socialProfile.findUnique({
    where: {
      researchJobId_platform_handle: {
        researchJobId: jobID,
        platform: 'instagram',
        handle: handle
      }
    },
    include: {
      posts: {
        orderBy: { scrapedAt: 'desc' },
        take: 1
      }
    }
  });

  if (!profile) {
    console.log('Profile not found');
    return;
  }

  console.log(`Last Scraped: ${profile.lastScrapedAt}`);
  console.log(`Followers: ${profile.followers}`);
  
  if (profile.posts.length > 0) {
    const post = profile.posts[0];
    console.log(`Latest Post ID: ${post.externalId}`);
    console.log(`Latest Post Scraped At: ${post.scrapedAt}`);
    console.log(`Metrics: Likes=${post.likesCount}, Comments=${post.commentsCount}`);
  } else {
    console.log('No posts found');
  }
}

checkStatus()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
