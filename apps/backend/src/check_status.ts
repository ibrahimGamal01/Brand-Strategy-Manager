
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const jobId = 'c505769a-4470-45a6-bee0-7883f9ef3f36';
  
  /*
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    include: { 
      clientDocuments: { select: { id: true, title: true } }
    }
  });
  */
  
  // Check for generated document sections
  const analyses = await prisma.aiAnalysis.findMany({
    where: { 
      researchJobId: jobId,
      analysisType: 'DOCUMENT'
    },
    orderBy: { analyzedAt: 'desc' },
    select: { id: true, topic: true, analyzedAt: true }
  });
  
  console.log(`Found ${analyses.length} document sections.`);
  if (analyses.length > 0) {
    console.log('Latest section:', analyses[0]);
    console.log('All sections:', analyses.map(a => a.topic));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());

