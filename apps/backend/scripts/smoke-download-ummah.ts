import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { scrapeProfileSafe } from '../src/services/social/scraper';

const prisma = new PrismaClient();
const HANDLE = 'ummahpreneur';
const INCLUDE_TIKTOK = process.argv.includes('--with-tiktok');

async function findJob() {
  const job = await prisma.researchJob.findFirst({
    where: {
      client: { name: { contains: 'ummah', mode: 'insensitive' } },
    },
    orderBy: { startedAt: 'desc' },
    include: { client: true },
  });
  return job;
}

async function runScrape(jobId: string) {
  console.log(`➡️ Scraping Instagram for @${HANDLE}`);
  await scrapeProfileSafe(jobId, 'instagram', HANDLE);
  if (INCLUDE_TIKTOK) {
    console.log(`➡️ Scraping TikTok for @${HANDLE}`);
    await scrapeProfileSafe(jobId, 'tiktok', HANDLE);
  } else {
    console.log('➡️ Skipping TikTok (pass --with-tiktok to include it)');
  }
}

async function latestMediaSamples() {
  const assets = await prisma.mediaAsset.findMany({
    orderBy: { downloadedAt: 'desc' },
    take: 5,
  });
  return assets.map((a) => ({
    id: a.id,
    sourceType: a.sourceType,
    sourceId: a.sourceId,
    mediaType: a.mediaType,
    path: a.blobStoragePath,
    exists: a.blobStoragePath ? fs.existsSync(a.blobStoragePath) : false,
    size: a.blobStoragePath && fs.existsSync(a.blobStoragePath) ? fs.statSync(a.blobStoragePath).size : 0,
  }));
}

async function run() {
  const job = await findJob();
  if (!job) {
    console.error('No research job/client containing "ummah" found.');
    process.exit(1);
  }
  console.log(`Using researchJobId=${job.id} for client=${job.client.name}`);
  console.log(`Mode: Instagram${INCLUDE_TIKTOK ? ' + TikTok' : ' only'}`);

  await runScrape(job.id);

  const samples = await latestMediaSamples();
  console.log('Recent downloaded media:');
  samples.forEach((s) => {
    console.log(
      `- ${s.id} [${s.mediaType}] source=${s.sourceType || 'legacy'} path=${s.path} exists=${s.exists} size=${s.size}`
    );
  });
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
