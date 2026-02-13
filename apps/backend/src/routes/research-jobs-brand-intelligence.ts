import { Router, Request, Response } from 'express';
import {
  getBrandIntelligenceSummary,
  orchestrateBrandIntelligenceForJob,
} from '../services/brand-intelligence/orchestrator';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRunId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim();
  if (!UUID_REGEX.test(normalized)) {
    throw new Error('runId must be a valid UUID');
  }
  return normalized;
}

router.post('/:id/brand-intelligence/orchestrate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await orchestrateBrandIntelligenceForJob(id, {
      mode: req.body?.mode,
      modules: req.body?.modules,
      moduleInputs: req.body?.moduleInputs,
      runReason: req.body?.runReason,
    });

    return res.json({ success: true, ...result });
  } catch (error: any) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const code = String(error?.code || 'BRAND_INTEL_UNKNOWN');
    return res.status(status).json({
      success: false,
      error: error?.message || 'Brand intelligence orchestration failed',
      code,
    });
  }
});

router.get('/:id/brand-intelligence/summary', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const runIdRaw = Array.isArray(req.query.runId) ? req.query.runId[0] : req.query.runId;
    const runId = parseRunId(runIdRaw);

    const result = await getBrandIntelligenceSummary(id, runId);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const code = String(error?.code || 'BRAND_INTEL_UNKNOWN');
    return res.status(status).json({
      success: false,
      error: error?.message || 'Failed to fetch brand intelligence summary',
      code,
    });
  }
});

export default router;
