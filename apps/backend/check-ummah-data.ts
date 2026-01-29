import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUmmahData() {
  try {
    const jobId = 'ad6d756e-e7bb-4bfa-84b0-5df6938b474f';
    
    // Get the research job with input data
    const job = await prisma.researchJob.findUnique({
      where: { id: jobId },
      include: {
        client: true
      }
    });
    
    console.log('=== CLIENT & INPUT DATA ===');
    console.log('Client Name:', job?.client.name);
    console.log('Input Data:', JSON.stringify(job?.inputData, null, 2));
    
    // Get sample search results
    const searchResults = await prisma.rawSearchResult.findMany({
      where: { researchJobId: jobId },
      take: 5,
      select: {
        title: true,
        body: true,
        href: true
      }
    });
    
    console.log('\n=== SAMPLE SEARCH RESULTS (First 5) ===');
    searchResults.forEach((sr, i) => {
      console.log(`\n${i + 1}. ${sr.title}`);
      console.log(`   URL: ${sr.href}`);
      console.log(`   Body: ${sr.body?.substring(0, 200)}...`);
    });
    
    // Check AI questions
    const aiQuestions = await prisma.aiQuestion.findMany({
      where: { researchJobId: jobId },
      select: {
        question: true,
        answer: true
      },
      take: 3
    });
    
    console.log('\n=== AI QUESTIONS (First 3) ===');
    aiQuestions.forEach((q, i) => {
      console.log(`\n${i + 1}. ${q.question}`);
      console.log(`   Answer: ${q.answer?.substring(0, 300)}...`);
    });
    
    // Check if social posts have actual content
    const postsWithContent = await prisma.socialPost.findMany({
      where: {
        socialProfile: {
          researchJobId: jobId
        },
        content: {
          not: null
        }
      },
      take: 3,
      select: {
        platform: true,
        content: true,
        postedAt: true,
        metadata: true
      }
    });
    
    console.log('\n=== SOCIAL POSTS WITH CONTENT ===');
    console.log(`Total posts with content: ${postsWithContent.length}`);
    postsWithContent.forEach((post, i) => {
      console.log(`\n${i + 1}. [${post.platform}] Posted: ${post.postedAt}`);
      console.log(`   Content: ${post.content?.substring(0, 100)}...`);
      console.log(`   Metadata:`, JSON.stringify(post.metadata, null, 2));
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUmmahData();
