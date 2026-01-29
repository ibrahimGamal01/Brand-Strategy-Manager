/**
 * Test for Social Scraper Service
 * Run: npx ts-node src/services/scrapers/__tests__/test-scraper-service.ts
 */

import { SocialScraperService } from '../social-scraper';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const scraper = new SocialScraperService();

async function testSocialScraper() {
  console.log('\n=== Testing Social Scraper Service Integration ===\n');

  // Need a real competitor ID from DB for this to work
  // Let's find one or verify basic functionality without saving if no competitor
  const competitor = await prisma.competitor.findFirst();

  if (!competitor) {
    console.log('⚠️ No competitors found in DB. Cannot test DB saving.');
    console.log('Testing script execution only...\n');
    return;
  }

  console.log(`Using Competitor ID: ${competitor.id} (${competitor.handle || 'No handle'})`);

  // Test TikTok (it's faster usually)
  console.log('\n---> Testing TikTok Scraper...');
  try {
    // Override handle extraction for test
    const result = await scraper['runPythonScraper']('TIKTOK', 'therock');
    console.log('Result Success:', result.success);
    console.log('Posts found:', result.posts?.length);
    console.log('Sample post:', result.posts?.[0]?.description?.substring(0, 50));
  } catch (e) {
    console.error('TikTok Test Failed:', e);
  }

  // Test Instagram
  console.log('\n---> Testing Instagram Scraper...');
  try {
    const result = await scraper['runPythonScraper']('INSTAGRAM', 'designstudiocairo');
    console.log('Result Success:', result.success);
    console.log('Posts found:', result.posts?.length);
    console.log('Sample post:', result.posts?.[0]?.caption?.substring(0, 50));
  } catch (e) {
    console.error('Instagram Test Failed:', e);
  }
}

if (require.main === module) {
  testSocialScraper().catch(console.error);
}
