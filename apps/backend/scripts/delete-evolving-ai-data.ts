/**
 * One-off: Remove all data associated with handle @evolving.ai for a specific research job,
 * then fix the client's Instagram to eluumis_official so we don't have to rescrape competitors.
 * Run from apps/backend: npm run delete-evolving-ai
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const JOB_ID = '58b36b53-0039-4d3a-9520-d5483035e81d';
const HANDLE_PATTERN = 'evolving'; // match evolving.ai, evolving, etc.
const CLIENT_INSTAGRAM_FIX = 'eluumis_official';

async function main() {
  console.log(`[Delete] Removing all @${HANDLE_PATTERN}* data for job ${JOB_ID}...\n`);

  const job = await prisma.researchJob.findUnique({
    where: { id: JOB_ID },
    select: { clientId: true, inputData: true },
  });
  if (!job) {
    throw new Error(`Job ${JOB_ID} not found`);
  }
  const clientId = job.clientId;

  // 0. DiscoveredCompetitor first (so Competitor can be deleted without FK)
  const delDisc = await prisma.discoveredCompetitor.deleteMany({
    where: {
      researchJobId: JOB_ID,
      OR: [
        { handle: { contains: HANDLE_PATTERN, mode: 'insensitive' } },
        { handle: { equals: 'evolving.ai', mode: 'insensitive' } },
      ],
    },
  });
  if (delDisc.count > 0) {
    console.log(`  DiscoveredCompetitor: deleted ${delDisc.count} row(s) for @${HANDLE_PATTERN}*`);
  }

  // 1. Competitor rows for this client with handle containing evolving (cascades to profiles, posts, etc.)
  const competitors = await prisma.competitor.findMany({
    where: { clientId, handle: { contains: HANDLE_PATTERN, mode: 'insensitive' } },
    select: { id: true, handle: true, platform: true },
  });
  for (const c of competitors) {
    await prisma.competitor.delete({ where: { id: c.id } });
    console.log(`  Deleted Competitor ${c.platform}:@${c.handle} (id: ${c.id})`);
  }
  if (competitors.length === 0) {
    console.log('  Competitor: none found');
  }

  // 2. DDG image results that reference evolving (query is like "site:instagram.com @evolving.ai")
  const ddgImages = await prisma.ddgImageResult.findMany({
    where: { researchJobId: JOB_ID, query: { contains: HANDLE_PATTERN, mode: 'insensitive' } },
    select: { id: true },
  });
  const ddgImageIds = ddgImages.map((r) => r.id);
  if (ddgImageIds.length > 0) {
    await prisma.mediaAsset.updateMany({ where: { ddgImageResultId: { in: ddgImageIds } }, data: { ddgImageResultId: null } });
    const delImg = await prisma.ddgImageResult.deleteMany({ where: { id: { in: ddgImageIds } } });
    console.log(`  DDG images: cleared ${delImg.count} MediaAsset refs, deleted ${delImg.count} DdgImageResult rows`);
  } else {
    console.log('  DDG images: none found');
  }

  // 3. DDG video results
  const ddgVideos = await prisma.ddgVideoResult.findMany({
    where: { researchJobId: JOB_ID, query: { contains: HANDLE_PATTERN, mode: 'insensitive' } },
    select: { id: true },
  });
  const ddgVideoIds = ddgVideos.map((r) => r.id);
  if (ddgVideoIds.length > 0) {
    await prisma.mediaAsset.updateMany({ where: { ddgVideoResultId: { in: ddgVideoIds } }, data: { ddgVideoResultId: null } });
    const delVid = await prisma.ddgVideoResult.deleteMany({ where: { id: { in: ddgVideoIds } } });
    console.log(`  DDG videos: cleared refs, deleted ${delVid.count} DdgVideoResult rows`);
  } else {
    console.log('  DDG videos: none found');
  }

  // 4. SocialProfile with handle evolving (cascade deletes SocialPost and related MediaAsset links)
  const profiles = await prisma.socialProfile.findMany({
    where: {
      researchJobId: JOB_ID,
      OR: [
        { handle: { contains: HANDLE_PATTERN, mode: 'insensitive' } },
        { handle: { equals: 'evolving.ai', mode: 'insensitive' } },
      ],
    },
    select: { id: true, platform: true, handle: true },
  });
  if (profiles.length > 0) {
    for (const p of profiles) {
      await prisma.socialProfile.delete({ where: { id: p.id } });
      console.log(`  Deleted SocialProfile ${p.platform}:@${p.handle} (id: ${p.id})`);
    }
  } else {
    console.log('  SocialProfile: none found');
  }

  console.log('\n[Fix] Setting client Instagram to @' + CLIENT_INSTAGRAM_FIX + '...');

  // 5. Update job inputData so handles.instagram is eluumis_official
  const inputData = (job.inputData || {}) as Record<string, unknown>;
  const handles = (inputData.handles || {}) as Record<string, string>;
  handles.instagram = CLIENT_INSTAGRAM_FIX;
  inputData.handles = handles;
  await prisma.researchJob.update({
    where: { id: JOB_ID },
    data: { inputData: inputData as object },
  });
  console.log('  ResearchJob.inputData.handles.instagram = @' + CLIENT_INSTAGRAM_FIX);

  // 6. Ensure ClientAccount has instagram = eluumis_official (update existing or create)
  const existingIg = await prisma.clientAccount.findFirst({
    where: { clientId, platform: 'instagram' },
    select: { id: true, handle: true },
  });
  if (existingIg) {
    await prisma.clientAccount.update({
      where: { id: existingIg.id },
      data: { handle: CLIENT_INSTAGRAM_FIX },
    });
    console.log('  ClientAccount instagram: updated to @' + CLIENT_INSTAGRAM_FIX);
  } else {
    await prisma.clientAccount.create({
      data: {
        clientId,
        platform: 'instagram',
        handle: CLIENT_INSTAGRAM_FIX,
      },
    });
    console.log('  ClientAccount instagram: created @' + CLIENT_INSTAGRAM_FIX);
  }

  console.log('\n[Done] Cleaned @evolving* and set client Instagram to @' + CLIENT_INSTAGRAM_FIX);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
