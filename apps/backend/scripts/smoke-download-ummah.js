require('dotenv').config();
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { scrapeProfileSafe } = require('../dist/services/social/scraper');

const prisma = new PrismaClient();
const HANDLE = 'ummahpreneur';

async function ensureClientAndJob() {
  let client = await prisma.client.findFirst({
    where: { name: { contains: 'ummah', mode: 'insensitive' } },
  });

  if (!client) {
    client = await prisma.client.create({
      data: {
        name: 'Ummahpreneur',
        businessOverview: 'Temp seed for smoke test',
      },
    });
  }

  // Ensure client accounts for IG/TikTok
  const handles = ['instagram', 'tiktok'];
  for (const platform of handles) {
    const exists = await prisma.clientAccount.findFirst({
      where: { clientId: client.id, platform, handle: HANDLE },
    });
    if (!exists) {
      await prisma.clientAccount.create({
        data: {
          clientId: client.id,
          platform,
          handle: HANDLE,
          profileUrl: platform === 'instagram'
            ? `https://instagram.com/${HANDLE}`
            : `https://tiktok.com/@${HANDLE}`,
        },
      });
    }
  }

  let job = await prisma.researchJob.findFirst({
    where: { clientId: client.id },
    orderBy: { startedAt: 'desc' },
  });

  if (!job) {
    job = await prisma.researchJob.create({
      data: {
        clientId: client.id,
        status: 'PENDING',
        inputData: { handle: HANDLE, platform: 'instagram', handles: { instagram: HANDLE, tiktok: HANDLE } },
        competitorsToFind: 5,
        priorityCompetitors: 3,
        startedAt: new Date(),
      },
    });
  }

  return { client, job };
}

async function runScrape(jobId) {
  console.log(`➡️ Scraping Instagram for @${HANDLE}`);
  await scrapeProfileSafe(jobId, 'instagram', HANDLE);
  console.log(`➡️ Scraping TikTok for @${HANDLE}`);
  await scrapeProfileSafe(jobId, 'tiktok', HANDLE);
}

async function latestMediaSamples() {
  const assets = await prisma.mediaAsset.findMany({
    orderBy: { downloadedAt: 'desc' },
    take: 8,
  });
  return assets.map((a) => ({
    id: a.id,
    sourceType: a.sourceType,
    mediaType: a.mediaType,
    path: a.blobStoragePath,
    exists: a.blobStoragePath ? fs.existsSync(a.blobStoragePath) : false,
    size: a.blobStoragePath && fs.existsSync(a.blobStoragePath) ? fs.statSync(a.blobStoragePath).size : 0,
  }));
}

async function main() {
  const { client, job } = await ensureClientAndJob();
  console.log(`Using researchJobId=${job.id} for client=${client.name}`);

  await runScrape(job.id);

  const samples = await latestMediaSamples();
  console.log('Recent downloaded media:');
  samples.forEach((s) =>
    console.log(`- ${s.id} [${s.mediaType}] source=${s.sourceType || 'legacy'} path=${s.path} exists=${s.exists} size=${s.size}`)
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
