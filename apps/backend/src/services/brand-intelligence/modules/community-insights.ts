import { runCommunityDetective } from '../../social/community-detective';
import { BrandIntelligenceContext, BrandIntelligenceModuleResult, CommunitySource } from '../types';

const ALLOWED_SOURCES = new Set<CommunitySource>(['reddit', 'quora', 'trustpilot', 'forum']);

function normalizeSources(value: unknown): CommunitySource[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const normalized = Array.from(
    new Set(
      value
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ).filter((source): source is CommunitySource => ALLOWED_SOURCES.has(source as CommunitySource));

  return normalized.length > 0 ? normalized : undefined;
}

export async function runCommunityInsightsModule(input: {
  context: BrandIntelligenceContext;
  runId: string;
  moduleInput?: { platforms?: CommunitySource[] };
}): Promise<BrandIntelligenceModuleResult> {
  const warnings: string[] = [];
  const sources = normalizeSources(input.moduleInput?.platforms);

  const result = await runCommunityDetective(
    input.context.researchJobId,
    input.context.brandName,
    input.context.niche,
    input.context.handlesByPlatform.instagram || undefined,
    {
      runId: input.runId,
      allowedSources: sources,
    }
  );

  if (result.insightsSaved === 0) {
    warnings.push('Community collector returned no new insights.');
  }

  return {
    module: 'community_insights',
    success: true,
    collected: result.linksCollected,
    filtered: result.filteredOut,
    persisted: result.insightsSaved,
    updated: 0,
    skipped: result.skippedExisting,
    failed: 0,
    warnings,
    diagnostics: {
      sources: sources || ['reddit', 'quora', 'trustpilot', 'forum'],
      queriesRun: result.queriesRun,
    },
  };
}
