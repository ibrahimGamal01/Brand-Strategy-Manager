import { PrismaClient } from '@prisma/client';
import { getFullResearchContext } from './src/services/ai/rag/index';

const prisma = new PrismaClient();

async function debugRAGContext() {
  try {
    const ummahJobId = 'ad6d756e-e7bb-4bfa-84b0-5df6938b474f';
    
    console.log('=== DEBUGGING RAG CONTEXT RETRIEVAL ===\n');
    console.log(`Job ID: ${ummahJobId}\n`);
    
    // Get the full research context
    const context = await getFullResearchContext(ummahJobId);
    
    console.log('=== BUSINESS CONTEXT ===');
    console.log(`Name: ${context.business.name}`);
    console.log(`Handle: ${context.business.handle}`);
    console.log(`Website: ${context.business.website}`);
    console.log(`Search Results: ${context.business.searchResults.length}`);
    
    // Check first search result
    if (context.business.searchResults.length > 0) {
      const firstResult = context.business.searchResults[0];
      console.log(`\nFirst Search Result:`);
      console.log(`  Title: ${firstResult.title}`);
      console.log(`  Body: ${firstResult.body?.substring(0, 200)}...`);
    }
    
    console.log('\n=== AI INSIGHTS ===');
    const insightKeys = Object.keys(context.aiInsights).filter(k => k !== 'qualityScore');
    console.log(`Total insights: ${insightKeys.length}`);
    
    // Check for ummah vs ghowiba mentions
    let ummahMentions = 0;
    let ghowibaMentions = 0;
    
    insightKeys.forEach(key => {
      const value = (context.aiInsights as any)[key] || '';
      const valueStr = value.toString().toLowerCase();
      
      if (valueStr.includes('ummah')) ummahMentions++;
      if (valueStr.includes('ghowiba')) ghowibaMentions++;
    });
    
    console.log(`Mentions of "ummah": ${ummahMentions}`);
    console.log(`Mentions of "ghowiba": ${ghowibaMentions}`);
    
    // Sample an insight
    if (insightKeys.length > 0) {
      const sampleKey = insightKeys[0];
      const sampleValue = (context.aiInsights as any)[sampleKey] || '';
      console.log(`\nSample Insight (${sampleKey}):`);
      console.log(sampleValue.toString().substring(0, 300) + '...');
    }
    
    console.log('\n=== COMPETITORS ===');
    console.log(`Total: ${context.competitors.all10.length}`);
    console.log(`Priority: ${context.competitors.priority3.length}`);
    
    if (context.competitors.all10.length > 0) {
      console.log('\nFirst 3 competitors:');
      context.competitors.all10.slice(0, 3).forEach((comp, i) => {
        console.log(`  ${i + 1}. @${comp.handle} (${comp.platform}) - ${comp.followers || 0} followers`);
      });
    }
    
    console.log('\n=== SOCIAL DATA ===');
    console.log(`Top Posts: ${context.socialData.topPosts.length}`);
    
    if (context.socialData.topPosts.length > 0) {
      console.log('\nFirst 3 top posts:');
      context.socialData.topPosts.slice(0, 3).forEach((post, i) => {
        const content = post.content || '';
        const metadata = post.metadata as any || {};
        console.log(`  ${i + 1}. [${post.platform || 'unknown'}] ${content.substring(0, 60)}...`);
        console.log(`     Likes: ${metadata.likes || 0}, Comments: ${metadata.comments || 0}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugRAGContext();
