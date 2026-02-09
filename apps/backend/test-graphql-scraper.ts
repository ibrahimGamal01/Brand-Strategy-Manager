// Quick test script for Instagram GraphQL scraper
import { createGraphQLScraper } from './src/services/scraper/instagram-graphql';

async function testScraper() {
  console.log('Testing Instagram GraphQL Scraper...\n');
  
  const scraper = createGraphQLScraper();
  
  try {
    // Test with a known account
    const result = await scraper.scrapeFullProfile('natgeo', 5);
    
    console.log('✅ SUCCESS!\n');
    console.log('Profile:', {
      handle: result.profile.handle,
      followers: result.profile.follower_count.toLocaleString(),
      following: result.profile.following_count,
      total_posts: result.profile.total_posts
    });
    
    console.log('\nFirst 3 posts:');
    result.posts.slice(0, 3).forEach((post, i) => {
      console.log(`  ${i+1}. Likes: ${post.likes.toLocaleString()}, Comments: ${post.comments.toLocaleString()}`);
    });
    
    console.log(`\nScraper used: ${result.scraper_used}`);
    console.log(`Total posts scraped: ${result.posts.length}`);
    
  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  }
}

testScraper();
