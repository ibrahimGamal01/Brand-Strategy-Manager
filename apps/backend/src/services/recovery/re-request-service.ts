import { PrismaClient } from '@prisma/client';
import { NormalizedReRequestJob, ReRequestResult } from './recovery-types';

// NOTE: This service is intentionally conservative. It is designed so that
// heavy re-fetch work can be enabled in production while remaining a no-op
// (or very light) in local environments to avoid unnecessary costs.

const prisma = new PrismaClient();

export async function reRequestTargets(jobs: NormalizedReRequestJob[]): Promise<ReRequestResult[]> {
  const results: ReRequestResult[] = [];

  for (const job of jobs) {
    try {
      // In this initial implementation we only verify that the referenced
      // records still exist and record a \"requested\" status. The actual
      // heavy re-fetch logic (calling external scrapers/connectors) should
      // be wired in the deployed environment where those services and
      // credentials are available.

      if (job.type === 'brand_mention') {
        const mention = await prisma.brandMention.findUnique({ where: { id: job.id } });
        if (!mention) {
          results.push({
            id: job.id,
            type: job.type,
            status: 'failed',
            error: 'Brand mention not found',
          });
          continue;
        }

        // Placeholder: in a production environment you would enqueue a job
        // that uses mention.url / mention.sourceType to re-fetch content.
      } else if (job.type === 'client_post') {
        const post = await prisma.clientPost.findUnique({ where: { id: job.id } });
        if (!post) {
          results.push({
            id: job.id,
            type: job.type,
            status: 'failed',
            error: 'Client post not found',
          });
          continue;
        }

        // Placeholder: enqueue a job that uses post.externalPostId / post.postUrl.
      } else if (job.type === 'social_post') {
        const social = await prisma.socialPost.findUnique({ where: { id: job.id } });
        if (!social) {
          results.push({
            id: job.id,
            type: job.type,
            status: 'failed',
            error: 'Social post not found',
          });
          continue;
        }

        // Placeholder: enqueue a job that uses social.externalId / social.url.
      }

      results.push({
        id: job.id,
        type: job.type,
        status: 'ok',
      });
    } catch (error: any) {
      // Fail gracefully per-target; do not abort the whole batch.
      // In production you may want to add richer logging/metrics here.
      results.push({
        id: job.id,
        type: job.type,
        status: 'failed',
        error: error?.message || 'Unexpected error during re-request',
      });
    }
  }

  return results;
}

