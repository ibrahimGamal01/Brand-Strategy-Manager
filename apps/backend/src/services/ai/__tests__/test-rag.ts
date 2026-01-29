/**
 * Test RAG Retrieval System
 * 
 * Run: npx ts-node src/services/ai/__tests__/test-rag.ts research-job-id
 */

import { getFullResearchContext, formatContextForLLM } from '../rag';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testRAG() {
  console.log('\n=== Testing RAG Retrieval System ===\n');

  // Get a real research job from the database
  const job = await prisma.researchJob.findFirst({
    orderBy: { startedAt: 'desc' }
  });

  if (!job) {
    console.log('❌ No research jobs found in database');
    console.log('Create a research job first to test RAG system');
    return;
  }

  console.log(`✓ Found research job: ${job.id}`);
  console.log(`  Client: ${job.clientId}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Started: ${job.startedAt?.toISOString() || 'N/A'}\n`);

  try {
    // Test RAG retrieval
    console.log('Fetching research context...');
    const context = await getFullResearchContext(job.id);

    console.log('\n=== Results ===\n');
    console.log(`Overall Quality Score: ${context.overallQuality.score.toFixed(1)}/100`);
    console.log(`Reliable: ${context.overallQuality.isReliable ? '✓' : '✗'}`);
    console.log(`\nData Sources:`);
    console.log(`  Business: ${context.business.qualityScore.score.toFixed(1)}/100`);
    console.log(`  AI Insights: ${context.aiInsights.qualityScore.score.toFixed(1)}/100`);
    console.log(`  Competitors: ${context.competitors.overallQuality.score.toFixed(1)}/100`);
    console.log(`  Social: ${context.socialData.qualityScore.score.toFixed(1)}/100`);
    console.log(`  Community: ${context.community.qualityScore.score.toFixed(1)}/100`);

    console.log(`\nData Counts:`);
    console.log(`  Search Results: ${context.business.searchResults.length}`);
    console.log(`  AI Insights Keys: ${Object.keys(context.aiInsights).length - 1}`);
    console.log(`  Competitors (All): ${context.competitors.all10.length}`);
    console.log(`  Competitors (Priority): ${context.competitors.priority3.length}`);
    console.log(`  Social Posts: ${context.socialData.posts.length}`);
    console.log(`  Community Insights: ${context.community.insights.length}`);

    if (context.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${context.warnings.length}):`);
      context.warnings.slice(0, 5).forEach(w => console.log(`  - ${w}`));
    }

    if (context.overallQuality.issues.length > 0) {
      console.log(`\n❌ Issues (${context.overallQuality.issues.length}):`);
      context.overallQuality.issues.slice(0, 5).forEach(i => console.log(`  - ${i}`));
    }

    if (context.missingData.length > 0) {
      console.log(`\n❌ Missing Data:`);
      context.missingData.forEach(m => console.log(`  - ${m}`));
    }

    // Test formatting for LLM
    console.log('\n=== LLM Context Preview ===\n');
    const llmContext = formatContextForLLM(context);
    console.log(llmContext.substring(0, 500) + '...\n');

    // Summary
    console.log('=== Summary ===\n');
    if (context.overallQuality.isReliable) {
      console.log('✓ RAG system is working correctly!');
      console.log('✓ Data quality is sufficient for content generation');
    } else {
      console.log('⚠️  RAG system works but data quality needs improvement');
      console.log(`   Quality score: ${context.overallQuality.score.toFixed(1)}/100 (need ≥70)`);
    }

  } catch (error) {
    console.error('\n❌ Error testing RAG:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  testRAG().catch(console.error);
}

export { testRAG };
