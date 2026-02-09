
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const discoveredId = 'a064afa1-e76d-4031-9b35-674f18d6b558';
  
  const discovered = await prisma.discoveredCompetitor.findUnique({
    where: { id: discoveredId }
  });
  console.log('Discovered:', discovered);

  if (discovered && discovered.competitorId) {
    const rawCount = await prisma.rawPost.count({
      where: { competitorId: discovered.competitorId }
    });
    console.log('RawPosts count:', rawCount);

    const cleanedCount = await prisma.cleanedPost.count({
      where: { competitorId: discovered.competitorId }
    });
    console.log('CleanedPosts count:', cleanedCount);
    
    // Check if any posts exist at all
    const allCleaned = await prisma.cleanedPost.count();
    console.log('Total CleanedPosts in DB:', allCleaned);
  }
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
