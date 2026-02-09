
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateMetrics() {
  // Find the latest post for ummahpreneur
  const jobID = 'c505769a-4470-45a6-bee0-7883f9ef3f36';
  
  const profile = await prisma.socialProfile.findFirst({
    where: {
      researchJobId: jobID,
      platform: 'instagram',
      handle: 'ummahpreneur'
    },
    include: {
      posts: {
        orderBy: {  postedAt: 'desc' }, // Use postedAt to find latest relevant post
        take: 1
      }
    }
  });

  if (!profile || profile.posts.length === 0) {
    console.log('No profile or posts found to update');
    return;
  }

  const post = profile.posts[0];
  console.log(`Updating post ${post.id} (${post.externalId})...`);

  const updated = await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      likesCount: 1234,
      commentsCount: 56,
      sharesCount: 10,
      viewsCount: 5000
    }
  });

  console.log('Updated Post Metrics:', updated);
}

updateMetrics()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
