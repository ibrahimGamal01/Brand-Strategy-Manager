import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { SECTION_CONFIG, type SectionConfig } from './intelligence-crud-config';

const router = Router();

const parseBoolean = (value: unknown) => (typeof value === 'boolean' ? value : typeof value === 'string' ? ({ true: true, false: false } as Record<string, boolean>)[value.toLowerCase()] : undefined);
const parseNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined);
const parseDate = (value: unknown) => (value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined);
const parseJsonArray = (value: unknown) => (Array.isArray(value) ? value : typeof value === 'string' && value.trim().startsWith('[') ? JSON.parse(value) : typeof value === 'string' ? value.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
const getActor = (req: any) => String(req.headers['x-bat-actor'] || req.headers['x-user-id'] || 'admin-ui');
const getDelegate = (config: SectionConfig) => (prisma as any)[config.model];
const resolveSection = (section: string) => SECTION_CONFIG[normalize(section)] ? { key: normalize(section), config: SECTION_CONFIG[normalize(section)] } : null;

async function getJobOrThrow(jobId: string) {
  const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { id: true, clientId: true } });
  if (!job) throw new Error('Research job not found');
  return job;
}

function parsePayload(section: string, config: SectionConfig, raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!config.allowedFields.includes(key)) {
      errors.push(`Unknown or disallowed field: ${key}`);
      continue;
    }
    if (value === undefined) continue;
    if (value === null) { out[key] = null; continue; }
    if (config.numberFields?.includes(key)) { const parsed = parseNumber(value); if (!Number.isFinite(parsed as number)) errors.push(`Invalid number for ${key}`); else out[key] = parsed; continue; }
    if (config.booleanFields?.includes(key)) { const parsed = parseBoolean(value); if (parsed === undefined) errors.push(`Invalid boolean for ${key}`); else out[key] = parsed; continue; }
    if (config.dateFields?.includes(key)) { const parsed = parseDate(value); if (!parsed || Number.isNaN(parsed.getTime())) errors.push(`Invalid date for ${key}`); else out[key] = parsed; continue; }
    if (config.jsonArrayFields?.includes(key)) { try { const parsed = parseJsonArray(value); if (!Array.isArray(parsed)) throw new Error('bad array'); out[key] = parsed; } catch { errors.push(`Invalid array for ${key}`); } continue; }
    if (config.enumFields?.[key]) {
      const enumSet = config.enumFields[key];
      const normalizedValue = String(value).toUpperCase();
      if (!enumSet.has(normalizedValue)) errors.push(`Invalid value for ${key}: ${value}`);
      else out[key] = normalizedValue;
      continue;
    }
    out[key] = value;
  }
  if (section === 'competitors' && typeof out.typeConfidence === 'number') out.typeConfidence = Math.max(0, Math.min(1, out.typeConfidence as number));
  return { data: out, errors };
}

function applyMutationMetadata(data: Record<string, unknown>, actor: string, unarchive = false) {
  data.manuallyModified = true;
  data.lastModifiedAt = new Date();
  data.lastModifiedBy = actor;
  if (unarchive) {
    data.isActive = true;
    data.archivedAt = null;
    data.archivedBy = null;
  }
  return data;
}

function ensureRequired(config: SectionConfig, data: Record<string, unknown>) {
  const missing = (config.requiredOnCreate || []).filter((field) => !(field in data) || data[field] == null || String(data[field]).trim() === '');
  return missing;
}

function enforceImmutable(config: SectionConfig, data: Record<string, unknown>) {
  return Object.keys(data).filter((field) => config.immutableFields?.includes(field));
}

async function scopedWhere(config: SectionConfig, job: { id: string; clientId: string }, includeInactive = false) {
  const where: Record<string, unknown> = config.scope === 'client' ? { clientId: job.clientId } : { researchJobId: job.id };
  if (config.supportsCuration && !includeInactive) where.isActive = true;
  return where;
}

router.get('/:id/intelligence/:section', async (req, res) => {
  try {
    const resolved = resolveSection(req.params.section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(req.params.id);
    const includeInactive = parseBoolean(req.query.includeInactive) === true;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const where = await scopedWhere(resolved.config, job, includeInactive);
    const orderBy = resolved.config.orderBy ? { [resolved.config.orderBy.field]: resolved.config.orderBy.direction } : undefined;
    const data = await getDelegate(resolved.config).findMany({ where, take: limit, ...(orderBy ? { orderBy } : {}) });
    return res.json({ success: true, section: resolved.key, includeInactive, data });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch section data', details: error.message });
  }
});

router.post('/:id/intelligence/:section', async (req, res) => {
  try {
    const resolved = resolveSection(req.params.section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(req.params.id);
    const actor = getActor(req);
    const rawData = (req.body?.data || req.body || {}) as Record<string, unknown>;
    const parsed = parsePayload(resolved.key, resolved.config, rawData);
    const requiredMissing = ensureRequired(resolved.config, parsed.data);
    if (parsed.errors.length || requiredMissing.length) return res.status(400).json({ error: 'Validation failed', details: [...parsed.errors, ...requiredMissing.map((f) => `Missing required field: ${f}`)] });
    const data = applyMutationMetadata(parsed.data, actor, true);
    if (resolved.config.scope === 'client') data.clientId = job.clientId; else data.researchJobId = job.id;

    if (resolved.key === 'competitors') {
      data.handle = String(data.handle || '').replace(/^@+/, '').trim().toLowerCase();
      data.platform = String(data.platform || '').trim().toLowerCase();
      if (!data.handle || !data.platform) return res.status(400).json({ error: 'Validation failed', details: ['Competitor handle/platform are required'] });
      const competitor = await prisma.competitor.upsert({ where: { clientId_platform_handle: { clientId: job.clientId, platform: data.platform as string, handle: data.handle as string } }, update: {}, create: { clientId: job.clientId, platform: data.platform as string, handle: data.handle as string } });
      data.competitorId = competitor.id;
    }

    const identityWhere = resolved.config.identityFields?.every((field) => data[field] != null)
      ? Object.fromEntries(resolved.config.identityFields!.map((field) => [field, data[field]]))
      : null;
    if (identityWhere) {
      const existing = await getDelegate(resolved.config).findFirst({ where: { ...(await scopedWhere(resolved.config, job, true)), ...identityWhere } });
      if (existing) {
        const updated = await getDelegate(resolved.config).update({ where: { id: existing.id }, data });
        return res.json({ success: true, section: resolved.key, data: updated, reactivated: true });
      }
    }

    const created = await getDelegate(resolved.config).create({ data });
    return res.json({ success: true, section: resolved.key, data: created });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to create data point', details: error.message });
  }
});

router.patch('/:id/intelligence/:section/:itemId', async (req, res) => {
  try {
    const resolved = resolveSection(req.params.section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(req.params.id);
    const where = await scopedWhere(resolved.config, job, true);
    const existing = await getDelegate(resolved.config).findFirst({ where: { ...where, id: req.params.itemId } });
    if (!existing) return res.status(404).json({ error: 'Data point not found in this research job' });
    const actor = getActor(req);
    const rawData = (req.body?.data || req.body || {}) as Record<string, unknown>;
    const parsed = parsePayload(resolved.key, resolved.config, rawData);
    const immutableTouched = enforceImmutable(resolved.config, parsed.data);
    if (immutableTouched.length) parsed.errors.push(`Immutable fields cannot be edited directly: ${immutableTouched.join(', ')}`);
    if (parsed.errors.length || Object.keys(parsed.data).length === 0) return res.status(400).json({ error: 'Validation failed', details: parsed.errors.length ? parsed.errors : ['No valid fields to update'] });
    const data = applyMutationMetadata(parsed.data, actor);
    const updated = await getDelegate(resolved.config).update({ where: { id: req.params.itemId }, data });
    return res.json({ success: true, section: resolved.key, data: updated });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to update data point', details: error.message });
  }
});

router.post('/:id/intelligence/:section/:itemId/restore', async (req, res) => {
  try {
    const resolved = resolveSection(req.params.section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(req.params.id);
    const actor = getActor(req);
    const where = await scopedWhere(resolved.config, job, true);
    const existing = await getDelegate(resolved.config).findFirst({ where: { ...where, id: req.params.itemId } });
    if (!existing) return res.status(404).json({ error: 'Data point not found in this research job' });
    const restored = await getDelegate(resolved.config).update({ where: { id: req.params.itemId }, data: applyMutationMetadata({ isActive: true, archivedAt: null, archivedBy: null }, actor, true) });
    return res.json({ success: true, section: resolved.key, data: restored });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to restore data point', details: error.message });
  }
});

router.delete('/:id/intelligence/:section/:itemId', async (req, res) => {
  try {
    const resolved = resolveSection(req.params.section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(req.params.id);
    const where = await scopedWhere(resolved.config, job, true);
    const existing = await getDelegate(resolved.config).findFirst({ where: { ...where, id: req.params.itemId } });
    if (!existing) return res.status(404).json({ error: 'Data point not found in this research job' });
    const hardDelete = parseBoolean(req.query.hard) === true && req.headers['x-admin-secret'] === process.env.ADMIN_SECRET;
    if (hardDelete) {
      await getDelegate(resolved.config).delete({ where: { id: req.params.itemId } });
      return res.json({ success: true, section: resolved.key, deletedId: req.params.itemId, hard: true });
    }
    const archived = await getDelegate(resolved.config).update({ where: { id: req.params.itemId }, data: applyMutationMetadata({ isActive: false, archivedAt: new Date(), archivedBy: getActor(req) }, getActor(req)) });
    return res.json({ success: true, section: resolved.key, archivedId: archived.id });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to archive data point', details: error.message });
  }
});

router.delete('/:id/intelligence/:section', async (req, res) => {
  try {
    const resolved = resolveSection(req.params.section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(req.params.id);
    const hardDelete = parseBoolean(req.query.hard) === true && req.headers['x-admin-secret'] === process.env.ADMIN_SECRET;
    const where = await scopedWhere(resolved.config, job, false);
    if (hardDelete) {
      const deleted = await getDelegate(resolved.config).deleteMany({ where });
      return res.json({ success: true, section: resolved.key, deletedCount: deleted.count, hard: true });
    }
    const archived = await getDelegate(resolved.config).updateMany({
      where,
      data: applyMutationMetadata({ isActive: false, archivedAt: new Date(), archivedBy: getActor(req) }, getActor(req)),
    });
    return res.json({ success: true, section: resolved.key, archivedCount: archived.count });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to clear section', details: error.message });
  }
});

export default router;
