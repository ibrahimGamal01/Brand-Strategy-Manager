import crypto from 'crypto';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { prisma } from '../src/lib/prisma';

type Args = {
  outJson: string;
  outMd: string;
  anonymize: boolean;
};

type JobCompletenessInput = {
  confirmedChannels: number;
  socialProfileCount: number;
  socialPostCount: number;
  scrapeReadyCompetitors: number;
  snapshotPosts: number;
  mediaDownloadedRatio: number;
  aiAnalysisCount: number;
  documentSectionCount: number;
  calendarSlots: number;
};

function detectRepoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'apps', 'backend', 'package.json'))) return cwd;

  const up2 = path.resolve(cwd, '..', '..');
  if (existsSync(path.join(up2, 'apps', 'backend', 'package.json'))) return up2;

  return cwd;
}

function parseArgs(): Args {
  const repoRoot = detectRepoRoot();
  const defaultJson = path.join(repoRoot, 'docs', 'baselines', 'current-user-baseline.json');
  const defaultMd = path.join(repoRoot, 'docs', 'baselines', 'current-user-baseline.md');

  const args = process.argv.slice(2);
  const outJsonArg = args.find((arg) => arg.startsWith('--out-json='));
  const outMdArg = args.find((arg) => arg.startsWith('--out-md='));
  const rawMode = args.includes('--raw');

  return {
    outJson: outJsonArg ? outJsonArg.replace('--out-json=', '').trim() : defaultJson,
    outMd: outMdArg ? outMdArg.replace('--out-md=', '').trim() : defaultMd,
    anonymize: !rawMode,
  };
}

function toRecordCount<T extends string>(values: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const value of values) {
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function hashValue(value: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 12);
}

function maybeAnonId(value: string, prefix: string, anonymize: boolean, salt: string): string {
  if (!anonymize) return value;
  return `${prefix}_${hashValue(value, salt)}`;
}

function safeRatio(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function scoreCompleteness(input: JobCompletenessInput): number {
  let score = 0;

  if (input.confirmedChannels >= 1) score += 20;

  if (input.socialProfileCount >= 2) score += 10;
  else if (input.socialProfileCount === 1) score += 6;

  if (input.socialPostCount >= 20) score += 15;
  else if (input.socialPostCount >= 10) score += 10;
  else if (input.socialPostCount >= 5) score += 5;

  if (input.scrapeReadyCompetitors >= 5) score += 15;
  else if (input.scrapeReadyCompetitors >= 3) score += 10;
  else if (input.scrapeReadyCompetitors >= 1) score += 5;

  if (input.snapshotPosts >= 30) score += 15;
  else if (input.snapshotPosts >= 15) score += 10;
  else if (input.snapshotPosts >= 5) score += 5;

  if (input.mediaDownloadedRatio >= 0.7) score += 10;
  else if (input.mediaDownloadedRatio >= 0.4) score += 5;

  if (input.aiAnalysisCount >= 20) score += 10;
  else if (input.aiAnalysisCount >= 10) score += 6;
  else if (input.aiAnalysisCount >= 5) score += 3;

  if (input.documentSectionCount >= 9) score += 5;

  if (input.calendarSlots >= 14) score += 10;
  else if (input.calendarSlots >= 7) score += 5;

  return Math.max(0, Math.min(100, score));
}

function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

async function main() {
  const args = parseArgs();
  const salt = process.env.BASELINE_HASH_SALT || 'local-baseline-salt';
  const generatedAt = new Date().toISOString();

  const clients = await prisma.client.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      clientAccounts: { select: { platform: true, handle: true } },
      researchJobs: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          inputData: true,
        },
      },
    },
  });

  const allJobs = clients.flatMap((client) =>
    client.researchJobs.map((job) => ({ ...job, clientId: client.id, clientName: client.name }))
  );

  const jobIds = allJobs.map((job) => job.id);

  const [
    socialProfiles,
    discoveredCompetitors,
    candidateProfiles,
    clientSnapshots,
    competitorSnapshots,
    aiAnalyses,
    calendarRuns,
    eventsByJob,
  ] = await Promise.all([
    jobIds.length
      ? prisma.socialProfile.findMany({
          where: { researchJobId: { in: jobIds } },
          select: {
            id: true,
            researchJobId: true,
            platform: true,
            _count: { select: { posts: true } },
          },
        })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.discoveredCompetitor.findMany({
          where: { researchJobId: { in: jobIds } },
          select: {
            researchJobId: true,
            platform: true,
            status: true,
            selectionState: true,
            availabilityStatus: true,
            postsScraped: true,
          },
        })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.competitorCandidateProfile.findMany({
          where: { researchJobId: { in: jobIds } },
          select: {
            researchJobId: true,
            platform: true,
            state: true,
            availabilityStatus: true,
            source: true,
          },
        })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.clientProfileSnapshot.findMany({
          where: { researchJobId: { in: jobIds } },
          select: {
            id: true,
            researchJobId: true,
            scrapedAt: true,
            _count: { select: { posts: true } },
          },
        })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.competitorProfileSnapshot.findMany({
          where: { researchJobId: { in: jobIds } },
          select: {
            id: true,
            researchJobId: true,
            scrapedAt: true,
            _count: { select: { posts: true } },
          },
        })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.aiAnalysis.findMany({
          where: { researchJobId: { in: jobIds } },
          select: { researchJobId: true, analysisType: true, topic: true },
        })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.contentCalendarRun.findMany({
          where: { researchJobId: { in: jobIds } },
          select: {
            id: true,
            researchJobId: true,
            status: true,
            createdAt: true,
            _count: { select: { slots: true } },
          },
        })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.researchJobEvent.groupBy({
          by: ['researchJobId'],
          where: { researchJobId: { in: jobIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const clientSnapshotJobById = new Map(
    clientSnapshots.map((snapshot) => [snapshot.id, snapshot.researchJobId || ''] as const)
  );
  const competitorSnapshotJobById = new Map(
    competitorSnapshots.map((snapshot) => [snapshot.id, snapshot.researchJobId || ''] as const)
  );

  const mediaAssets =
    clientSnapshots.length || competitorSnapshots.length
      ? await prisma.mediaAsset.findMany({
          where: {
            OR: [
              clientSnapshots.length
                ? { clientPostSnapshotId: { in: clientSnapshots.map((snapshot) => snapshot.id) } }
                : undefined,
              competitorSnapshots.length
                ? {
                    competitorPostSnapshotId: {
                      in: competitorSnapshots.map((snapshot) => snapshot.id),
                    },
                  }
                : undefined,
            ].filter(Boolean) as Array<Record<string, unknown>>,
          },
          select: {
            id: true,
            isDownloaded: true,
            clientPostSnapshotId: true,
            competitorPostSnapshotId: true,
          },
        })
      : [];

  const eventCountByJob = new Map(eventsByJob.map((row) => [row.researchJobId, row._count._all] as const));

  const socialByJob = new Map<
    string,
    {
      profileCount: number;
      postCount: number;
      platforms: Set<string>;
    }
  >();
  for (const profile of socialProfiles) {
    const bucket = socialByJob.get(profile.researchJobId) || {
      profileCount: 0,
      postCount: 0,
      platforms: new Set<string>(),
    };
    bucket.profileCount += 1;
    bucket.postCount += profile._count.posts;
    bucket.platforms.add(profile.platform);
    socialByJob.set(profile.researchJobId, bucket);
  }

  const discoveredByJob = new Map<
    string,
    {
      total: number;
      bySelectionState: Record<string, number>;
      byStatus: Record<string, number>;
      byAvailability: Record<string, number>;
      scrapeReady: number;
      postsScrapedProfiles: number;
    }
  >();
  for (const competitor of discoveredCompetitors) {
    const bucket = discoveredByJob.get(competitor.researchJobId) || {
      total: 0,
      bySelectionState: {},
      byStatus: {},
      byAvailability: {},
      scrapeReady: 0,
      postsScrapedProfiles: 0,
    };
    bucket.total += 1;
    bucket.bySelectionState[competitor.selectionState] =
      (bucket.bySelectionState[competitor.selectionState] || 0) + 1;
    bucket.byStatus[competitor.status] = (bucket.byStatus[competitor.status] || 0) + 1;
    bucket.byAvailability[competitor.availabilityStatus] =
      (bucket.byAvailability[competitor.availabilityStatus] || 0) + 1;

    const selection = String(competitor.selectionState || '').toUpperCase();
    const isScrapePlatform =
      competitor.platform.toLowerCase() === 'instagram' ||
      competitor.platform.toLowerCase() === 'tiktok';
    if (isScrapePlatform && selection !== 'FILTERED_OUT' && selection !== 'REJECTED') {
      bucket.scrapeReady += 1;
    }
    if ((competitor.postsScraped || 0) > 0) bucket.postsScrapedProfiles += 1;
    discoveredByJob.set(competitor.researchJobId, bucket);
  }

  const candidatesByJob = new Map<
    string,
    {
      total: number;
      byState: Record<string, number>;
      byAvailability: Record<string, number>;
      bySource: Record<string, number>;
    }
  >();
  for (const candidate of candidateProfiles) {
    const bucket = candidatesByJob.get(candidate.researchJobId) || {
      total: 0,
      byState: {},
      byAvailability: {},
      bySource: {},
    };
    bucket.total += 1;
    bucket.byState[candidate.state] = (bucket.byState[candidate.state] || 0) + 1;
    bucket.byAvailability[candidate.availabilityStatus] =
      (bucket.byAvailability[candidate.availabilityStatus] || 0) + 1;
    bucket.bySource[candidate.source] = (bucket.bySource[candidate.source] || 0) + 1;
    candidatesByJob.set(candidate.researchJobId, bucket);
  }

  const snapshotByJob = new Map<
    string,
    {
      clientSnapshots: number;
      competitorSnapshots: number;
      clientPosts: number;
      competitorPosts: number;
    }
  >();
  for (const snapshot of clientSnapshots) {
    if (!snapshot.researchJobId) continue;
    const bucket = snapshotByJob.get(snapshot.researchJobId) || {
      clientSnapshots: 0,
      competitorSnapshots: 0,
      clientPosts: 0,
      competitorPosts: 0,
    };
    bucket.clientSnapshots += 1;
    bucket.clientPosts += snapshot._count.posts;
    snapshotByJob.set(snapshot.researchJobId, bucket);
  }
  for (const snapshot of competitorSnapshots) {
    if (!snapshot.researchJobId) continue;
    const bucket = snapshotByJob.get(snapshot.researchJobId) || {
      clientSnapshots: 0,
      competitorSnapshots: 0,
      clientPosts: 0,
      competitorPosts: 0,
    };
    bucket.competitorSnapshots += 1;
    bucket.competitorPosts += snapshot._count.posts;
    snapshotByJob.set(snapshot.researchJobId, bucket);
  }

  const mediaByJob = new Map<
    string,
    {
      total: number;
      downloaded: number;
    }
  >();
  for (const asset of mediaAssets) {
    const jobIdFromClient = asset.clientPostSnapshotId
      ? clientSnapshotJobById.get(asset.clientPostSnapshotId) || ''
      : '';
    const jobIdFromCompetitor = asset.competitorPostSnapshotId
      ? competitorSnapshotJobById.get(asset.competitorPostSnapshotId) || ''
      : '';
    const researchJobId = jobIdFromClient || jobIdFromCompetitor;
    if (!researchJobId) continue;

    const bucket = mediaByJob.get(researchJobId) || { total: 0, downloaded: 0 };
    bucket.total += 1;
    if (asset.isDownloaded) bucket.downloaded += 1;
    mediaByJob.set(researchJobId, bucket);
  }

  const aiByJob = new Map<
    string,
    {
      total: number;
      byType: Record<string, number>;
      documentTopics: Set<string>;
      documentCount: number;
    }
  >();
  for (const analysis of aiAnalyses) {
    if (!analysis.researchJobId) continue;
    const bucket = aiByJob.get(analysis.researchJobId) || {
      total: 0,
      byType: {},
      documentTopics: new Set<string>(),
      documentCount: 0,
    };
    bucket.total += 1;
    bucket.byType[analysis.analysisType] = (bucket.byType[analysis.analysisType] || 0) + 1;
    if (analysis.analysisType === 'DOCUMENT') {
      bucket.documentCount += 1;
      if (analysis.topic) bucket.documentTopics.add(analysis.topic);
    }
    aiByJob.set(analysis.researchJobId, bucket);
  }

  const calendarByJob = new Map<
    string,
    {
      runCount: number;
      completedRuns: number;
      totalSlots: number;
      statuses: string[];
    }
  >();
  for (const run of calendarRuns) {
    const bucket = calendarByJob.get(run.researchJobId) || {
      runCount: 0,
      completedRuns: 0,
      totalSlots: 0,
      statuses: [],
    };
    bucket.runCount += 1;
    if (run.status === 'COMPLETE') bucket.completedRuns += 1;
    bucket.totalSlots += run._count.slots;
    bucket.statuses.push(run.status);
    calendarByJob.set(run.researchJobId, bucket);
  }

  const jobSummaries = allJobs.map((job) => {
    const client = clients.find((row) => row.id === job.clientId);
    const accountPlatforms = Array.from(
      new Set((client?.clientAccounts || []).map((account) => account.platform.toLowerCase()))
    );

    const inputData = (job.inputData || {}) as Record<string, unknown>;
    const inputHandles =
      inputData.handles && typeof inputData.handles === 'object'
        ? (inputData.handles as Record<string, unknown>)
        : {};
    const inputHandleCount = Object.values(inputHandles).filter(
      (value) => String(value || '').trim().length > 0
    ).length;

    const confirmedChannels = Math.max(
      inputHandleCount,
      (client?.clientAccounts || []).filter((account) => String(account.handle || '').trim().length > 0)
        .length
    );

    const social = socialByJob.get(job.id) || { profileCount: 0, postCount: 0, platforms: new Set<string>() };
    const discovered = discoveredByJob.get(job.id) || {
      total: 0,
      bySelectionState: {},
      byStatus: {},
      byAvailability: {},
      scrapeReady: 0,
      postsScrapedProfiles: 0,
    };
    const candidates = candidatesByJob.get(job.id) || {
      total: 0,
      byState: {},
      byAvailability: {},
      bySource: {},
    };
    const snapshots = snapshotByJob.get(job.id) || {
      clientSnapshots: 0,
      competitorSnapshots: 0,
      clientPosts: 0,
      competitorPosts: 0,
    };
    const media = mediaByJob.get(job.id) || { total: 0, downloaded: 0 };
    const ai = aiByJob.get(job.id) || {
      total: 0,
      byType: {},
      documentTopics: new Set<string>(),
      documentCount: 0,
    };
    const calendar = calendarByJob.get(job.id) || {
      runCount: 0,
      completedRuns: 0,
      totalSlots: 0,
      statuses: [],
    };
    const mediaDownloadedRatio = safeRatio(media.downloaded, media.total);
    const snapshotPosts = snapshots.clientPosts + snapshots.competitorPosts;

    const completenessScore = scoreCompleteness({
      confirmedChannels,
      socialProfileCount: social.profileCount,
      socialPostCount: social.postCount,
      scrapeReadyCompetitors: discovered.scrapeReady,
      snapshotPosts,
      mediaDownloadedRatio,
      aiAnalysisCount: ai.total,
      documentSectionCount: ai.documentTopics.size,
      calendarSlots: calendar.totalSlots,
    });

    return {
      jobId: maybeAnonId(job.id, 'job', args.anonymize, salt),
      clientId: maybeAnonId(job.clientId, 'client', args.anonymize, salt),
      clientName: args.anonymize ? undefined : job.clientName,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      completenessScore,
      intake: {
        inputHandleCount,
        confirmedChannels,
        accountPlatforms,
      },
      social: {
        profileCount: social.profileCount,
        postCount: social.postCount,
        platforms: Array.from(social.platforms).sort(),
      },
      competitors: {
        discoveredTotal: discovered.total,
        discoveredBySelectionState: discovered.bySelectionState,
        discoveredByStatus: discovered.byStatus,
        discoveredByAvailability: discovered.byAvailability,
        scrapeReadyCount: discovered.scrapeReady,
        profilesWithPostsScraped: discovered.postsScrapedProfiles,
        candidateTotal: candidates.total,
        candidateByState: candidates.byState,
        candidateByAvailability: candidates.byAvailability,
        candidateBySource: candidates.bySource,
      },
      snapshots: {
        clientSnapshotCount: snapshots.clientSnapshots,
        competitorSnapshotCount: snapshots.competitorSnapshots,
        clientSnapshotPosts: snapshots.clientPosts,
        competitorSnapshotPosts: snapshots.competitorPosts,
        totalSnapshotPosts: snapshotPosts,
      },
      media: {
        totalAssets: media.total,
        downloadedAssets: media.downloaded,
        downloadedRatio: Number(mediaDownloadedRatio.toFixed(4)),
      },
      ai: {
        totalAnalyses: ai.total,
        byType: ai.byType,
        documentAnalysisCount: ai.documentCount,
        documentTopicCoverage: ai.documentTopics.size,
      },
      calendar: {
        runCount: calendar.runCount,
        completedRuns: calendar.completedRuns,
        totalSlots: calendar.totalSlots,
      },
      events: {
        total: eventCountByJob.get(job.id) || 0,
      },
    };
  });

  const scores = jobSummaries.map((job) => job.completenessScore);
  const medianScore = median(scores);
  const sortedByScore = [...jobSummaries].sort((a, b) => b.completenessScore - a.completenessScore);
  const topReference = sortedByScore.slice(0, Math.min(5, sortedByScore.length));
  const bottomReference = [...sortedByScore].reverse().slice(0, Math.min(5, sortedByScore.length));
  const medianReference = [...jobSummaries]
    .sort((a, b) => Math.abs(a.completenessScore - medianScore) - Math.abs(b.completenessScore - medianScore))
    .slice(0, Math.min(5, jobSummaries.length));

  const baseline = {
    metadata: {
      generatedAt,
      anonymized: args.anonymize,
      databaseUrlPresent: Boolean(process.env.DATABASE_URL),
      jobsAnalyzed: jobSummaries.length,
      clientsAnalyzed: clients.length,
      hashSaltConfigured: Boolean(process.env.BASELINE_HASH_SALT),
    },
    systemTotals: {
      clients: clients.length,
      researchJobs: jobSummaries.length,
      jobStatusCounts: toRecordCount(jobSummaries.map((job) => job.status)),
      averageCompletenessScore:
        jobSummaries.length > 0
          ? Number(
              (
                jobSummaries.reduce((sum, job) => sum + job.completenessScore, 0) /
                jobSummaries.length
              ).toFixed(2)
            )
          : 0,
      medianCompletenessScore: Number(medianScore.toFixed(2)),
    },
    referenceCohorts: {
      topReference,
      medianReference,
      bottomReference,
    },
    jobSummaries,
  };

  const mdLines: string[] = [];
  mdLines.push('# Current User Baseline');
  mdLines.push('');
  mdLines.push(`Generated: ${generatedAt}`);
  mdLines.push(`Anonymized: ${args.anonymize ? 'yes' : 'no'}`);
  mdLines.push(`Clients: ${clients.length}`);
  mdLines.push(`Research jobs: ${jobSummaries.length}`);
  mdLines.push(
    `Average completeness score: ${baseline.systemTotals.averageCompletenessScore} / 100 (median ${baseline.systemTotals.medianCompletenessScore})`
  );
  mdLines.push('');
  mdLines.push('## Job Status');
  mdLines.push('');
  for (const [status, count] of Object.entries(baseline.systemTotals.jobStatusCounts)) {
    mdLines.push(`- ${status}: ${count}`);
  }
  mdLines.push('');
  mdLines.push('## Top Reference Jobs');
  mdLines.push('');
  if (topReference.length === 0) {
    mdLines.push('- No jobs found.');
  } else {
    for (const job of topReference) {
      mdLines.push(
        `- ${job.jobId}: score=${job.completenessScore}, status=${job.status}, socialPosts=${job.social.postCount}, scrapeReady=${job.competitors.scrapeReadyCount}, downloadedRatio=${job.media.downloadedRatio}, docs=${job.ai.documentTopicCoverage}, calendarSlots=${job.calendar.totalSlots}`
      );
    }
  }
  mdLines.push('');
  mdLines.push('## Lowest Reference Jobs');
  mdLines.push('');
  if (bottomReference.length === 0) {
    mdLines.push('- No jobs found.');
  } else {
    for (const job of bottomReference) {
      mdLines.push(
        `- ${job.jobId}: score=${job.completenessScore}, status=${job.status}, socialPosts=${job.social.postCount}, scrapeReady=${job.competitors.scrapeReadyCount}, downloadedRatio=${job.media.downloadedRatio}, docs=${job.ai.documentTopicCoverage}, calendarSlots=${job.calendar.totalSlots}`
      );
    }
  }
  mdLines.push('');
  mdLines.push('## Usage');
  mdLines.push('');
  mdLines.push(
    '- Use these cohorts as reference journeys before implementing each enhancement packet.'
  );
  mdLines.push(
    '- Re-run this baseline after each packet and compare score shifts and blocker distributions.'
  );

  await mkdir(path.dirname(args.outJson), { recursive: true });
  await mkdir(path.dirname(args.outMd), { recursive: true });

  await writeFile(args.outJson, JSON.stringify(baseline, null, 2), 'utf8');
  await writeFile(args.outMd, `${mdLines.join('\n')}\n`, 'utf8');

  console.log(`[Baseline] Exported JSON: ${args.outJson}`);
  console.log(`[Baseline] Exported MD:   ${args.outMd}`);
  console.log(
    `[Baseline] Jobs=${jobSummaries.length}, AvgScore=${baseline.systemTotals.averageCompletenessScore}, MedianScore=${baseline.systemTotals.medianCompletenessScore}`
  );
}

main()
  .catch((error) => {
    console.error('[Baseline] Failed to export current user baseline:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
