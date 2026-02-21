import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { buildQualifiedContentPool } from '../src/services/orchestration/content-qualification';
import { runAiAnalysisForJob } from '../src/services/orchestration/run-job-media-analysis';
import { isOpenAiConfiguredForRealMode } from '../src/lib/runtime-preflight';

interface Args {
  jobId: string | null;
  limit: number;
  maxCycles: number;
  targetCoverage: number;
  allowDegraded: boolean;
  maxEligibleAssets: number;
  maxEligiblePosts: number;
}

interface CoverageStats {
  qualifiedMediaAssetIds: number;
  analyzedQualifiedMediaAssets: number;
  coverage: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const jobArg = args.find((arg) => arg.startsWith('--job='));
  const limitArg = Number((args.find((arg) => arg.startsWith('--limit=')) || '').replace('--limit=', ''));
  const maxCyclesArg = Number(
    (args.find((arg) => arg.startsWith('--max-cycles=')) || '').replace('--max-cycles=', '')
  );
  const targetCoverageArg = Number(
    (args.find((arg) => arg.startsWith('--target-coverage=')) || '').replace('--target-coverage=', '')
  );
  const maxEligibleAssetsArg = Number(
    (args.find((arg) => arg.startsWith('--max-eligible-assets=')) || '').replace(
      '--max-eligible-assets=',
      ''
    )
  );
  const maxEligiblePostsArg = Number(
    (args.find((arg) => arg.startsWith('--max-eligible-posts=')) || '').replace(
      '--max-eligible-posts=',
      ''
    )
  );
  return {
    jobId: jobArg ? jobArg.replace('--job=', '').trim() : null,
    limit: Number.isFinite(limitArg) ? Math.max(1, Math.min(100, Math.floor(limitArg))) : 25,
    maxCycles: Number.isFinite(maxCyclesArg) ? Math.max(1, Math.min(100, Math.floor(maxCyclesArg))) : 4,
    targetCoverage:
      Number.isFinite(targetCoverageArg) && targetCoverageArg >= 0 && targetCoverageArg <= 1
        ? targetCoverageArg
        : 0.5,
    allowDegraded: args.includes('--allow-degraded'),
    maxEligibleAssets: Number.isFinite(maxEligibleAssetsArg)
      ? Math.max(20, Math.min(240, Math.floor(maxEligibleAssetsArg)))
      : 80,
    maxEligiblePosts: Number.isFinite(maxEligiblePostsArg)
      ? Math.max(30, Math.min(300, Math.floor(maxEligiblePostsArg)))
      : 120,
  };
}

function reportPath(): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'docs',
    'baselines',
    'media-analysis-backfill-report.md'
  );
}

async function getCoverage(jobId: string, allowDegraded: boolean): Promise<CoverageStats> {
  const pool = await buildQualifiedContentPool(jobId, {
    allowDegradedSnapshots: allowDegraded,
    requireScopedCompetitors: true,
    maxClientSnapshots: 8,
    maxCompetitorSnapshots: 24,
    maxPostsPerSnapshot: 120,
  });
  const qualifiedIds = Array.from(new Set(pool.posts.flatMap((post) => post.mediaAssetIds)));
  if (qualifiedIds.length === 0) {
    return {
      qualifiedMediaAssetIds: 0,
      analyzedQualifiedMediaAssets: 0,
      coverage: 0,
    };
  }
  const analyzedCount = await prisma.mediaAsset.count({
    where: {
      id: { in: qualifiedIds },
      aiAnalyses: { some: {} },
    },
  });
  return {
    qualifiedMediaAssetIds: qualifiedIds.length,
    analyzedQualifiedMediaAssets: analyzedCount,
    coverage: analyzedCount / qualifiedIds.length,
  };
}

async function run() {
  const args = parseArgs();

  if (!isOpenAiConfiguredForRealMode()) {
    throw new Error('OPENAI_API_KEY is required for scoped media-analysis backfill');
  }

  const jobs = await prisma.researchJob.findMany({
    where: args.jobId ? { id: args.jobId } : undefined,
    include: { client: { select: { id: true, name: true } } },
    orderBy: { startedAt: 'desc' },
  });

  if (jobs.length === 0) {
    throw new Error(args.jobId ? `Job not found: ${args.jobId}` : 'No research jobs found');
  }

  const lines: string[] = [];
  lines.push(`# Scoped Media Analysis Backfill`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Limit per cycle: ${args.limit}`);
  lines.push(`Max cycles per job: ${args.maxCycles}`);
  lines.push(`Target coverage: ${(args.targetCoverage * 100).toFixed(1)}%`);
  lines.push(`Allow degraded scope: ${args.allowDegraded}`);
  lines.push(`Max eligible assets per run: ${args.maxEligibleAssets}`);
  lines.push(`Max eligible posts per run: ${args.maxEligiblePosts}`);
  lines.push(`Jobs processed: ${jobs.length}`);
  lines.push(``);

  for (const job of jobs) {
    lines.push(`## Job ${job.id}`);
    lines.push(`- client: ${job.client?.name || '(no client)'}`);

    const initial = await getCoverage(job.id, args.allowDegraded);
    lines.push(
      `- initialCoverage: ${initial.analyzedQualifiedMediaAssets}/${initial.qualifiedMediaAssetIds} (${(
        initial.coverage * 100
      ).toFixed(1)}%)`
    );

    if (initial.qualifiedMediaAssetIds === 0) {
      lines.push(`- action: skipped (no qualified media assets)`);
      lines.push(``);
      continue;
    }

    for (let cycle = 1; cycle <= args.maxCycles; cycle += 1) {
      const result = await runAiAnalysisForJob(job.id, {
        limit: args.limit,
        allowDegraded: args.allowDegraded,
        skipAlreadyAnalyzed: true,
        maxEligibleAssets: args.maxEligibleAssets,
        maxEligiblePosts: args.maxEligiblePosts,
      });
      const afterCycle = await getCoverage(job.id, args.allowDegraded);
      lines.push(
        `- cycle ${cycle}: ran=${result.ran}, succeeded=${result.succeeded}, failed=${result.failed}, skipped=${result.skipped}, reason=${result.reason || 'n/a'}`
      );
      lines.push(
        `  coverageAfterCycle: ${afterCycle.analyzedQualifiedMediaAssets}/${afterCycle.qualifiedMediaAssetIds} (${(
          afterCycle.coverage * 100
        ).toFixed(1)}%)`
      );

      if (afterCycle.coverage >= args.targetCoverage) {
        lines.push(`- stopReason: reached target coverage`);
        break;
      }
      if (result.skipped || result.ran === 0) {
        lines.push(`- stopReason: no more analyzable scoped assets in this cycle`);
        break;
      }
    }

    const final = await getCoverage(job.id, args.allowDegraded);
    lines.push(
      `- finalCoverage: ${final.analyzedQualifiedMediaAssets}/${final.qualifiedMediaAssetIds} (${(
        final.coverage * 100
      ).toFixed(1)}%)`
    );
    lines.push(``);
  }

  const output = reportPath();
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[BackfillScopedMediaAnalyses] Report written: ${output}`);
}

run()
  .catch((error) => {
    console.error('[BackfillScopedMediaAnalyses] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
