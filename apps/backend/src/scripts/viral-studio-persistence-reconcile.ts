import { getViralStudioWorkspaceReconciliation } from '../services/portal/viral-studio';

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function parseWorkspaceIdsFromEnv(): string[] {
  const raw = normalize(process.env.VIRAL_STUDIO_DB_READ_WORKSPACES);
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => normalize(entry))
    .filter((entry) => entry && entry !== '*');
}

function hasNonZeroDeltas(deltas: Record<string, number>): boolean {
  return Object.values(deltas).some((value) => Number(value) !== 0);
}

async function run(): Promise<void> {
  const cliIds = process.argv.slice(2).map((entry) => normalize(entry)).filter(Boolean);
  const workspaceIds = cliIds.length > 0 ? cliIds : parseWorkspaceIdsFromEnv();
  if (!workspaceIds.length) {
    console.error('Usage: tsx src/scripts/viral-studio-persistence-reconcile.ts <workspaceId ...>');
    console.error('No workspace ids were provided via CLI or VIRAL_STUDIO_DB_READ_WORKSPACES.');
    process.exit(1);
  }

  const reports = [];
  for (const workspaceId of workspaceIds) {
    const report = await getViralStudioWorkspaceReconciliation(workspaceId);
    reports.push(report);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    workspaceCount: reports.length,
    reports,
  };

  console.log(JSON.stringify(output, null, 2));
  if (reports.some((report) => hasNonZeroDeltas(report.deltas))) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error('[viral-studio-persistence-reconcile] failed');
  console.error(error);
  process.exit(1);
});
