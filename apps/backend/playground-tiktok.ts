/**
 * TikTok Scraper Playground
 * Test script with detailed logging and error handling
 * 
 * Installation:
 *     npm install tiktok-scraper
 * 
 * Usage:
 *     npx tsx playground-tiktok.ts <username> [max_posts]
 *     
 * Example:
 *     npx tsx playground-tiktok.ts therock 10
 */

import TikTokScraper, { UserData } from 'tiktok-scraper';
import fs from 'fs';

function printHeader(text: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${text}`);
  console.log('='.repeat(60));
}

function printSection(text: string) {
  console.log(`\n--- ${text} ---`);
}

interface ScrapedPost {
  id: string;
  url: string;
  description: string;
  likes: number;
  comments: number;
  shares: number;
  plays: number;
  engagement_rate: number;
  date: string;
  hashtags: string[];
  mentions: string[];
  duration: number;
  music: string;
}

interface ScrapeResult {
  success: boolean;
  error?: string;
  profile?: any;
  posts: ScrapedPost[];
  stats?: any;
}

async function scrapeTikTokProfile(
  username: string,
  maxPosts: number = 20
): Promise<ScrapeResult> {
  printHeader(`TIKTOK SCRAPER TEST: @${username}`);

  printSection('Initializing TikTok Scraper');
  console.log('✓ Scraper initialized');
  console.log(`  Target: @${username}`);
  console.log(`  Max posts: ${maxPosts}`);

  try {
    printSection('Fetching Profile & Posts');
    const startTime = Date.now();

    const userData: UserData = await TikTokScraper.user(username, {
      number: maxPosts,
      sessionList: [], // Can add session cookies if needed
    });

    const scrapingTime = (Date.now() - startTime) / 1000;
    console.log(`✓ Data fetched in ${scrapingTime.toFixed(2)}s`);

    // Profile information
    printSection('Profile Information');
    const profile = {
      username: userData.collector[0]?.authorMeta?.name || username,
      nickname: userData.collector[0]?.authorMeta?.nickName || 'N/A',
      followers: userData.collector[0]?.authorMeta?.fans || 0,
      following: userData.collector[0]?.authorMeta?.following || 0,
      total_videos: userData.collector[0]?.authorMeta?.video || 0,
      hearts: userData.collector[0]?.authorMeta?.heart || 0,
      verified: userData.collector[0]?.authorMeta?.verified || false,
      signature: userData.collector[0]?.authorMeta?.signature || '',
    };

    for (const [key, value] of Object.entries(profile)) {
      if (key === 'signature') {
        const preview = value.toString().substring(0, 50);
        console.log(`  ${key}: ${preview}${value.toString().length > 50 ? '...' : ''}`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }

    // Process posts
    printSection(`Processing Posts (${userData.collector.length})`);
    const posts: ScrapedPost[] = [];

    for (let i = 0; i < userData.collector.length; i++) {
      const post = userData.collector[i];
      console.log(`\n  Post ${i + 1}/${userData.collector.length}`);

      try {
        const totalEngagement = post.diggCount + post.commentCount + post.shareCount;
        const engagementRate = profile.followers > 0 
          ? (totalEngagement / profile.followers) * 100 
          : 0;

        const description = post.text || '';
        const descPreview = description.substring(0, 50) + (description.length > 50 ? '...' : '');

        // Extract hashtags
        const hashtags = description.match(/#\w+/g) || [];

        // Extract mentions
        const mentions = description.match(/@\w+/g) || [];

        const postData: ScrapedPost = {
          id: post.id,
          url: `https://tiktok.com/@${username}/video/${post.id}`,
          description: description,
          likes: post.diggCount || 0,
          comments: post.commentCount || 0,
          shares: post.shareCount || 0,
          plays: post.playCount || 0,
          engagement_rate: parseFloat(engagementRate.toFixed(2)),
          date: new Date(post.createTime * 1000).toISOString(),
          hashtags: hashtags,
          mentions: mentions,
          duration: post.videoMeta?.duration || 0,
          music: post.musicMeta?.musicName || 'Original Sound',
        };

        posts.push(postData);

        // Log details
        console.log(`    ✓ Likes: ${postData.likes.toLocaleString()}`);
        console.log(`    ✓ Comments: ${postData.comments.toLocaleString()}`);
        console.log(`    ✓ Shares: ${postData.shares.toLocaleString()}`);
        console.log(`    ✓ Plays: ${postData.plays.toLocaleString()}`);
        console.log(`    ✓ Engagement: ${postData.engagement_rate.toFixed(2)}%`);
        console.log(`    ✓ Duration: ${postData.duration}s`);
        console.log(`    ✓ Description: ${descPreview}`);
        console.log(`    ✓ Hashtags: ${hashtags.length > 0 ? hashtags.join(', ') : 'None'}`);

      } catch (err) {
        console.log(`    ✗ Error processing post: ${err}`);
        continue;
      }
    }

    // Summary
    printSection('Scraping Summary');
    console.log(`  ✓ Total posts scraped: ${posts.length}`);
    console.log(`  ✓ Total time: ${scrapingTime.toFixed(2)}s`);
    console.log(`  ✓ Average time per post: ${(scrapingTime / posts.length).toFixed(2)}s`);

    // Engagement stats
    if (posts.length > 0) {
      const avgLikes = posts.reduce((sum, p) => sum + p.likes, 0) / posts.length;
      const avgComments = posts.reduce((sum, p) => sum + p.comments, 0) / posts.length;
      const avgShares = posts.reduce((sum, p) => sum + p.shares, 0) / posts.length;
      const avgPlays = posts.reduce((sum, p) => sum + p.plays, 0) / posts.length;
      const avgEngagement = posts.reduce((sum, p) => sum + p.engagement_rate, 0) / posts.length;

      console.log('\n  Engagement Averages:');
      console.log(`    Likes: ${avgLikes.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`    Comments: ${avgComments.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`    Shares: ${avgShares.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`    Plays: ${avgPlays.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`    Engagement Rate: ${avgEngagement.toFixed(2)}%`);

      // Top performing posts
      const sortedPosts = [...posts].sort((a, b) => b.engagement_rate - a.engagement_rate);
      console.log('\n  Top 3 Posts by Engagement:');
      for (let i = 0; i < Math.min(3, sortedPosts.length); i++) {
        const post = sortedPosts[i];
        console.log(`    ${i + 1}. ${post.engagement_rate.toFixed(1)}% - ${post.likes.toLocaleString()} likes - ${post.plays.toLocaleString()} plays`);
      }

      // Save to JSON
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const outputFile = `tiktok_${username}_${timestamp}.json`;
      
      const result: ScrapeResult = {
        success: true,
        profile,
        posts,
        stats: {
          scraped_at: new Date().toISOString(),
          total_posts: posts.length,
          scraping_time: scrapingTime,
          avg_likes: avgLikes,
          avg_comments: avgComments,
          avg_shares: avgShares,
          avg_plays: avgPlays,
          avg_engagement_rate: avgEngagement,
        },
      };

      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));

      printSection('Output');
      console.log(`  ✓ Data saved to: ${outputFile}`);

      return result;
    }

    return {
      success: true,
      profile,
      posts: [],
    };

  } catch (error: any) {
    console.error('\n✗ ERROR:', error.message);
    
    if (error.message.includes('User not found')) {
      console.error('   Profile does not exist or username is incorrect');
    } else if (error.message.includes('rate limit')) {
      console.error('   Rate limited by TikTok - try again later');
    } else if (error.message.includes('captcha')) {
      console.error('   TikTok is requiring CAPTCHA - may need proxy or session cookies');
    } else {
      console.error('   Full error:', error);
    }

    return {
      success: false,
      error: error.message,
      posts: [],
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: npx tsx playground-tiktok.ts <username> [max_posts]');
    console.log('Example: npx tsx playground-tiktok.ts therock 10');
    process.exit(1);
  }

  const username = args[0].replace('@', '');
  const maxPosts = args[1] ? parseInt(args[1]) : 20;

  const result = await scrapeTikTokProfile(username, maxPosts);

  printHeader('TEST COMPLETE');

  if (result.success) {
    console.log('✓ SUCCESS - Data scraped and saved to JSON');
  } else {
    console.log(`✗ FAILED - ${result.error || 'Unknown error'}`);
  }

  console.log('\n');
}

main().catch(console.error);
