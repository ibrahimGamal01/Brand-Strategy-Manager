import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';

function resolveReportPath(fileName: string): string {
  return path.resolve(__dirname, '..', '..', '..', 'docs', 'baselines', fileName);
}

async function run() {
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      researchJobs: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          _count: {
            select: {
              socialProfiles: true,
              discoveredCompetitors: true,
              competitorProfileSnapshots: true,
              clientProfileSnapshots: true,
              aiAnalyses: true,
              contentCalendarRuns: true,
            },
          },
        },
        orderBy: { startedAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const outputRows: string[] = [];
  outputRows.push(`# Old Client Audit (${new Date().toISOString()})`);
  outputRows.push('');

  for (const client of clients) {
    outputRows.push(`## Client ${client.id}`);
    outputRows.push(`- name: ${client.name || '(no name)'}`);
    outputRows.push(`- createdAt: ${client.createdAt.toISOString()}`);

    for (const job of client.researchJobs) {
      const [
        docsFinal,
        docsDraft,
        readyClientSnapshots,
        readyCompetitorSnapshots,
        socialPostsCount,
        calendarSlots,
        mediaDownloaded,
      ] = await Promise.all([
        prisma.aiAnalysis.count({
          where: {
            researchJobId: job.id,
            analysisType: 'DOCUMENT',
            OR: [{ documentStatus: 'FINAL' }, { documentStatus: null }],
          },
        }),
        prisma.aiAnalysis.count({
          where: {
            researchJobId: job.id,
            analysisType: 'DOCUMENT',
            documentStatus: 'DRAFT',
          },
        }),
        prisma.clientProfileSnapshot.count({
          where: {
            researchJobId: job.id,
            readinessStatus: 'READY',
          },
        }),
        prisma.competitorProfileSnapshot.count({
          where: {
            researchJobId: job.id,
            readinessStatus: 'READY',
          },
        }),
        prisma.socialPost.count({
          where: {
            socialProfile: {
              researchJobId: job.id,
            },
          },
        }),
        prisma.calendarSlot.count({
          where: {
            calendarRun: { researchJobId: job.id },
          },
        }),
        prisma.mediaAsset.count({
          where: {
            isDownloaded: true,
            OR: [
              { clientPostSnapshot: { clientProfileSnapshot: { researchJobId: job.id } } },
              { competitorPostSnapshot: { competitorProfileSnapshot: { researchJobId: job.id } } },
            ],
          },
        }),
      ]);

      outputRows.push(`### Job ${job.id}`);
      outputRows.push(`- status: ${job.status}`);
      outputRows.push(`- startedAt: ${job.startedAt.toISOString()}`);
      outputRows.push(`- completedAt: ${job.completedAt ? job.completedAt.toISOString() : 'null'}`);
      outputRows.push(`- socialProfiles: ${job._count.socialProfiles}`);
      outputRows.push(`- socialPosts: ${socialPostsCount}`);
      outputRows.push(`- discoveredCompetitors: ${job._count.discoveredCompetitors}`);
      outputRows.push(`- clientSnapshots: ${job._count.clientProfileSnapshots}`);
      outputRows.push(`- competitorSnapshots: ${job._count.competitorProfileSnapshots}`);
      outputRows.push(`- readyClientSnapshots: ${readyClientSnapshots}`);
      outputRows.push(`- readyCompetitorSnapshots: ${readyCompetitorSnapshots}`);
      outputRows.push(`- mediaDownloaded: ${mediaDownloaded}`);
      outputRows.push(`- aiAnalyses: ${job._count.aiAnalyses}`);
      outputRows.push(`- docsFinal: ${docsFinal}`);
      outputRows.push(`- docsDraft: ${docsDraft}`);
      outputRows.push(`- calendarRuns: ${job._count.contentCalendarRuns}`);
      outputRows.push(`- calendarSlots: ${calendarSlots}`);
      outputRows.push('');
    }
  }

  const reportPath = resolveReportPath('old-client-audit.md');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${outputRows.join('\n')}\n`, 'utf8');
  console.log(`[OldClientAudit] Report written: ${reportPath}`);
}

run()
  .catch((error) => {
    console.error('[OldClientAudit] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
