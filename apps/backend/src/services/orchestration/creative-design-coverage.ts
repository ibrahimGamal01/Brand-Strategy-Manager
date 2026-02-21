import { OpenAI } from 'openai';
import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Design-industry dimensions the top-level orchestrator ensures are present in visual/overall analysis.
 * Aligned with metrics used by designers and creative teams.
 */
export const CREATIVE_DESIGN_DIMENSIONS = [
  'composition',
  'color_use',
  'typography',
  'visual_hierarchy',
  'cta_clarity',
  'brand_consistency',
  'psychological_triggers',
  'emotional_appeal',
  'production_quality',
  'accessibility_notes',
] as const;

export type CreativeDesignDimension = (typeof CREATIVE_DESIGN_DIMENSIONS)[number];

function hasDimension(obj: Record<string, unknown> | null, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const v = obj[key];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function missingDimensions(obj: Record<string, unknown> | null): CreativeDesignDimension[] {
  if (!obj) return [...CREATIVE_DESIGN_DIMENSIONS];
  return CREATIVE_DESIGN_DIMENSIONS.filter((d) => !hasDimension(obj, d));
}

export interface EnsureCreativeDesignCoverageResult {
  checked: number;
  enriched: number;
  skipped: number;
  errors: Array<{ mediaAssetId: string; error?: string }>;
}

const DEFAULT_LIMIT = 5;

/**
 * Read stored analysis for job assets and ensure coverage of creative/design dimensions.
 * If visual or overall analysis is missing required dimensions, call OpenAI to enrich and update.
 * Cost control: pass onlyAssetIds to only validate/enrich assets we just analyzed this cycle (avoids re-hitting API for old analyses).
 */
export async function ensureCreativeAndDesignCoverage(
  researchJobId: string,
  options: { limit?: number; onlyAssetIds?: string[] } = {}
): Promise<EnsureCreativeDesignCoverageResult> {
  /*
  // Functionality temporarily disabled due to schema changes (MediaAsset analysis fields removed).
  // TODO: Refactor to use AiAnalysis model.
  
  const limit = Math.max(1, Math.min(20, options.limit ?? DEFAULT_LIMIT));
  const result: EnsureCreativeDesignCoverageResult = { checked: 0, enriched: 0, skipped: 0, errors: [] };

  if (!process.env.OPENAI_API_KEY) {
    console.log('[CreativeDesignCoverage] Skipped: OpenAI not configured');
    return result;
  }

  // ... (rest of the code commented out)
  */
  console.warn('[CreativeDesignCoverage] TEMPORARILY DISABLED due to schema changes');
  return { checked: 0, enriched: 0, skipped: 0, errors: [] };
}
