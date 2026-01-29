import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugUmmahpreneur() {
  try {
    console.log('=== DEBUGGING UMMAHPRENEUR DATA PIPELINE ===\n');
    
    // 1. Find the client
    const clients = await prisma.client.findMany({
      where: {
        name: {
          contains: 'ummah',
          mode: 'insensitive'
        }
      }
    });
    
    if (clients.length === 0) {
      console.log('❌ No client found with "ummah" in name');
      return;
    }
    
    const client = clients[0];
    console.log(`✅ Client Found: ${client.name} (ID: ${client.id})`);
    console.log(`   Social Presence: ${client.currentSocialPresence || 'N/A'}\n`);
    
    // 2. Find research jobs
    const researchJobs = await prisma.researchJob.findMany({
      where: { clientId: client.id }
    });
    
    if (researchJobs.length === 0) {
      console.log('❌ No research jobs found for this client');
      return;
    }
    
    const job = researchJobs[0];
    console.log(`✅ Research Job: ${job.id}`);
    console.log(`   Status: ${job.status}\n`);
    
    // 3. Check search results
    const searchResults = await prisma.rawSearchResult.count({
      where: { researchJobId: job.id }
    });
    console.log(`📊 Search Results: ${searchResults}`);
    
    // 4. Check social profiles and posts
    const socialProfiles = await prisma.socialProfile.count({
      where: { researchJobId: job.id }
    });
    const socialPosts = await prisma.socialPost.findMany({
      where: {
        socialProfile: {
          researchJobId: job.id
        }
      },
      take: 5
    });
    console.log(`📊 Social Profiles: ${socialProfiles}`);
    console.log(`📊 Social Posts: ${socialPosts.length} (showing first 5)`);
    
    if (socialPosts.length > 0) {
      console.log('\n--- Sample Social Posts ---');
      socialPosts.forEach((post, i) => {
        const content = post.content || '';
        const metadata = post.metadata as any || {};
        console.log(`${i + 1}. [${post.platform}] ${content.substring(0, 80)}...`);
        console.log(`   Top Performers: ${metadata.topPerformers || 'None'}`);
        console.log(`   Likes: ${metadata.likes || 0}, Comments: ${metadata.comments || 0}\n`);
      });
    }
    
    // 5. Check AI analyses (12 questions)
    const aiAnalyses = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: job.id,
        topic: {
          in: [
            'business_understanding',
            'target_audience',
            'content_themes',
            'pain_points',
            'competitor_analysis'
          ]
        }
      },
      select: {
        topic: true,
        fullResponse: true
      }
    });
    
    console.log(`📊 AI Analyses (12 Questions): ${aiAnalyses.length}`);
    aiAnalyses.forEach(analysis => {
      const response = analysis.fullResponse as any;
      const preview = typeof response === 'string' 
        ? response.substring(0, 150) 
        : JSON.stringify(response).substring(0, 150);
      console.log(`\n--- ${analysis.topic} ---`);
      console.log(preview + '...');
    });
    
    // 6. Check document sections
    const documentSections = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: job.id,
        analysisType: 'DOCUMENT'
      },
      select: {
        topic: true
      }
    });
    
    console.log(`\n📊 Generated Document Sections: ${documentSections.length}`);
    documentSections.forEach(section => {
      console.log(`   - ${section.topic}`);
    });
    
    console.log('\n=== END DEBUG ===');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugUmmahpreneur();
