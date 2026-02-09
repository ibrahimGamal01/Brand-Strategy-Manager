
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const jobId = 'c505769a-4470-45a6-bee0-7883f9ef3f36';
  
  console.log(`Analyzing Job: ${jobId}`);
  
  // 1. Get all social profiles
  const allProfiles = await prisma.socialProfile.findMany({
    where: { researchJobId: jobId },
    select: { 
      id: true, 
      handle: true, 
      platform: true,
      _count: { select: { posts: true } }
    }
  });
  
  // 2. Get discovered competitors
  const competitors = await prisma.discoveredCompetitor.findMany({
    where: { researchJobId: jobId },
    select: { handle: true, platform: true, status: true }
  });
  
  // 3. Logic simulation
  const competitorHandles = new Set(competitors.map(c => c.handle.toLowerCase()));
  
  const clientProfiles = allProfiles.filter(p => !competitorHandles.has(p.handle.toLowerCase()));
  const competitorProfiles = allProfiles.filter(p => competitorHandles.has(p.handle.toLowerCase()));
  
  // Check ResearchJob params
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    select: { inputData: true }
  });
  console.log('\n--- JOB INPUT DATA ---');
  console.log(JSON.stringify(job?.inputData, null, 2));

  console.log('\n--- CLASSIFICATION ---');
  console.log('Client Profiles:', clientProfiles.map(p => `${p.platform}: ${p.handle}`));
  console.log('Competitor Profiles:', competitorProfiles.map(p => `${p.platform}: ${p.handle}`));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
