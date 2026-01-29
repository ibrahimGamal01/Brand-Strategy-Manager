/**
 * Test Script for Phase 2 Generators
 * 
 * Verifies that all 9 generators can run orchestrally.
 * Uses robust database seeding and Mock AI mode.
 */

// Force Mock Mode BEFORE imports load config
process.env.MOCK_AI_CALLS = 'true';

import { PrismaClient } from '@prisma/client';
import { generateStrategyDocument } from '../services/ai/generators/index';

const prisma = new PrismaClient();

async function runTest() {
  console.log('🧪 Starting Phase 2 Generator Verification Test...');
  
  const testId = `test-${Date.now()}`;
  const clientId = `client-${testId}`;
  const jobId = `job-${testId}`;
  const competitorId = `comp-${testId}`;

  try {
    // 1. Seed Database
    console.log('🌱 Seeding database with test data...');
    
    // Client
    await prisma.client.create({
      data: {
        id: clientId,
        name: 'Test Client Corp',
        businessOverview: 'We sell organic coffee to tech startups.',
        productsServices: 'Dark roast, subscription service',
        uniqueValueProposition: 'Caffeine that keeps you coding.',
        keySellingPoints: 'Organic, Fair Trade, High Caffeine',
        // Minimal required fields
      }
    });

    // Research Job
    await prisma.researchJob.create({
      data: {
        id: jobId,
        clientId: clientId,
        status: 'ANALYZING',
        competitorsToFind: 5,
        priorityCompetitors: 3
      }
    });

    // Competitor (Priority)
    await prisma.competitor.create({
      data: {
        id: competitorId,
        clientId: clientId,
        handle: 'starbucks',
        platform: 'instagram',
        isPriority: true,
        followerCount: 1000000,
        engagementLevel: 'High'
      }
    });

    // Raw Posts (Required for CleanedPosts)
    await prisma.rawPost.createMany({
        data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => ({
            id: `raw-${i}-${testId}`, // Matching ID for relation
            competitorId: competitorId,
            externalPostId: `ext-${i}-${testId}`,
            platform: 'instagram'
        }))
    });

    // Cleaned Posts (for Content Analysis)
    await prisma.cleanedPost.createMany({
      data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => ({
        competitorId: competitorId,
        rawPostId: `raw-${i}-${testId}`, // Unique constraint
        externalPostId: `ext-${i}-${testId}`,
        caption: `This is a test post about coffee #${i}`,
        likes: 100 * i,
        comments: 10 * i,
        postedAt: new Date()
      }))
    });

    console.log('✅ Database seeded.');

    // 2. Run Generators
    console.log('🚀 Running Strategy Document Generators (Mock Mode)...');
    
    // We expect this to default to "all" sections
    const result = await generateStrategyDocument(jobId);

    console.log('\n📊 Test Results:');
    console.log(`Status: ${result.status}`);
    console.log(`Score: ${result.overallScore}`);
    console.log(`Time: ${result.generationTime}s`);
    console.log(`Sections Completed: ${Object.keys(result.sections).length}/9`);
    console.log('Sections:', Object.keys(result.sections).join(', '));

    // Verify all sections exist
    const expectedSections = [
      'businessUnderstanding',
      'targetAudience',
      'industryOverview',
      'priorityCompetitor',
      'contentAnalysis',
      'contentPillars',
      'formatRecommendations',
      'buyerJourney',
      'platformStrategy'
    ];

    const missing = expectedSections.filter(s => !result.sections[s as keyof typeof result.sections]);
    
    if (missing.length > 0) {
      console.error('❌ Failed: Missing sections:', missing.join(', '));
      process.exit(1);
    } else {
      console.log('✅ All sections generated successfully.');
    }

  } catch (error) {
    console.error('❌ Test Failed:', error);
  } finally {
    // 3. Cleanup
    console.log('🧹 Cleaning up test data...');
    try {
        // Deleting Client cascades to others
      await prisma.client.delete({ where: { id: clientId } });
      console.log('✅ Cleanup complete.');
    } catch (e) {
      console.error('⚠️ Cleanup failed:', e);
    }
    
    await prisma.$disconnect();
  }
}

runTest();
