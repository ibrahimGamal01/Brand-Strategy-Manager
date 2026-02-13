import { Prisma, BrandIntelligenceRun } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import {
  BrandIntelligenceMode,
  BrandIntelligenceModuleInputs,
  BrandIntelligenceModuleKey,
  BrandIntelligenceModuleResult,
  BrandIntelligenceOrchestrationInput,
  BrandIntelligenceOrchestrationResponse,
  BrandIntelligenceRunReason,
  BrandIntelligenceSummary,
  BrandIntelligenceSummaryResponse,
  BrandIntelligenceServiceError,
  createBrandIntelligenceError,
} from './types';
import {
  chooseBrandIntelligenceModuleOrder,
  loadBrandIntelligenceContext,
  validateBrandIntelligenceModules,
} from './context';
import { runBrandMentionsModule } from './modules/brand-mentions';
import { runCommunityInsightsModule } from './modules/community-insights';

const STALE_MINUTES = Math.max(2, Number(process.env.BRAND_INTEL_STALE_MINUTES || 10));

function normalizeMode(value: unknown): BrandIntelligenceMode {
  return String(value || '').trim().toLowerCase() === 'replace' ? 'replace' : 'append';
}

function normalizeRunReason(value: unknown): BrandIntelligenceRunReason {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'manual' ||
    normalized === 'resume' ||
    normalized === 'continuity' ||
    normalized === 'module_action' ||
    normalized === 'brain_command'
  ) {
    return normalized;
  }
  return 'manual';
}

function ensureModuleInputs(value: unknown): BrandIntelligenceModuleInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as BrandIntelligenceModuleInputs;
}

function createEmptyPerModule(): BrandIntelligenceSummary['perModule'] {
  return {
    brand_mentions: {
      success: true,
      collected: 0,
      filtered: 0,
      persisted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      warnings: [],
    },
    community_insights: {
      success: true,
      collected: 0,
      filtered: 0,
      persisted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      warnings: [],
    },
  };
}

function aggregateSummary(modules: BrandIntelligenceModuleKey[], results: BrandIntelligenceModuleResult[]): BrandIntelligenceSummary {
  const perModule = createEmptyPerModule();
  const totals = { collected: 0, filtered: 0, persisted: 0, updated: 0, skipped: 0, failed: 0 };

  for (const result of results) {
    perModule[result.module] = {
      success: result.success,
      collected: result.collected,
      filtered: result.filtered,
      persisted: result.persisted,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
    };

    totals.collected += result.collected;
    totals.filtered += result.filtered;
    totals.persisted += result.persisted;
    totals.updated += result.updated;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }

  return {
    modules,
    moduleOrder: modules,
    totals,
    perModule,
  };
}

async function createRunWithLock(
  researchJobId: string,
  mode: BrandIntelligenceMode,
  modules: BrandIntelligenceModuleKey[],
  moduleInputs: BrandIntelligenceModuleInputs,
  runReason: BrandIntelligenceRunReason
): Promise<BrandIntelligenceRun> {
  return prisma.$transaction(async (tx) => {
    const running = await tx.brandIntelligenceRun.findFirst({
      where: { researchJobId, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
    });

    if (running) {
      const staleMs = STALE_MINUTES * 60 * 1000;
      const ageMs = Date.now() - running.startedAt.getTime();
      if (ageMs < staleMs) {
        throw createBrandIntelligenceError(
          'BRAND_INTEL_ALREADY_RUNNING',
          'Brand intelligence orchestration is already running',
          409
        );
      }

      await tx.brandIntelligenceRun.update({
        where: { id: running.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          diagnostics: {
            reason: 'Stale run replaced by a fresh request',
          },
        },
      });
    }

    return tx.brandIntelligenceRun.create({
      data: {
        researchJobId,
        mode,
        modules: modules as unknown as Prisma.InputJsonValue,
        moduleOrder: modules as unknown as Prisma.InputJsonValue,
        moduleInputs: moduleInputs as unknown as Prisma.InputJsonValue,
        runReason,
        status: 'RUNNING',
        summary: {
          modules,
          totals: { collected: 0, filtered: 0, persisted: 0, updated: 0, skipped: 0, failed: 0 },
        },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function applyReplaceMode(
  mode: BrandIntelligenceMode,
  context: Awaited<ReturnType<typeof loadBrandIntelligenceContext>>,
  modules: BrandIntelligenceModuleKey[]
): Promise<void> {
  if (mode !== 'replace') return;

  if (modules.includes('brand_mentions')) {
    await prisma.brandMention.deleteMany({ where: { clientId: context.clientId } });
  }

  if (modules.includes('community_insights')) {
    await prisma.communityInsight.deleteMany({ where: { researchJobId: context.researchJobId } });
  }
}

export async function orchestrateBrandIntelligenceForJob(
  researchJobId: string,
  input: BrandIntelligenceOrchestrationInput = {}
): Promise<BrandIntelligenceOrchestrationResponse> {
  const context = await loadBrandIntelligenceContext(researchJobId);
  const mode = normalizeMode(input.mode);
  const requestedModules = validateBrandIntelligenceModules(input.modules);
  const moduleOrder = chooseBrandIntelligenceModuleOrder(context, requestedModules);
  const moduleInputs = ensureModuleInputs(input.moduleInputs);
  const runReason = normalizeRunReason(input.runReason);

  const run = await createRunWithLock(researchJobId, mode, moduleOrder, moduleInputs, runReason);

  emitResearchJobEvent({
    researchJobId,
    runId: run.id,
    source: 'brand-intelligence-orchestrator',
    code: 'brand_intel.started',
    level: 'info',
    message: `Brand intelligence started (${moduleOrder.join(' -> ')})`,
    metrics: { mode, runReason, modules: moduleOrder },
  });

  const results: BrandIntelligenceModuleResult[] = [];
  const diagnostics: Record<string, unknown> = {
    mode,
    runReason,
    context: {
      brandName: context.brandName,
      niche: context.niche,
      websiteDomain: context.websiteDomain,
      handlesByPlatform: context.handlesByPlatform,
      goalSignals: context.goalSignals,
    },
  };

  try {
    await applyReplaceMode(mode, context, moduleOrder);

    for (const moduleKey of moduleOrder) {
      emitResearchJobEvent({
        researchJobId,
        runId: run.id,
        source: 'brand-intelligence-orchestrator',
        code: 'brand_intel.module.started',
        level: 'info',
        message: `Running ${moduleKey}`,
        entityType: 'brand_intel_module',
        entityId: moduleKey,
      });

      const result =
        moduleKey === 'brand_mentions'
          ? await runBrandMentionsModule({ context, runId: run.id, moduleInput: moduleInputs.brand_mentions })
          : await runCommunityInsightsModule({ context, runId: run.id, moduleInput: moduleInputs.community_insights });

      results.push(result);

      emitResearchJobEvent({
        researchJobId,
        runId: run.id,
        source: 'brand-intelligence-orchestrator',
        code: result.success ? 'brand_intel.module.completed' : 'brand_intel.module.failed',
        level: result.success ? 'info' : 'warn',
        message: `${moduleKey} completed (persisted ${result.persisted})`,
        entityType: 'brand_intel_module',
        entityId: moduleKey,
        metrics: result as unknown as Record<string, unknown>,
      });
    }

    const summary = aggregateSummary(moduleOrder, results);
    diagnostics.results = results;

    await prisma.brandIntelligenceRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETE',
        completedAt: new Date(),
        summary: summary as unknown as Prisma.InputJsonValue,
        diagnostics: diagnostics as unknown as Prisma.InputJsonValue,
      },
    });

    emitResearchJobEvent({
      researchJobId,
      runId: run.id,
      source: 'brand-intelligence-orchestrator',
      code: 'brand_intel.completed',
      level: 'info',
      message: 'Brand intelligence orchestration completed',
      metrics: summary.totals,
    });

    return { runId: run.id, status: 'COMPLETE', summary, diagnostics };
  } catch (error: any) {
    await prisma.brandIntelligenceRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        diagnostics: {
          ...(diagnostics as Record<string, unknown>),
          error: error?.message || String(error),
        },
      },
    });

    emitResearchJobEvent({
      researchJobId,
      runId: run.id,
      source: 'brand-intelligence-orchestrator',
      code: 'brand_intel.failed',
      level: 'error',
      message: `Brand intelligence failed: ${error?.message || error}`,
    });

    throw error;
  }
}

export async function getBrandIntelligenceSummary(
  researchJobId: string,
  runId?: string
): Promise<BrandIntelligenceSummaryResponse> {
  const run = runId
    ? await prisma.brandIntelligenceRun.findFirst({ where: { id: runId, researchJobId } })
    : await prisma.brandIntelligenceRun.findFirst({
        where: { researchJobId },
        orderBy: { createdAt: 'desc' },
      });

  if (!run) {
    return {
      runId: null,
      status: null,
      mode: null,
      modules: [],
      moduleOrder: [],
      runReason: null,
      summary: null,
      diagnostics: null,
    };
  }

  return {
    runId: run.id,
    status: run.status,
    mode: run.mode,
    modules: (run.modules as BrandIntelligenceModuleKey[]) || [],
    moduleOrder: (run.moduleOrder as BrandIntelligenceModuleKey[]) || [],
    runReason: run.runReason,
    summary: (run.summary as BrandIntelligenceSummary) || null,
    diagnostics: run.diagnostics,
  };
}
