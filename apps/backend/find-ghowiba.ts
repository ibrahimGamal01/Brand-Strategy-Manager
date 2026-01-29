import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findGhowibaData() {
  try {
    console.log('=== SEARCHING FOR GHOWIBA ===\n');
    
    // Search for Ghowiba client
    const ghowibaClients = await prisma.client.findMany({
      where: {
        name: {
          contains: 'ghowiba',
          mode: 'insensitive'
        }
      }
    });
    
    console.log(`Found ${ghowibaClients.length} clients with "ghowiba":`);
    ghowibaClients.forEach(c => console.log(`  - ${c.name} (${c.id})`));
    
    // Check if ummahpreneur job has Ghowiba document sections
    const ummahJobId = 'ad6d756e-e7bb-4bfa-84b0-5df6938b474f';
    
    const docSections = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: ummahJobId,
        topic: 'business_understanding'
      },
      select: {
        id: true,
        topic: true,
        fullResponse: true,
        researchJobId: true
      }
    });
    
    console.log(`\n=== BUSINESS_UNDERSTANDING SECTIONS FOR UMMAH JOB ===`);
    console.log(`Found ${docSections.length} sections`);
    
    docSections.forEach((section, i) => {
      const response = section.fullResponse?.toString() || '';
      const hasGhowiba = response.toLowerCase().includes('ghowiba');
      const hasUmmah = response.toLowerCase().includes('ummah');
      
      console.log(`\n${i + 1}. ID: ${section.id}`);
      console.log(`   Research Job: ${section.researchJobId}`);
      console.log(`   Contains "ghowiba": ${hasGhowiba}`);
      console.log(`   Contains "ummah": ${hasUmmah}`);
      console.log(`   Preview: ${response.substring(0, 200)}...`);
    });
    
    // Check all AI analyses for this job
    const allAnalyses = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: ummahJobId
      },
      select: {
        id: true,
        topic: true,
        analysisType: true
      }
    });
    
    console.log(`\n=== ALL AI ANALYSES FOR UMMAH JOB ===`);
    console.log(`Total: ${allAnalyses.length}`);
    allAnalyses.forEach(a => {
      console.log(`  - ${a.topic} (${a.analysisType})`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findGhowibaData();
