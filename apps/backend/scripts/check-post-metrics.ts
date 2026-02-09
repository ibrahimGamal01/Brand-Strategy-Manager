/**
 * Check what post metrics we currently have in the database
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Check] Querying database for ummahpreneur post metrics...\n');

  const profile = await prisma.socialProfile.findFirst({
    where: {
      handle: 'ummahpreneur',
      platform: 'instagram'
    },
    include: {
      posts: {
        take: 5,
        orderBy: { postedAt: 'desc' }
      }
    }
  });

  if (!profile) {
    console.log('❌ No profile found for ummahpreneur');
    return;
  }

  console.log('[Profile]');
  console.log(`  Handle: @${profile.handle}`);
  console.log(`  Followers: ${profile.followers?.toLocaleString()}`);
  console.log(`  Following: ${profile.following?.toLocaleString()}`);
  console.log(`  Total Posts in DB: ${profile.posts.length}`);
  console.log(`  Last Scraped: ${profile.lastScrapedAt}`);

  console.log('\n[Recent Posts Metrics]');
  
  if (profile.posts.length === 0) {
    console.log('  ⚠️  No posts found in database');
    return;
  }

  let postsWithLikes = 0;
  let postsWithComments = 0;
  let totalLikes = 0;
  let totalComments = 0;

  profile.posts.forEach((post, idx) => {
    console.log(`\n  Post ${idx + 1}:`);
    console.log(`    ID: ${post.externalId}`);
    console.log(`    Likes: ${post.likesCount || 0}`);
    console.log(`    Comments: ${post.commentsCount || 0}`);
    console.log(`    Caption: ${(post.caption || '').substring(0, 60)}...`);
    
    if (post.likesCount && post.likesCount > 0) postsWithLikes++;
    if (post.commentsCount && post.commentsCount > 0) postsWithComments++;
    
    totalLikes += post.likesCount || 0;
    totalComments += post.commentsCount || 0;
  });

  console.log('\n[Summary]');
  console.log(`  Posts with likes > 0: ${postsWithLikes}/${profile.posts.length}`);
  console.log(`  Posts with comments > 0: ${postsWithComments}/${profile.posts.length}`);
  console.log(`  Avg likes: ${(totalLikes / profile.posts.length).toFixed(0)}`);
  console.log(`  Avg comments: ${(totalComments / profile.posts.length).toFixed(0)}`);

  if (postsWithLikes === 0 && postsWithComments === 0) {
    console.log('\n  ⚠️  WARNING: All posts have 0 likes AND 0 comments!');
    console.log('  This indicates the scrapers are not capturing engagement metrics.');
  } else {
    console.log('\n  ✅ Post metrics look good!');
  }
}

main()
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
