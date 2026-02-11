import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { processBrainIntake } from '../services/intake/brain-intake';

const router = Router();

function isValidationError(message: string): boolean {
  return message.includes('required') || message.includes('At least one');
}

function mapLegacyPayload(body: any): Record<string, unknown> {
  const handles = body?.handles && typeof body.handles === 'object' ? body.handles : undefined;
  return {
    name: body?.name,
    niche: body?.niche,
    businessType: body?.businessType || body?.niche,
    handles,
    handle: body?.handle,
    platform: body?.platform || 'instagram',
    channels: body?.channels,
    forceNew: Boolean(body?.forceNew),
    primaryGoal: body?.primaryGoal || body?.goal || '',
    futureGoal: body?.futureGoal || '',
    targetAudience: body?.targetAudience || '',
    website: body?.website || '',
    constraints: body?.constraints || {},
    intakeVersion: 'legacy-compat',
  };
}

/**
 * GET /api/clients
 * List all clients.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        clientAccounts: true,
        personas: true,
        researchJobs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
    return res.json(clients);
  } catch (error: any) {
    console.error('[API] Error fetching clients:', error);
    return res.status(500).json({ error: 'Failed to fetch clients', details: error.message });
  }
});

/**
 * POST /api/clients/intake-v2
 * Create/update client with richer brain intake context and bootstrap research.
 */
router.post('/intake-v2', async (req: Request, res: Response) => {
  try {
    const result = await processBrainIntake(req.body || {});
    return res.json(result);
  } catch (error: any) {
    const message = error?.message || 'Failed to process intake';
    if (isValidationError(message)) {
      return res.status(400).json({ success: false, error: message });
    }
    console.error('[API] Intake v2 failed:', error);
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * PATCH /api/clients/:id/brain-profile
 * Update mutable business brain context for a client.
 */
router.patch('/:id/brain-profile', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const website = String(payload.website || payload.websiteDomain || '').trim();
    const profile = await prisma.brainProfile.upsert({
      where: { clientId: id },
      update: {
        businessType: payload.businessType ?? undefined,
        offerModel: payload.offerModel ?? undefined,
        primaryGoal: payload.primaryGoal ?? undefined,
        secondaryGoals: Array.isArray(payload.secondaryGoals) ? payload.secondaryGoals : undefined,
        targetMarket: payload.targetMarket ?? payload.targetAudience ?? undefined,
        geoScope: payload.geoScope ?? undefined,
        websiteDomain: website ? website.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined,
        channels: Array.isArray(payload.channels) ? payload.channels : undefined,
        constraints: payload.constraints && typeof payload.constraints === 'object' ? payload.constraints : undefined,
      },
      create: {
        clientId: id,
        businessType: payload.businessType || null,
        offerModel: payload.offerModel || null,
        primaryGoal: payload.primaryGoal || null,
        secondaryGoals: Array.isArray(payload.secondaryGoals) ? payload.secondaryGoals : [],
        targetMarket: payload.targetMarket || payload.targetAudience || null,
        geoScope: payload.geoScope || null,
        websiteDomain: website ? website.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null,
        channels: Array.isArray(payload.channels) ? payload.channels : [],
        constraints: payload.constraints && typeof payload.constraints === 'object' ? payload.constraints : {},
      },
    });

    return res.json({ success: true, brainProfile: profile });
  } catch (error: any) {
    console.error('[API] Failed to update brain profile:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to update brain profile' });
  }
});

/**
 * POST /api/clients
 * Legacy-compatible intake endpoint mapped to Brain V3 flow.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await processBrainIntake(mapLegacyPayload(req.body || {}));
    return res.json(result);
  } catch (error: any) {
    const message = error?.message || 'Failed to create client';
    if (isValidationError(message)) {
      return res.status(400).json({ success: false, error: message });
    }
    console.error('[API] Error creating client:', error);
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
