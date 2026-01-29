/**
 * Quick test file for auto-scraper
 * 
 * To test:
 * 1. Start backend: npm run dev
 * 2. POST /api/clients with Instagram + TikTok handles
 * 3. Check logs for auto-scraper execution
 * 4. Verify SocialProfile + SocialPost + MediaAsset records created
 */

// Example request body:
const exampleClientRequest = {
  name: "Test Client",
  handles: {
    instagram: "testhandle",
    tiktok: "testhandle"
  },
  niche: "Test"
};

// Expected auto-scraper behavior:
// 1. POST /api/clients → creates ResearchJob
// 2. autoScrapeClientProfiles() triggered in background
// 3. Checks rate limiter (15 min since last scrape)
// 4. Scrapes Instagram profile → saves to SocialProfile + SocialPost
// 5. Scrapes TikTok profile → saves to SocialProfile + SocialPost
// 6. Downloads media → saves to local storage + MediaAsset records
// 7. Validates data quality
// 8. Logs completion

// Check database after test:
// - SocialProfile: 2 records (instagram, tiktok)
// - SocialPost: 60 records (30 per platform)
// - MediaAsset: 120+ records (images/videos)
// - All blobStoragePath fields populated

// Rate limiting test:
// - Try to scrape same profile again immediately
// - Should skip with message: "Rate limited: instagram:@testhandle (15 min remaining)"

console.log('Auto-scraper test guide ready. See comments for testing instructions.');
