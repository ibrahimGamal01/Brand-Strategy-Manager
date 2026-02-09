/**
 * Test script for Apify Instagram scraper
 * Usage: npx ts-node scripts/test-apify-scraper.ts <username> [postsLimit]
 */

import 'dotenv/config';
import { scrapeWithApify } from '../src/services/scraper/apify-instagram-scraper';

async function main() {
  const username = process.argv[2] || 'ummahpreneur';
  const postsLimit = parseInt(process.argv[3] || '10');

  console.log(`\n[Test] Testing Apify scraper for @${username} (limit: ${postsLimit})\n`);

  const startTime = Date.now();
  const result = await scrapeWithApify(username, postsLimit);
  const endTime = Date.now();

  console.log(`\n[Test] Scrape completed in ${((endTime - startTime) / 1000).toFixed(1)}s\n`);

  if (result.success && result.data) {
    console.log('✅ SUCCESS!');
    console.log('\n[Profile Stats]');
    console.log(`  Handle: @${result.data.handle}`);
    console.log(`  Followers: ${result.data.follower_count.toLocaleString()}`);
    console.log(`  Following: ${result.data.following_count.toLocaleString()}`);
    console.log(`  Total Posts: ${result.data.total_posts.toLocaleString()}`);
    console.log(`  Verified: ${result.data.is_verified}`);
    console.log(`  Private: ${result.data.is_private}`);
    console.log(`  Bio Length: ${result.data.bio?.length || 0} chars`);

    console.log(`\n[Posts Data]`);
    console.log(`  Posts Retrieved: ${result.data.posts.length}`);

    if (result.data.posts.length > 0) {
      const avgLikes = result.data.posts.reduce((sum: number, p: any) => sum + p.likes, 0) / result.data.posts.length;
      const avgComments = result.data.posts.reduce((sum: number, p: any) => sum + p.comments, 0) / result.data.posts.length;

      console.log(`  Average Likes: ${avgLikes.toFixed(0)}`);
      console.log(`  Average Comments: ${avgComments.toFixed(0)}`);

      console.log(`\n[Sample Post]`);
      const sample = result.data.posts[0];
      console.log(`  URL: ${sample.post_url}`);
      console.log(`  Likes: ${sample.likes.toLocaleString()} ✅`);
      console.log(`  Comments: ${sample.comments.toLocaleString()} ✅`);
      console.log(`  Caption: ${(sample.caption || '').substring(0, 80)}...`);
      console.log(`  Is Video: ${sample.is_video}`);

      // Check if post metrics are non-zero
      const postsWithZeroLikes = result.data.posts.filter((p: any) => p.likes === 0).length;
      const postsWithZeroComments = result.data.posts.filter((p: any) => p.comments === 0).length;

      console.log(`\n[Data Quality Check]`);
      console.log(`  Posts with 0 likes: ${postsWithZeroLikes}/${result.data.posts.length}`);
      console.log(`  Posts with 0 comments: ${postsWithZeroComments}/${result.data.posts.length}`);

      if (postsWithZeroLikes === result.data.posts.length) {
        console.log(`  ⚠️  WARNING: All posts have 0 likes!`);
      } else {
        console.log(`  ✅ Post metrics look good!`);
      }
    }
  } else {
    console.log('❌ FAILED!');
    console.log(`Error: ${result.error}`);
  }

  console.log(`\n[Test] Scraper used: ${result.scraper_used}\n`);
}

main().catch(error => {
  console.error('\n❌ Test script failed:', error.message);
  process.exit(1);
});
