import { Router } from 'express';
import {
  crawlAndPersistWebSources,
  extractFromWebSnapshot,
  fetchAndPersistWebSnapshot,
  listWebSnapshots,
  listWebSources,
  resolveAllowedDomainsForJob,
} from '../services/scraping/web-intelligence-service';

const router = Router();

const parseBoolean = (value: unknown) =>
  typeof value === 'boolean'
    ? value
    : typeof value === 'string'
      ? ({ true: true, false: false } as Record<string, boolean>)[value.toLowerCase()]
      : undefined;

router.get('/:id/web/allowed-domains', async (req, res) => {
  try {
    const domains = await resolveAllowedDomainsForJob(req.params.id);
    return res.json({ ok: true, domains });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to resolve allowed domains', details: error.message });
  }
});

router.get('/:id/web/sources', async (req, res) => {
  try {
    const includeInactive = parseBoolean(req.query.includeInactive) === true;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const sources = await listWebSources(req.params.id, includeInactive, limit);
    return res.json({ ok: true, includeInactive, data: sources });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to list web sources', details: error.message });
  }
});

router.get('/:id/web/snapshots', async (req, res) => {
  try {
    const includeInactive = parseBoolean(req.query.includeInactive) === true;
    const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const snapshots = await listWebSnapshots(req.params.id, sourceId, includeInactive, limit);
    return res.json({ ok: true, includeInactive, data: snapshots });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to list web snapshots', details: error.message });
  }
});

router.post('/:id/web/fetch', async (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const url = String(body.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url is required' });

    const result = await fetchAndPersistWebSnapshot({
      researchJobId: req.params.id,
      url,
      sourceType: typeof body.sourceType === 'string' ? body.sourceType : undefined,
      discoveredBy: typeof body.discoveredBy === 'string' ? body.discoveredBy : 'CHAT_TOOL',
      mode: typeof body.mode === 'string' ? (body.mode.toUpperCase() as any) : 'AUTO',
      sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : undefined,
      allowExternal: parseBoolean(body.allowExternal) === true,
    });

    return res.json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch web page', details: error.message });
  }
});

router.post('/:id/web/crawl', async (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const startUrls = Array.isArray(body.startUrls)
      ? body.startUrls.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (!startUrls.length) {
      return res.status(400).json({ error: 'startUrls[] is required for crawl' });
    }

    const result = await crawlAndPersistWebSources({
      researchJobId: req.params.id,
      startUrls,
      maxPages: Number.isFinite(Number(body.maxPages)) ? Number(body.maxPages) : undefined,
      maxDepth: Number.isFinite(Number(body.maxDepth)) ? Number(body.maxDepth) : undefined,
      mode: typeof body.mode === 'string' ? (body.mode.toUpperCase() as any) : 'AUTO',
      allowExternal: parseBoolean(body.allowExternal) === true,
    });

    return res.json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to crawl web sources', details: error.message });
  }
});

router.post('/:id/web/extract', async (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const snapshotId = String(body.snapshotId || '').trim();
    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    const result = await extractFromWebSnapshot({
      researchJobId: req.params.id,
      snapshotId,
      recipeId: typeof body.recipeId === 'string' ? body.recipeId : undefined,
      recipeSchema:
        body.recipeSchema && typeof body.recipeSchema === 'object'
          ? (body.recipeSchema as Record<string, unknown>)
          : undefined,
      adaptiveNamespace:
        typeof body.adaptiveNamespace === 'string' ? body.adaptiveNamespace : undefined,
    });

    return res.json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to extract web snapshot', details: error.message });
  }
});

export default router;
