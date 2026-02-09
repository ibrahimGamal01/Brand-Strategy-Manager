
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JOB_ID = 'c505769a-4470-45a6-bee0-7883f9ef3f36';

async function main() {
  const analyses = await prisma.aiAnalysis.findMany({
    where: { researchJobId: JOB_ID },
    orderBy: { analyzedAt: 'asc' }
  });

  console.log(`Found ${analyses.length} analyses for job ${JOB_ID}`);

  for (const analysis of analyses) {
    console.log('\n' + '='.repeat(50));
    console.log(`SECTION: ${analysis.topic}`);
    console.log('='.repeat(50) + '\n');
    console.log(analysis.fullResponse);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
