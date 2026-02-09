/**
 * Quick script to check and re-scrape ummahpreneur profile
 */
import { PrismaClient } from '@prisma/client';
import { scrapeProfileSafe } from '../src/services/social/scraper';

const prisma = new PrismaClient();

async function main() {
  console.log('[Script] Finding ummahpreneur social profiles...');
  
  // Find all social profiles for ummahpreneur
  const profiles = await prisma.socialProfile.findMany({
    where: {
      handle: 'ummahpreneur',
      platform: 'instagram'
    },
    include: {
      researchJob: {
        select: {
          id: true,
          client: {
            select: {
              name: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  console.log(`[Script] Found ${profiles.length} profiles for @ummahpreneur`);

  if (profiles.length === 0) {
    console.log('[Script] No profiles found. Exiting.');
    return;
  }

  // Show current data
  for (const profile of profiles) {
    console.log(`\n[Profile] ID: ${profile.id}`);
    console.log(`  Client: ${profile.researchJob?.client?.name}`);
    console.log(`  Research Job: ${profile.researchJobId}`);
    console.log(`  Followers: ${profile.followers}`);
    console.log(`  Following: ${profile.following} <-- THIS IS THE ISSUE`);
    console.log(`  Last Scraped: ${profile.lastScrapedAt}`);
  }

  // Re-scrape the most recent profile
  const profileToRescrape = profiles[0];
  
  console.log(`\n[Script] Re-scraping profile ID: ${profileToRescrape.id}...`);
  
  const result = await scrapeProfileSafe(
    profileToRescrape.researchJobId,
    'instagram',
    'ummahpreneur'
  );

  if (result.success) {
    console.log('[Script] ✅ Re-scrape successful!');
    
    // Check updated data
    const updated = await prisma.socialProfile.findUnique({
      where: { id: profileToRescrape.id }
    });
    
    console.log(`\n[Updated Profile]`);
    console.log(`  Followers: ${updated?.followers}`);
    console.log(`  Following: ${updated?.following} <-- SHOULD NOW BE 6`);
    console.log(`  Last Scraped: ${updated?.lastScrapedAt}`);
  } else {
    console.error('[Script] ❌ Re-scrape failed:', result.error);
  }
}

main()
  .catch(error => {
    console.error('[Script] Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
