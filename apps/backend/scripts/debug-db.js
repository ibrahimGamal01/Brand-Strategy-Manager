
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkJobData() {
  console.log('Checking ALL Social Profiles in DB...');
  const allProfiles = await prisma.socialProfile.findMany();
  console.log(`Total Profiles Found: ${allProfiles.length}`);
  console.log(JSON.stringify(allProfiles, null, 2));

  if (allProfiles.length > 0) {
      const posts = await prisma.socialPost.findMany({
        where: { socialProfileId: allProfiles[0].id },
        take: 5,
        select: { id: true, externalId: true, type: true, thumbnailUrl: true, url: true }
      });
      console.log('Sample Posts from first profile:', JSON.stringify(posts, null, 2));
  }
  
  const clientAccounts = await prisma.clientAccount.findMany({
    where: { 
      client: {
        researchJobs: {
          some: { id: jobId }
        }
      }
    }
  });
  console.log('Client Accounts:', JSON.stringify(clientAccounts, null, 2));
}

checkJobData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
