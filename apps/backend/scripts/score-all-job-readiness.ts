import { prisma } from '../src/lib/prisma';
import { scoreAndPersistJobSnapshotReadiness } from '../src/services/orchestration/content-readiness';

async function run() {
  const jobs = await prisma.researchJob.findMany({
    select: { id: true, status: true, client: { select: { name: true } } },
    orderBy: { startedAt: 'asc' },
  });

  for (const job of jobs) {
    const summary = await scoreAndPersistJobSnapshotReadiness(job.id);
    const clientReady = summary.client.filter((row) => row.status === 'READY').length;
    const competitorReady = summary.competitor.filter((row) => row.status === 'READY').length;
    const clientBlocked = summary.client.filter((row) => row.status === 'BLOCKED').length;
    const competitorBlocked = summary.competitor.filter((row) => row.status === 'BLOCKED').length;

    console.log(
      `[Readiness] ${job.id} (${job.client?.name || 'client'}) status=${job.status} ` +
        `client ready=${clientReady}/${summary.client.length} blocked=${clientBlocked} ` +
        `competitor ready=${competitorReady}/${summary.competitor.length} blocked=${competitorBlocked}`
    );
  }
}

run()
  .catch((error) => {
    console.error('[Readiness] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
