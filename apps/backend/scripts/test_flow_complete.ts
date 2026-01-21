
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { scrapeProfileIncrementally } from '../src/services/social/scraper';

// Initialize Prisma
const prisma = new PrismaClient();

async function runTest() {
  console.log('=== STARTING TIKTOK FLOW TEST ===');
  
  try {
    // 1. Create Dummy Client & Research Job
    console.log('1. Creating test data...');
    const client = await prisma.client.create({
      data: {
        name: 'Test Client ' + Date.now(),
        businessOverview: 'Test Business',
      }
    });
    
    const job = await prisma.researchJob.create({
      data: {
        clientId: client.id,
        status: 'PENDING',
      }
    });
    
    console.log(`   Created Client: ${client.id}`);
    console.log(`   Created Job: ${job.id}`);

    // CLEANUP: Remove existing profile if exists to ensure fresh scrape
    const handle = '6969541225033090049'; 
    console.log('2. Cleaning up previous test data...');
    try {
        await prisma.socialProfile.deleteMany({
            where: {
                handle: handle,
                platform: 'tiktok'
            }
        });
        console.log('   [OK] Cleaned up previous profile data');
    } catch (e) {
        console.log('   [INFO] No previous data to clean');
    }

    // 2. Run Scraper (which should trigger download)
    console.log(`3. Running scrapeProfileIncrementally for @${handle}...`);
    
    // We scrape just a few videos (3-5) to be fast
    // Note: The python script logic for max_videos is inside the service, defaulting to 30.
    // We can't easily change it without modifying service, but 30 is fine for test.
    
    const profile = await scrapeProfileIncrementally(job.id, 'tiktok', handle);
    
    if (!profile) {
      throw new Error('Scraping failed - returned null');
    }
    
    // 3. Verify Database Records
    console.log('3. Verifying Database Records...');
    
    // Check Social Profile
    const dbProfile = await prisma.socialProfile.findUnique({
      where: {
        researchJobId_platform_handle: {
            researchJobId: job.id,
            platform: 'tiktok',
            handle: handle
        }
      },
      include: {
          posts: {
              include: {
                  mediaAssets: true
              }
          }
      }
    });
    
    if (!dbProfile) throw new Error('Profile not found in DB');
    console.log(`   [OK] Profile saved: ${dbProfile.handle} (ID: ${dbProfile.id})`);
    console.log(`   [OK] Posts found: ${dbProfile.posts.length}`);
    
    if (dbProfile.posts.length === 0) {
        console.warn('   [WARN] No posts found, cannot verify download.');
        return;
    }

    // 4. Verify Media Assets
    let totalAssets = 0;
    let verifiedFiles = 0;
    
    for (const post of dbProfile.posts) {
        if (post.mediaAssets.length > 0) {
            for (const asset of post.mediaAssets) {
                totalAssets++;
                console.log(`   Asset ${asset.id}:`);
                console.log(`     Path: ${asset.blobStoragePath}`);
                console.log(`     Type: ${asset.mediaType}`);
                
                if (asset.blobStoragePath && fs.existsSync(asset.blobStoragePath)) {
                    const stats = fs.statSync(asset.blobStoragePath);
                    console.log(`     [OK] File exists! Size: ${(stats.size / 1024).toFixed(2)} KB`);
                    
                    if (asset.mediaType === 'VIDEO' && !asset.blobStoragePath.endsWith('.mp4')) {
                         console.error(`     [FAIL] Video has wrong extension: ${asset.blobStoragePath}`);
                    } else if (asset.mediaType === 'VIDEO') {
                         console.log(`     [OK] Video has .mp4 extension`);
                    }
                    
                    verifiedFiles++;
                } else {
                    console.error(`     [FAIL] File NOT found at path: ${asset.blobStoragePath}`);
                }
            }
        }
    }
    
    console.log(`   Total Media Assets in DB: ${totalAssets}`);
    console.log(`   Verified Files on Disk: ${verifiedFiles}`);
    
    if (verifiedFiles > 0) {
        console.log('\n=== TEST PASSED: Full flow verified ===');
    } else {
        console.error('\n=== TEST FAILED: No files verified on disk ===');
    }

    // Clean up (optional, maybe keep for manual inspection)
    // await prisma.researchJob.delete({ where: { id: job.id } });
    // await prisma.client.delete({ where: { id: client.id } });
    
  } catch (error) {
    console.error('Test Failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
