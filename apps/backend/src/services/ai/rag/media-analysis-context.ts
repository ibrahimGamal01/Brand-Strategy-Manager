/**
 * Media Analysis RAG Component
 *
 * Aggregates MediaAsset AI analyses (visual, transcript, overall) for a research job
 * so strategy document generators can reference hook strength, scroll-stopping,
 * actionable fixes, and one-line recommendations.
 */

import { prisma } from '../../../lib/prisma';
import { buildQualifiedContentPool } from '../../orchestration/content-qualification';

export interface MediaAnalysisSummary {
  client: { total: number; byType: Record<string, number>; recommendations: string[]; visualFixes: string[] };
  competitor: { total: number; byType: Record<string, number>; recommendations: string[]; competitorAngles: string[]; visualFixes: string[] };
  recurringRecommendations: string[];
  hasData: boolean;
}

export interface MediaAnalysisContextOptions {
  allowDegradedSnapshots?: boolean;
  requireScopedCompetitors?: boolean;
  maxClientSnapshots?: number;
  maxCompetitorSnapshots?: number;
  maxPostsPerSnapshot?: number;
}

function extractStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string').slice(0, 5);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function extractOneLineRec(overall: Record<string, unknown> | null): string | null {
  if (!overall) return null;
  const v = overall.one_line_recommendation;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function extractCompetitorAngle(overall: Record<string, unknown> | null): string | null {
  if (!overall) return null;
  const v = overall.competitor_angle;
  if (typeof v === 'string' && v.trim() && v.trim().toUpperCase() !== 'N/A') return v.trim();
  return null;
}

/**
 * Get aggregated media analysis context for a research job.
 */
export async function getMediaAnalysisContext(
  researchJobId: string,
  options: MediaAnalysisContextOptions = {}
): Promise<MediaAnalysisSummary> {
  const qualifiedPool = await buildQualifiedContentPool(researchJobId, {
    allowDegradedSnapshots: options.allowDegradedSnapshots === true,
    requireScopedCompetitors: options.requireScopedCompetitors !== false,
    maxClientSnapshots: options.maxClientSnapshots ?? 8,
    maxCompetitorSnapshots: options.maxCompetitorSnapshots ?? 24,
    maxPostsPerSnapshot: options.maxPostsPerSnapshot ?? 120,
  });
  const qualifiedAssetIds = Array.from(
    new Set(qualifiedPool.posts.flatMap((post) => post.mediaAssetIds))
  );
  if (qualifiedAssetIds.length === 0) {
    return {
      client: { total: 0, byType: {}, recommendations: [], visualFixes: [] },
      competitor: { total: 0, byType: {}, recommendations: [], competitorAngles: [], visualFixes: [] },
      recurringRecommendations: [],
      hasData: false,
    };
  }

  const assets = await prisma.mediaAsset.findMany({
    where: {
      isDownloaded: true,
      blobStoragePath: { not: null },
      id: { in: qualifiedAssetIds },
    },
    select: {
      id: true,
      mediaType: true,
      competitorPostSnapshotId: true,
      clientPostSnapshotId: true,
      socialPostId: true,
      aiAnalyses: true,
    },
  });

  const client = { total: 0, byType: {} as Record<string, number>, recommendations: [] as string[], visualFixes: [] as string[] };
  const competitor = { total: 0, byType: {} as Record<string, number>, recommendations: [] as string[], competitorAngles: [] as string[], visualFixes: [] as string[] };
  const allRecommendations: string[] = [];
  const allVisualFixes: string[] = [];

  for (const a of assets) {
    // Extract from aiAnalyses
    const analyses = a.aiAnalyses || [];
    if (analyses.length === 0) continue;

    const isCompetitor = Boolean(a.competitorPostSnapshotId);
    const bucket = isCompetitor ? competitor : client;
    bucket.total += 1;
    const typeKey = a.mediaType || 'unknown';
    bucket.byType[typeKey] = (bucket.byType[typeKey] || 0) + 1;

    const visualAnalysis = analyses.find((x) => x.analysisType === 'VISUAL');
    const overallAnalysis = analyses.find((x) => x.analysisType === 'OVERALL');

    const visual = (visualAnalysis?.fullResponse as Record<string, unknown> | null) || null;
    const overall = (overallAnalysis?.fullResponse as Record<string, unknown> | null) || null;

    const oneLine = extractOneLineRec(overall);
    if (oneLine) {
      bucket.recommendations.push(oneLine);
      allRecommendations.push(oneLine);
    }

    if (visual && Array.isArray(visual.actionable_visual_fixes)) {
      const fixes = extractStrings(visual.actionable_visual_fixes);
      bucket.visualFixes.push(...fixes);
      allVisualFixes.push(...fixes);
    }
    if (overall && Array.isArray(overall.strategic_recommendations)) {
      const recs = extractStrings(overall.strategic_recommendations);
      allRecommendations.push(...recs);
    }

    if (isCompetitor) {
      const angle = extractCompetitorAngle(overall);
      if (angle) competitor.competitorAngles.push(angle);
    }
  }

  // Dedupe and limit for context size
  const unique = (arr: string[], max: number) => [...new Set(arr)].slice(0, max);
  client.recommendations = unique(client.recommendations, 10);
  client.visualFixes = unique(client.visualFixes, 12);
  competitor.recommendations = unique(competitor.recommendations, 10);
  competitor.competitorAngles = unique(competitor.competitorAngles, 8);
  competitor.visualFixes = unique(competitor.visualFixes, 8);
  const recurringRecommendations = unique(allRecommendations, 15);

  return {
    client,
    competitor,
    recurringRecommendations,
    hasData: client.total + competitor.total > 0,
  };
}

/**
 * Format media analysis summary for LLM context (concise block).
 */
export function formatMediaAnalysisForLLM(summary: MediaAnalysisSummary): string {
  if (!summary.hasData) {
    return `## Media Creative Analysis\n\nNo per-asset creative analysis available yet. Use post-level metrics and captions from other sections.\n\n`;
  }

  let out = `## Media Creative Analysis (from AI-reviewed client and competitor assets)

`;
  out += `### Client assets analyzed: ${summary.client.total} (by type: ${Object.entries(summary.client.byType).map(([k, v]) => `${k}: ${v}`).join(', ')})
`;
  if (summary.client.recommendations.length > 0) {
    out += `- **One-line recommendations**: ${summary.client.recommendations.slice(0, 6).join(' | ')}\n`;
  }
  if (summary.client.visualFixes.length > 0) {
    out += `- **Recurring visual fixes**: ${summary.client.visualFixes.slice(0, 8).join('; ')}\n`;
  }
  out += '\n';

  out += `### Competitor assets analyzed: ${summary.competitor.total} (by type: ${Object.entries(summary.competitor.byType).map(([k, v]) => `${k}: ${v}`).join(', ')})
`;
  if (summary.competitor.competitorAngles.length > 0) {
    out += `- **What competitors do well / threats**: ${summary.competitor.competitorAngles.slice(0, 5).join(' | ')}\n`;
  }
  if (summary.competitor.recommendations.length > 0) {
    out += `- **Recommendations inferred from competitor content**: ${summary.competitor.recommendations.slice(0, 5).join(' | ')}\n`;
  }
  out += '\n';

  if (summary.recurringRecommendations.length > 0) {
    out += `### Recurring strategic recommendations (use for Content Analysis and Format Recommendations)\n${summary.recurringRecommendations.slice(0, 10).map((r) => `- ${r}`).join('\n')}\n\n`;
  }

  out += `**Use this section** to ground Format Recommendations and Content Analysis in actual creative feedback (hooks, scroll-stopping, visual fixes). Cite these insights when making format and creative recommendations.\n\n`;

  return out;
}
