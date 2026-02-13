import { Router, Request, Response } from 'express';
import { NormalizedReRequestJob, ReRequestResult, ReRequestTarget, ReRequestTargetKind } from '../services/recovery/recovery-types';
import { reRequestTargets } from '../services/recovery/re-request-service';

const router = Router();

const ALLOWED_KINDS: ReRequestTargetKind[] = ['brand_mention', 'client_post', 'social_post'];
const MAX_TARGETS_PER_REQUEST = 50;
const MAX_REQUESTS_PER_HOUR = 500;

const recentBatches: Array<{ timestamp: number; count: number }> = [];

function recordBatch(count: number) {
  const now = Date.now();
  recentBatches.push({ timestamp: now, count });
  const cutoff = now - 60 * 60 * 1000;
  while (recentBatches.length && recentBatches[0].timestamp < cutoff) {
    recentBatches.shift();
  }
}

function getRecentCount(): number {
  const cutoff = Date.now() - 60 * 60 * 1000;
  return recentBatches
    .filter((b) => b.timestamp >= cutoff)
    .reduce((sum, b) => sum + b.count, 0);
}

function parseTargets(body: any): ReRequestTarget[] {
  if (!body || !Array.isArray(body.targets)) {
    throw new Error('Invalid payload: expected { targets: ReRequestTarget[] }');
  }

  if (body.targets.length === 0) {
    throw new Error('At least one target is required');
  }

  if (body.targets.length > MAX_TARGETS_PER_REQUEST) {
    throw new Error(`Too many targets in a single request (max ${MAX_TARGETS_PER_REQUEST})`);
  }

  const parsed: ReRequestTarget[] = [];

  for (const raw of body.targets) {
    const kind = String(raw?.kind || '') as ReRequestTargetKind;
    const id = String(raw?.id || '').trim();

    if (!ALLOWED_KINDS.includes(kind)) {
      throw new Error(`Unsupported target kind: ${raw?.kind}`);
    }
    if (!id) {
      throw new Error('Each target must include a non-empty id');
    }

    parsed.push({ kind, id });
  }

  return parsed;
}

function normalizeTargets(targets: ReRequestTarget[]): NormalizedReRequestJob[] {
  return targets.map((target) => ({
    type: target.kind,
    id: target.id,
  }));
}

router.post('/re-request', async (req: Request, res: Response) => {
  try {
    const recoveryEnabled = process.env.RECOVERY_ENABLED === 'true';
    const totalLastHour = getRecentCount();

    if (totalLastHour >= MAX_REQUESTS_PER_HOUR) {
      return res.status(429).json({
        success: false,
        error: `Re-request rate limit exceeded (max ${MAX_REQUESTS_PER_HOUR} targets/hour). Try again later.`,
      });
    }

    const targets = parseTargets(req.body);
    const jobs = normalizeTargets(targets);

    recordBatch(jobs.length);

    if (!recoveryEnabled) {
      const skipped: ReRequestResult[] = jobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: 'skipped',
        error: 'Recovery is disabled in this environment',
      }));

      return res.status(200).json({
        success: true,
        mode: 'noop',
        requested: jobs.length,
        results: skipped,
      });
    }

    const results = await reRequestTargets(jobs);

    const failed = results.filter((r) => r.status === 'failed');

    return res.status(failed.length > 0 ? 207 : 200).json({
      success: failed.length === 0,
      mode: 'active',
      requested: jobs.length,
      failed: failed.length,
      results,
    });
  } catch (error: any) {
    console.error('[Recovery] Failed to handle re-request:', error);
    return res.status(400).json({
      success: false,
      error: error?.message || 'Invalid re-request payload',
    });
  }
});

export default router;

