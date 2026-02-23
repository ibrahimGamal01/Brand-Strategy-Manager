import { prisma } from '../../lib/prisma';
import { renderDocumentHtml } from './document-render';
import { saveDocumentBuffer } from './document-storage';
import { renderPdfFromHtml } from './pdf-renderer';
import type { DocumentDataPayload, DocumentPlan, GeneratedDocument, TopPostRow } from './document-spec';

function normalizePlan(plan: Partial<DocumentPlan> = {}): DocumentPlan {
  return {
    docType: (plan.docType || 'STRATEGY_BRIEF') as DocumentPlan['docType'],
    title: typeof plan.title === 'string' && plan.title.trim() ? plan.title.trim() : undefined,
    audience: typeof plan.audience === 'string' && plan.audience.trim() ? plan.audience.trim() : 'Marketing team',
    timeframeDays: Number.isFinite(Number(plan.timeframeDays)) ? Math.max(7, Math.min(365, Number(plan.timeframeDays))) : 90,
    depth: (plan.depth || 'standard') as DocumentPlan['depth'],
    includeCompetitors: plan.includeCompetitors ?? true,
    includeEvidenceLinks: plan.includeEvidenceLinks ?? true,
  };
}

function scorePost(post: {
  likesCount: number | null;
  commentsCount: number | null;
  sharesCount: number | null;
  viewsCount: number | null;
}): number {
  return (post.likesCount || 0) + (post.commentsCount || 0) + (post.sharesCount || 0) + Math.round((post.viewsCount || 0) * 0.1);
}

function resolvePostUrl(post: { url: string | null; metadata: unknown }): string | null {
  if (post.url) return post.url;
  const metadata = post.metadata as Record<string, unknown> | null;
  if (typeof metadata?.permalink === 'string') return metadata.permalink;
  if (typeof metadata?.url === 'string') return metadata.url;
  return null;
}

async function buildPayload(researchJobId: string, plan: DocumentPlan): Promise<{ payload: DocumentDataPayload; clientId: string }> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          brainProfile: true,
        },
      },
    },
  });

  if (!job) {
    throw new Error('Research job not found');
  }

  const competitors = plan.includeCompetitors
    ? await prisma.discoveredCompetitor.findMany({
        where: { researchJobId },
        orderBy: [{ displayOrder: 'asc' }, { relevanceScore: 'desc' }],
        take: 30,
      })
    : [];

  const postsRaw = await prisma.socialPost.findMany({
    where: {
      socialProfile: {
        researchJobId,
      },
    },
    include: {
      socialProfile: {
        select: { handle: true, platform: true },
      },
    },
    take: 80,
  });

  const topPosts: TopPostRow[] = postsRaw
    .sort((a, b) => scorePost(b) - scorePost(a))
    .slice(0, 20)
    .map((post) => ({
      handle: post.socialProfile.handle,
      platform: post.socialProfile.platform,
      caption: (post.caption || '').slice(0, 220),
      postUrl: resolvePostUrl(post),
      postedAt: post.postedAt ? post.postedAt.toISOString() : null,
      likes: post.likesCount || 0,
      comments: post.commentsCount || 0,
      shares: post.sharesCount || 0,
      views: post.viewsCount || 0,
    }));

  const payload: DocumentDataPayload = {
    generatedAt: new Date().toISOString(),
    clientName: job.client.name,
    businessType: job.client.brainProfile?.businessType || 'Not specified',
    primaryGoal: job.client.brainProfile?.primaryGoal || 'Not specified',
    targetMarket: job.client.brainProfile?.targetMarket || 'Not specified',
    websiteDomain: job.client.brainProfile?.websiteDomain || 'Not specified',
    audience: plan.audience || 'Marketing team',
    timeframeDays: plan.timeframeDays || 90,
    competitors: competitors.map((row) => ({
      handle: row.handle,
      platform: row.platform,
      selectionState: row.selectionState,
      relevanceScore: row.relevanceScore,
      availabilityStatus: row.availabilityStatus,
      profileUrl: row.profileUrl,
      reason: row.selectionReason,
    })),
    topPosts,
  };

  return { payload, clientId: job.clientId };
}

function resolveTitle(plan: DocumentPlan, clientName: string): string {
  if (plan.title) return plan.title;
  if (plan.docType === 'COMPETITOR_AUDIT') return `${clientName} Competitor Audit`;
  if (plan.docType === 'CONTENT_CALENDAR') return `${clientName} Content Calendar`;
  return `${clientName} Strategy Brief`;
}

export async function generateDocumentForResearchJob(
  researchJobId: string,
  planInput: Partial<DocumentPlan>,
): Promise<GeneratedDocument> {
  const plan = normalizePlan(planInput);
  const { payload, clientId } = await buildPayload(researchJobId, plan);
  const title = resolveTitle(plan, payload.clientName);

  const html = renderDocumentHtml(plan, payload);
  const pdfBuffer = await renderPdfFromHtml(html);
  const stored = await saveDocumentBuffer(researchJobId, title, pdfBuffer);

  const clientDocument = await prisma.clientDocument.create({
    data: {
      clientId,
      docType: 'OTHER',
      fileName: stored.fileName,
      filePath: stored.storagePath,
      mimeType: 'application/pdf',
      fileSizeBytes: stored.sizeBytes,
      extractedText: null,
      isProcessed: true,
    },
    select: { id: true, uploadedAt: true },
  });

  return {
    docId: stored.id,
    title,
    mimeType: 'application/pdf',
    storagePath: stored.storagePath,
    sizeBytes: stored.sizeBytes,
    createdAt: clientDocument.uploadedAt.toISOString(),
    clientDocumentId: clientDocument.id,
  };
}

export async function listGeneratedDocuments(researchJobId: string) {
  const job = await prisma.researchJob.findUnique({ where: { id: researchJobId }, select: { clientId: true } });
  if (!job) throw new Error('Research job not found');

  return prisma.clientDocument.findMany({
    where: {
      clientId: job.clientId,
      mimeType: 'application/pdf',
      filePath: { contains: `/docs/${researchJobId}/` },
    },
    orderBy: { uploadedAt: 'desc' },
    take: 50,
  });
}

export async function getGeneratedDocumentById(researchJobId: string, documentId: string) {
  const documents = await listGeneratedDocuments(researchJobId);
  return documents.find((doc) => doc.id === documentId) || null;
}
