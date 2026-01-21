import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTrends() {
  const jobId = 'b5444e90-34a4-4825-8b20-8aa639a82be0';
  console.log(`Checking SearchTrends for job: ${jobId}`);

  const count = await prisma.searchTrend.count({
    where: { researchJobId: jobId }
  });

  console.log(`Found ${count} SearchTrend records.`);

  const trends = await prisma.searchTrend.findMany({
    where: { researchJobId: jobId }
  });
  console.log(JSON.stringify(trends, null, 2));
}

checkTrends()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
