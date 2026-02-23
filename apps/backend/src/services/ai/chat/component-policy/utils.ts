import { COMPONENT_ALIASES } from './types';

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeBlockType(value: unknown): string {
  const raw = asString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return '';
  return COMPONENT_ALIASES[raw] || raw;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

