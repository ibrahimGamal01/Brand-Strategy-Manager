import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { buildQualifiedContentPool } from '../src/services/orchestration/content-qualification';

interface Args {
  jobId: string | null;
  dryRun: boolean;
  allowDegraded: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const jobArg = args.find((arg) => arg.startsWith('--job='));
  return {
    jobId: jobArg ? jobArg.replace('--job=', '').trim() : null,
    dryRun: args.includes('--dry-run'),
    allowDegraded: args.includes('--allow-degraded'),
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function reportPath(): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'docs',
    'baselines',
    'media-analysis-scope-cleanup-report.md'
  );
}

async function run() {
  const args = parseArgs();
  const jobs = await prisma.researchJob.findMany({
    where: args.jobId ? { id: args.jobId } : undefined,
    include: { client: { select: { id: true, name: true } } },
    orderBy: { startedAt: 'desc' },
  });

  if (jobs.length === 0) {
    throw new Error(args.jobId ? `Job not found: ${args.jobId}` : 'No research jobs found');
  }

  const lines: string[] = [];
  lines.push(`# Out-of-Scope Media Analysis Cleanup`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Dry run: ${args.dryRun}`);
  lines.push(`Allow degraded scope: ${args.allowDegraded}`);
  lines.push(`Jobs processed: ${jobs.length}`);
  lines.push(``);

  let totalDeleted = 0;
  let totalOutOfScope = 0;
  let totalScoped = 0;
  let skippedNoScope = 0;

  for (const job of jobs) {
    const scope = await buildQualifiedContentPool(job.id, {
      allowDegradedSnapshots: args.allowDegraded,
      requireScopedCompetitors: true,
      maxClientSnapshots: 8,
      maxCompetitorSnapshots: 24,
      maxPostsPerSnapshot: 120,
    });
    const qualifiedAssetIds = new Set(scope.posts.flatMap((post) => post.mediaAssetIds));
    const mediaRows = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: job.id,
        mediaAssetId: { not: null },
      },
      select: {
        id: true,
        mediaAssetId: true,
      },
    });

    const scopedRows = mediaRows.filter((row) =>
      qualifiedAssetIds.has(String(row.mediaAssetId || '').trim())
    );
    const outOfScopeRows = mediaRows.filter(
      (row) => !qualifiedAssetIds.has(String(row.mediaAssetId || '').trim())
    );

    totalScoped += scopedRows.length;
    totalOutOfScope += outOfScopeRows.length;

    lines.push(`## Job ${job.id}`);
    lines.push(`- client: ${job.client?.name || '(no client)'}`);
    lines.push(`- qualifiedMediaAssetIds: ${qualifiedAssetIds.size}`);
    lines.push(`- scopedMediaAnalyses: ${scopedRows.length}`);
    lines.push(`- outOfScopeMediaAnalyses: ${outOfScopeRows.length}`);

    if (qualifiedAssetIds.size === 0) {
      skippedNoScope += 1;
      lines.push(`- action: skipped (no qualified scope available)`);
      lines.push(``);
      continue;
    }

    if (outOfScopeRows.length === 0) {
      lines.push(`- action: no cleanup needed`);
      lines.push(``);
      continue;
    }

    if (args.dryRun) {
      lines.push(`- action: dry-run (would delete ${outOfScopeRows.length} rows)`);
      lines.push(``);
      continue;
    }

    let deleted = 0;
    for (const ids of chunk(outOfScopeRows.map((row) => row.id), 500)) {
      const result = await prisma.aiAnalysis.deleteMany({
        where: { id: { in: ids } },
      });
      deleted += result.count;
    }
    totalDeleted += deleted;
    lines.push(`- action: deleted ${deleted} out-of-scope rows`);
    lines.push(``);
  }

  lines.push(`## Summary`);
  lines.push(`- totalScopedRowsBefore: ${totalScoped}`);
  lines.push(`- totalOutOfScopeRowsBefore: ${totalOutOfScope}`);
  lines.push(`- totalDeleted: ${totalDeleted}`);
  lines.push(`- jobsSkippedNoScope: ${skippedNoScope}`);
  lines.push(``);

  const output = reportPath();
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${lines.join('\n')}\n`, 'utf8');

  console.log(`[CleanupOutOfScopeMediaAnalyses] Report written: ${output}`);
  console.log(
    `[CleanupOutOfScopeMediaAnalyses] Summary: scoped=${totalScoped}, outOfScope=${totalOutOfScope}, deleted=${totalDeleted}, skippedNoScope=${skippedNoScope}`
  );
}

run()
  .catch((error) => {
    console.error('[CleanupOutOfScopeMediaAnalyses] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

