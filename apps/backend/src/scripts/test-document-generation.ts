import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { generateDocumentForResearchJob } from '../services/documents/document-service';
import { STORAGE_ROOT } from '../services/storage/storage-root';

async function run(): Promise<void> {
  const suffix = Date.now().toString(36);
  const client = await prisma.client.create({ data: { name: `Document Test ${suffix}` } });

  let generatedStoragePath: string | null = null;
  try {
    const job = await prisma.researchJob.create({
      data: {
        clientId: client.id,
        status: 'PENDING',
      },
    });

    await prisma.brainProfile.create({
      data: {
        clientId: client.id,
        businessType: 'Wellness',
        primaryGoal: 'Increase qualified leads',
        targetMarket: 'US consumers',
      },
    });

    const profile = await prisma.socialProfile.create({
      data: {
        researchJobId: job.id,
        platform: 'instagram',
        handle: `doc_handle_${suffix}`,
      },
    });

    await prisma.socialPost.create({
      data: {
        socialProfileId: profile.id,
        externalId: `doc_post_${suffix}`,
        caption: 'Strong hook and clear CTA content sample.',
        likesCount: 120,
        commentsCount: 16,
        sharesCount: 9,
      },
    });

    await prisma.discoveredCompetitor.create({
      data: {
        researchJobId: job.id,
        handle: `competitor_${suffix}`,
        platform: 'instagram',
        selectionState: 'APPROVED',
        relevanceScore: 0.88,
      },
    });

    const document = await generateDocumentForResearchJob(job.id, {
      docType: 'COMPETITOR_AUDIT',
      audience: 'Executive team',
      timeframeDays: 60,
    });

    generatedStoragePath = document.storagePath;
    assert.equal(document.mimeType, 'application/pdf');
    assert.ok(document.clientDocumentId);
    assert.ok(document.sizeBytes > 1000, `Expected PDF size > 1000 bytes, got ${document.sizeBytes}`);

    const absPath = path.join(STORAGE_ROOT, document.storagePath.replace(/^storage\//, ''));
    const stats = await fs.promises.stat(absPath);
    assert.ok(stats.size > 1000);

    console.log('Document generation test passed.');
  } finally {
    await prisma.client.delete({ where: { id: client.id } }).catch(() => undefined);
    if (generatedStoragePath) {
      const absPath = path.join(STORAGE_ROOT, generatedStoragePath.replace(/^storage\//, ''));
      await fs.promises.unlink(absPath).catch(() => undefined);
    }
  }
}

run()
  .catch((error) => {
    console.error('Document generation test failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
