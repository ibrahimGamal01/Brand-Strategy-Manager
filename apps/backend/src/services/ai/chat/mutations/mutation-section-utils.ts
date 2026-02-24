import { prisma } from '../../../../lib/prisma';
import { SECTION_CONFIG, type SectionConfig } from '../../../../routes/intelligence-crud-config';

type MutationScope = {
  researchJobId: string;
  clientId: string;
};

const parseBoolean = (value: unknown) =>
  typeof value === 'boolean'
    ? value
    : typeof value === 'string'
      ? ({ true: true, false: false } as Record<string, boolean>)[value.toLowerCase()]
      : undefined;

const parseNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;

const parseDate = (value: unknown) =>
  value instanceof Date ? value : typeof value === 'string' && value.trim() ? new Date(value) : undefined;

const parseJsonArray = (value: unknown) =>
  Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim().startsWith('[')
      ? JSON.parse(value)
      : typeof value === 'string'
        ? value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : undefined;

export function normalizeSection(section: string): string {
  const normalized = String(section || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-/g, '_');
  return normalized;
}

export function resolveSection(section: string): { key: string; config: SectionConfig } {
  const key = normalizeSection(section);
  const config = SECTION_CONFIG[key];
  if (!config) throw new Error(`Unsupported mutation section: ${section}`);
  return { key, config };
}

export function getDelegate(config: SectionConfig): any {
  return (prisma as any)[config.model];
}

export async function resolveScope(researchJobId: string): Promise<MutationScope> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { clientId: true },
  });
  if (!job?.clientId) throw new Error('Research job not found.');
  return { researchJobId, clientId: job.clientId };
}

export function scopedWhere(config: SectionConfig, scope: MutationScope, includeInactive = false): Record<string, unknown> {
  const where: Record<string, unknown> =
    config.scope === 'client'
      ? { clientId: scope.clientId }
      : { researchJobId: scope.researchJobId };
  if (config.supportsCuration && !includeInactive) where.isActive = true;
  return where;
}

export function sanitizeData(
  section: string,
  config: SectionConfig,
  rawData: Record<string, unknown> = {},
): { data: Record<string, unknown>; errors: string[] } {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, value] of Object.entries(rawData)) {
    if (!config.allowedFields.includes(key)) {
      errors.push(`Unknown or disallowed field: ${key}`);
      continue;
    }
    if (value === undefined) continue;
    if (value === null) {
      data[key] = null;
      continue;
    }
    if (config.numberFields?.includes(key)) {
      const parsed = parseNumber(value);
      if (!Number.isFinite(parsed as number)) errors.push(`Invalid number for ${key}`);
      else data[key] = parsed;
      continue;
    }
    if (config.booleanFields?.includes(key)) {
      const parsed = parseBoolean(value);
      if (parsed === undefined) errors.push(`Invalid boolean for ${key}`);
      else data[key] = parsed;
      continue;
    }
    if (config.dateFields?.includes(key)) {
      const parsed = parseDate(value);
      if (!parsed || Number.isNaN(parsed.getTime())) errors.push(`Invalid date for ${key}`);
      else data[key] = parsed;
      continue;
    }
    if (config.jsonArrayFields?.includes(key)) {
      try {
        const parsed = parseJsonArray(value);
        if (!Array.isArray(parsed)) throw new Error('bad array');
        data[key] = parsed;
      } catch {
        errors.push(`Invalid array for ${key}`);
      }
      continue;
    }
    if (config.enumFields?.[key]) {
      const enumValue = String(value || '').trim().toUpperCase();
      if (!config.enumFields[key].has(enumValue)) errors.push(`Invalid value for ${key}: ${value}`);
      else data[key] = enumValue;
      continue;
    }
    data[key] = value;
  }

  if (section === 'competitors' && typeof data.typeConfidence === 'number') {
    data.typeConfidence = Math.max(0, Math.min(1, data.typeConfidence));
  }

  return { data, errors };
}

export function sanitizeWhere(config: SectionConfig, rawWhere?: Record<string, unknown>): Record<string, unknown> {
  if (!rawWhere || typeof rawWhere !== 'object') return {};
  const allowed = new Set(['id', ...(config.identityFields || []), ...(config.allowedFields || [])]);
  const where: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawWhere)) {
    if (!allowed.has(key)) continue;
    if (value == null) continue;
    if (typeof value === 'string' && value.trim()) where[key] = value.trim();
    else if (typeof value === 'number' && Number.isFinite(value)) where[key] = value;
    else if (typeof value === 'boolean') where[key] = value;
  }
  return where;
}

export function ensureRequired(config: SectionConfig, data: Record<string, unknown>): string[] {
  return (config.requiredOnCreate || []).filter((field) => {
    const value = data[field];
    if (value == null) return true;
    if (typeof value === 'string' && !value.trim()) return true;
    return false;
  });
}

export function touchMutationMetadata(
  data: Record<string, unknown>,
  actor: string,
  supportsCuration: boolean,
): Record<string, unknown> {
  if (!supportsCuration) return data;
  return {
    ...data,
    manuallyModified: true,
    lastModifiedAt: new Date(),
    lastModifiedBy: actor,
  };
}
