import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { processBrainIntake } from '../services/intake/brain-intake';
import { suggestIntakeCompletion } from '../services/intake/suggest-intake-completion';
import { syncBrainGoals } from '../services/intake/brain-intake-utils';

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

type BrainChannel = { platform: string; handle: string };

function normalizePlatformFromHost(hostname: string): string | null {
  const host = String(hostname || '').replace(/^www\./i, '').toLowerCase();
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('youtube.com')) return 'youtube';
  if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('facebook.com')) return 'facebook';
  return null;
}

function parseChannelFromString(value: string): BrainChannel | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const explicit = raw.match(
    /^(instagram|tiktok|youtube|linkedin|facebook|x|twitter)\s*[:=\-]?\s*@?([a-z0-9._-]{1,80})$/i
  );
  if (explicit) {
    return {
      platform: explicit[1].toLowerCase() === 'twitter' ? 'x' : explicit[1].toLowerCase(),
      handle: explicit[2].replace(/^@+/, '').toLowerCase(),
    };
  }

  const normalized = /^[a-z]+:\/\//i.test(raw)
    ? raw
    : /^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)
      ? `https://${raw}`
      : null;
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const platform = normalizePlatformFromHost(parsed.hostname);
    if (!platform) return null;
    const firstPath = parsed.pathname
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)[0];
    if (!firstPath) return null;
    return {
      platform,
      handle: firstPath.replace(/^@+/, '').toLowerCase(),
    };
  } catch {
    return null;
  }
}

function normalizeBrainChannels(value: unknown): BrainChannel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: BrainChannel[] = [];

  for (const row of value) {
    let parsed: BrainChannel | null = null;
    if (row && typeof row === 'object') {
      const platform = String((row as Record<string, unknown>).platform || '').trim().toLowerCase();
      const handle = String((row as Record<string, unknown>).handle || '')
        .trim()
        .replace(/^@+/, '')
        .toLowerCase();
      if (platform && handle) {
        parsed = { platform: platform === 'twitter' ? 'x' : platform, handle };
      }
    } else if (typeof row === 'string') {
      parsed = parseChannelFromString(row);
    }

    if (!parsed) continue;
    const key = `${parsed.platform}:${parsed.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }

  return out;
}

function normalizeGoalList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
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
 * POST /api/clients/suggest-intake-completion
 * Suggest values for missing intro form fields using OpenAI. No DB writes.
 * Body: partial intake payload (at least one of name, website, niche, or one handle).
 */
router.post('/suggest-intake-completion', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const hasName = String(body.name || '').trim().length > 0;
    const hasWebsite = String(body.website || '').trim().length > 0;
    const hasNiche = String(body.niche || '').trim().length > 0;
    const handles = body.handles && typeof body.handles === 'object' ? body.handles : {};
    const hasHandle = Object.values(handles).some((v) => String(v || '').trim().length > 0);
    if (!hasName && !hasWebsite && !hasNiche && !hasHandle) {
      return res.status(400).json({
        success: false,
        error: 'At least one of name, website, niche, or one social handle is required',
      });
    }
    const result = await suggestIntakeCompletion(body as Record<string, unknown>);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[API] suggest-intake-completion failed:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to suggest intake completion',
    });
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
    const normalizedChannels = normalizeBrainChannels(payload.channels);
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
        channels: normalizedChannels,
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
        channels: normalizedChannels || [],
        constraints: payload.constraints && typeof payload.constraints === 'object' ? payload.constraints : {},
      },
      include: { goals: true },
    });

    const primaryGoal =
      typeof payload.primaryGoal === 'string'
        ? payload.primaryGoal.trim() || null
        : profile.primaryGoal
          ? String(profile.primaryGoal).trim() || null
          : null;
    const secondaryGoals =
      payload.secondaryGoals !== undefined
        ? normalizeGoalList(payload.secondaryGoals)
        : normalizeGoalList(profile.secondaryGoals);

    await syncBrainGoals(profile.id, primaryGoal, secondaryGoals);

    const refreshedProfile = await prisma.brainProfile.findUnique({
      where: { id: profile.id },
      include: { goals: true },
    });

    return res.json({ success: true, brainProfile: refreshedProfile || profile });
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
