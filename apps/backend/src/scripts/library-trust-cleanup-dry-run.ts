import { prisma } from '../lib/prisma';

type DuplicateGroup = {
  key: string;
  count: number;
  keepId: string;
  dropIds: string[];
  sampleUrl?: string;
  researchJobId?: string;
};

function parseArg(flag: string): string | null {
  const index = process.argv.findIndex((entry) => entry === flag);
  if (index === -1) return null;
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) return null;
  return next.trim();
}

function normalizeUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    const params = new URLSearchParams(parsed.search);
    const keysToDrop = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'igsh',
      'si',
      'ref',
      'source',
    ];
    for (const key of keysToDrop) params.delete(key);
    parsed.search = params.toString() ? `?${params.toString()}` : '';
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.pathname = normalizedPath;
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return value.toLowerCase();
  }
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildDuplicateGroups<T extends { id: string; researchJobId?: string; url: string; updatedAt?: Date }>(
  rows: T[]
): DuplicateGroup[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const canonical = normalizeUrl(row.url);
    if (!canonical) continue;
    const job = row.researchJobId || 'global';
    const key = `${job}::${canonical}`;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      const aTs = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTs = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTs - aTs;
    });
    const keep = sorted[0];
    duplicates.push({
      key,
      count: sorted.length,
      keepId: keep.id,
      dropIds: sorted.slice(1).map((row) => row.id),
      sampleUrl: sorted[0]?.url,
      researchJobId: sorted[0]?.researchJobId,
    });
  }

  return duplicates.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

async function main() {
  const workspaceId = parseArg('--workspaceId') || parseArg('--workspace');
  const outputFile = parseArg('--output');
  const retentionDays = Math.max(
    7,
    Math.min(180, Number.parseInt(String(process.env.PORTAL_LIBRARY_RETENTION_DAYS || '30'), 10) || 30)
  );

  const whereWorkspace = workspaceId ? { researchJobId: workspaceId } : {};

  const [rawSearchRows, newsRows, socialRows, orphanSnapshotRows, orphanExtractionRows, staleFailedRuns] =
    await Promise.all([
      prisma.rawSearchResult.findMany({
        where: { isActive: true, ...whereWorkspace },
        select: { id: true, researchJobId: true, href: true, updatedAt: true },
        take: 60_000,
      }),
      prisma.ddgNewsResult.findMany({
        where: { isActive: true, ...whereWorkspace },
        select: { id: true, researchJobId: true, url: true, updatedAt: true },
        take: 60_000,
      }),
      prisma.socialPost.findMany({
        where: workspaceId
          ? {
              socialProfile: {
                researchJobId: workspaceId,
              },
            }
          : undefined,
        select: {
          id: true,
          externalId: true,
          scrapedAt: true,
          socialProfile: {
            select: {
              platform: true,
              researchJobId: true,
            },
          },
        },
        take: 120_000,
      }),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        workspaceId
          ? `SELECT COUNT(*)::int AS count
             FROM web_page_snapshots s
             LEFT JOIN web_sources ws ON ws.id = s.web_source_id
             WHERE ws.id IS NULL
               AND s.research_job_id = '${workspaceId.replace(/'/g, "''")}'`
          : `SELECT COUNT(*)::int AS count
             FROM web_page_snapshots s
             LEFT JOIN web_sources ws ON ws.id = s.web_source_id
             WHERE ws.id IS NULL`
      ),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        workspaceId
          ? `SELECT COUNT(*)::int AS count
             FROM web_extraction_runs r
             LEFT JOIN web_page_snapshots s ON s.id = r.snapshot_id
             LEFT JOIN web_extraction_recipes p ON p.id = r.recipe_id
             WHERE (s.id IS NULL OR p.id IS NULL)
               AND r.research_job_id = '${workspaceId.replace(/'/g, "''")}'`
          : `SELECT COUNT(*)::int AS count
             FROM web_extraction_runs r
             LEFT JOIN web_page_snapshots s ON s.id = r.snapshot_id
             LEFT JOIN web_extraction_recipes p ON p.id = r.recipe_id
             WHERE s.id IS NULL OR p.id IS NULL`
      ),
      prisma.workspaceDocumentIngestionRun.findMany({
        where: {
          status: 'FAILED',
          createdAt: {
            lt: new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000),
          },
          ...(workspaceId ? { researchJobId: workspaceId } : {}),
        },
        select: {
          id: true,
          researchJobId: true,
          documentId: true,
          createdAt: true,
          parser: true,
        },
        take: 30_000,
      }),
    ]);

  const rawDuplicates = buildDuplicateGroups(
    rawSearchRows.map((row) => ({
      id: row.id,
      researchJobId: row.researchJobId,
      url: row.href,
      updatedAt: row.updatedAt,
    }))
  );

  const newsDuplicates = buildDuplicateGroups(
    newsRows.map((row) => ({
      id: row.id,
      researchJobId: row.researchJobId,
      url: row.url,
      updatedAt: row.updatedAt,
    }))
  );

  const socialGroups = new Map<string, Array<{ id: string; scrapedAt: Date }>>();
  for (const row of socialRows) {
    const platform = String(row.socialProfile?.platform || '').trim().toLowerCase();
    const job = String(row.socialProfile?.researchJobId || '').trim();
    const externalId = String(row.externalId || '').trim().toLowerCase();
    if (!platform || !job || !externalId) continue;
    const key = `${job}::${platform}::${externalId}`;
    const bucket = socialGroups.get(key) || [];
    bucket.push({ id: row.id, scrapedAt: row.scrapedAt });
    socialGroups.set(key, bucket);
  }
  const socialDuplicates: DuplicateGroup[] = [];
  for (const [key, bucket] of socialGroups.entries()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => b.scrapedAt.getTime() - a.scrapedAt.getTime());
    socialDuplicates.push({
      key,
      count: sorted.length,
      keepId: sorted[0].id,
      dropIds: sorted.slice(1).map((row) => row.id),
      researchJobId: key.split('::')[0] || undefined,
    });
  }
  socialDuplicates.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const report = {
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    workspaceScope: workspaceId || 'all',
    flags: {
      hardCleanupEnabled: String(process.env.PORTAL_LIBRARY_HARD_CLEANUP_ENABLED || 'false')
        .trim()
        .toLowerCase() === 'true',
    },
    retentionDays,
    totals: {
      rawSearchRows: rawSearchRows.length,
      ddgNewsRows: newsRows.length,
      socialRows: socialRows.length,
      staleFailedIngestionRuns: staleFailedRuns.length,
    },
    duplicateCandidates: {
      rawSearchByCanonicalUrl: {
        groups: rawDuplicates.length,
        rowsToArchive: rawDuplicates.reduce((sum, entry) => sum + entry.dropIds.length, 0),
        samples: rawDuplicates.slice(0, 25),
      },
      ddgNewsByCanonicalUrl: {
        groups: newsDuplicates.length,
        rowsToArchive: newsDuplicates.reduce((sum, entry) => sum + entry.dropIds.length, 0),
        samples: newsDuplicates.slice(0, 25),
      },
      socialByPlatformExternalId: {
        groups: socialDuplicates.length,
        rowsToArchive: socialDuplicates.reduce((sum, entry) => sum + entry.dropIds.length, 0),
        samples: socialDuplicates.slice(0, 25),
      },
    },
    orphanCandidates: {
      webSnapshotsWithoutSource: asNumber(orphanSnapshotRows?.[0]?.count),
      extractionRunsWithoutSourceSnapshotOrRecipe: asNumber(orphanExtractionRows?.[0]?.count),
    },
    staleCandidates: {
      failedIngestionRunsPastRetention: staleFailedRuns.length,
      samples: staleFailedRuns.slice(0, 25),
    },
    notes: [
      'Dry-run only. No records were deleted or archived.',
      'Use this report to confirm backup scope before enabling hard cleanup.',
    ],
  };

  const json = JSON.stringify(report, null, 2);
  if (outputFile) {
    await import('node:fs/promises').then((fs) => fs.writeFile(outputFile, json, 'utf8'));
  }
  console.log(json);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[library-trust-cleanup-dry-run] Failed:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

