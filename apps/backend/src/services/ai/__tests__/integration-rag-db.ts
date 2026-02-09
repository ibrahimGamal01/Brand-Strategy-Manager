/**
 * RAG Database Integration Test
 * 
 * Comprehensive test to verify RAG system connects to all database tables
 * and retrieves data correctly.
 * 
 * Run: npx ts-node src/services/ai/__tests__/integration-rag-db.ts
 */

import { PrismaClient } from '@prisma/client';
import { getFullResearchContext } from '../rag';

const prisma = new PrismaClient();

interface DataSourceCheck {
  source: string;
  table: string;
  query: string;
  expected: string;
  result: 'PASS' | 'FAIL' | 'PENDING';
  details?: string;
}

async function testDatabaseConnections(): Promise<DataSourceCheck[]> {
  const checks: DataSourceCheck[] = [];

  // 1. Test ResearchJob connection
  checks.push({
    source: 'Research Jobs',
    table: 'research_jobs',
    query: 'Count total research jobs',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.researchJob.count();
    checks[0].result = 'PASS';
    checks[0].details = `Found ${count} research jobs`;
  } catch (error) {
    checks[0].result = 'FAIL';
    checks[0].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 2. Test Client connection
  checks.push({
    source: 'Clients',
    table: 'clients',
    query: 'Count clients',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.client.count();
    checks[1].result = 'PASS';
    checks[1].details = `Found ${count} clients`;
  } catch (error) {
    checks[1].result = 'FAIL';
    checks[1].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 3. Test RawSearchResult connection
  checks.push({
    source: 'Search Results',
    table: 'raw_search_results',
    query: 'Count search results',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.rawSearchResult.count();
    checks[2].result = 'PASS';
    checks[2].details = `Found ${count} search results`;
  } catch (error) {
    checks[2].result = 'FAIL';
    checks[2].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 4. Test AIQuestion connection
  checks.push({
    source: 'AI Questions',
    table: 'ai_questions',
    query: 'Count AI questions',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.aiQuestion.count();
    checks[3].result = 'PASS';
    checks[3].details = `Found ${count} AI questions`;
  } catch (error) {
    checks[3].result = 'FAIL';
    checks[3].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 5. Test Competitor connection
  checks.push({
    source: 'Competitors',
    table: 'competitors',
    query: 'Count competitors',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.competitor.count();
    checks[4].result = 'PASS';
    checks[4].details = `Found ${count} competitors`;
  } catch (error) {
    checks[4].result = 'FAIL';
    checks[4].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 6. Test SocialPost connection
  checks.push({
    source: 'Social Posts',
    table: 'social_posts',
    query: 'Count social posts',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.socialPost.count();
    checks[5].result = 'PASS';
    checks[5].details = `Found ${count} social posts`;
  } catch (error) {
    checks[5].result = 'FAIL';
    checks[5].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 7. Test SocialProfile connection
  checks.push({
    source: 'Social Profiles',
    table: 'social_profiles',
    query: 'Count social profiles',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.socialProfile.count();
    checks[6].result = 'PASS';
    checks[6].details = `Found ${count} social profiles`;
  } catch (error) {
    checks[6].result = 'FAIL';
    checks[6].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 8. Test CommunityInsight connection
  checks.push({
    source: 'Community Insights',
    table: 'community_insights',
    query: 'Count community insights',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.communityInsight.count();
    checks[7].result = 'PASS';
    checks[7].details = `Found ${count} community insights`;
  } catch (error) {
    checks[7].result = 'FAIL';
    checks[7].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  // 9. Test SearchTrend connection
  checks.push({
    source: 'Search Trends',
    table: 'search_trends',
    query: 'Count search trends',
    expected: 'Should return count >= 0',
    result: 'PENDING'
  });

  try {
    const count = await prisma.searchTrend.count();
    checks[8].result = 'PASS';
    checks[8].details = `Found ${count} search trends`;
  } catch (error) {
    checks[8].result = 'FAIL';
    checks[8].details = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }

  return checks;
}

async function testRAGIntegration() {
  console.log('\n=== RAG Database Integration Test ===\n');

  // Test database connections
  console.log('1. Testing Database Connections...\n');
  const dbChecks = await testDatabaseConnections();

  const passedChecks = dbChecks.filter(c => c.result === 'PASS').length;
  const failedChecks = dbChecks.filter(c => c.result === 'FAIL').length;

  dbChecks.forEach(check => {
    const icon = check.result === 'PASS' ? '✓' : '✗';
    console.log(`${icon} ${check.source}`);
    console.log(`  Table: ${check.table}`);
    console.log(`  ${check.details || 'No details'}`);
    console.log();
  });

  console.log(`Database Connection Summary: ${passedChecks}/${dbChecks.length} passed\n`);

  if (failedChecks > 0) {
    console.log('⚠️  Some database connections failed. Fix connectivity before proceeding.\n');
    return;
  }

  // Test RAG retrieval with a real job (if exists)
  console.log('2. Testing RAG Data Retrieval...\n');

  const job = await prisma.researchJob.findFirst({
    orderBy: { startedAt: 'desc' }
  });

  if (!job) {
    console.log('⚠️  No research jobs found. Create a research job to test RAG retrieval.\n');
    console.log('RAG system is ready but needs data to fully test.\n');
    return;
  }

  console.log(`Using Research Job: ${job.id}`);
  console.log(`Client ID: ${job.clientId}`);
  console.log(`Status: ${job.status}\n`);

  try {
    console.log('Retrieving research context...');
    const context = await getFullResearchContext(job.id);

    console.log('\n✓ RAG Retrieval Successful!\n');
    console.log('Data Retrieved:');
    console.log(`  Business Name: ${context.business.name}`);
    console.log(`  Search Results: ${context.business.searchResults.length}`);
    console.log(`  AI Insights: ${Object.keys(context.aiInsights).length - 1} questions`);
    console.log(`  Competitors (All): ${context.competitors.all10.length}`);
    console.log(`  Competitors (Priority): ${context.competitors.priority3.length}`);
    console.log(`  Social Posts: ${context.socialData.posts.length}`);
    console.log(`  Community Insights: ${context.community.insights.length}`);

    console.log('\nQuality Scores:');
    console.log(`  Overall: ${context.overallQuality.score.toFixed(1)}/100`);
    console.log(`  Business: ${context.business.qualityScore.score.toFixed(1)}/100`);
    console.log(`  AI Insights: ${context.aiInsights.qualityScore.score.toFixed(1)}/100`);
    console.log(`  Competitors: ${context.competitors.overallQuality.score.toFixed(1)}/100`);

    if (context.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${context.warnings.length}):`);
      context.warnings.slice(0, 3).forEach(w => console.log(`  - ${w}`));
    }

    console.log('\n=== RAG System Status ===');
    
    if (context.overallQuality.isReliable) {
      console.log('✓ RAG system is READY for template generation');
      console.log('✓ Data quality is sufficient (>= 70/100)');
      console.log('✓ All database connections working');
    } else {
      console.log('⚠️  RAG system works but data quality needs improvement');
      console.log(`   Quality: ${context.overallQuality.score.toFixed(1)}/100 (need >= 70)`);
    }

  } catch (error) {
    console.error('\n✗ RAG Retrieval Failed');
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
    console.error('\nStack:', error instanceof Error ? error.stack : 'No stack trace');
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  testRAGIntegration().catch(console.error);
}

export { testRAGIntegration, testDatabaseConnections };
