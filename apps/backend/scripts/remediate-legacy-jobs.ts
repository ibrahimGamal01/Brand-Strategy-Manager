import { Prisma } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { isOpenAiConfiguredForRealMode } from '../src/lib/runtime-preflight';
import { generateStrategyDocument } from '../src/services/ai/generators';
import {
  backfillFinalDocumentGroundingReadiness,
  buildGroundingReportFromQualityGate,
  toPrismaJson,
} from '../src/services/ai/generators/grounding-report';
import { evaluateStrategyQualityGate } from '../src/services/ai/generators/strategy-quality-gate';
import { continueCompetitorScrape } from '../src/services/discovery/competitor-orchestrator-v2';
import { scoreAndPersistJobSnapshotReadiness } from '../src/services/orchestration/content-readiness';
import { runContentCalendarPipeline } from '../src/services/calendar/run-content-calendar-pipeline';
import { seedTopPicksFromInspirationLinks } from '../src/services/discovery/seed-intake-competitors';

const SECTION_MAPPING_KEY_TO_DB: Record<string, string> = {
  businessUnderstanding: 'business_understanding',
  targetAudience: 'target_audience',
  industryOverview: 'industry_overview',
  priorityCompetitor: 'priority_competitor',
  contentAnalysis: 'content_analysis',
  contentPillars: 'content_pillars',
  formatRecommendations: 'format_recommendations',
  buyerJourney: 'buyer_journey',
  platformStrategy: 'platform_strategy',
};

function buildSectionsForPersist(sections: Record<string, string>): Record<string, string> {
  return Object.entries(sections).reduce((acc, [key, value]) => {
    const content = String(value || '').trim();
    if (content.length > 0 && SECTION_MAPPING_KEY_TO_DB[key]) {
      acc[key] = content;
    }
    return acc;
  }, {} as Record<string, string>);
}

async function persistStrategySections(input: {
  researchJobId: string;
  sections: Record<string, string>;
  documentStatus: 'FINAL' | 'DRAFT';
  groundingReport: Prisma.InputJsonValue;
}): Promise<number> {
  const topics = Object.keys(input.sections)
    .map((sectionKey) => SECTION_MAPPING_KEY_TO_DB[sectionKey])
    .filter(Boolean);

  if (topics.length === 0) return 0;

  await prisma.aiAnalysis.deleteMany({
    where: {
      researchJobId: input.researchJobId,
      analysisType: 'DOCUMENT',
      topic: { in: topics },
      ...(input.documentStatus === 'DRAFT' ? { documentStatus: 'DRAFT' } : {}),
    },
  });

  const data = Object.entries(input.sections).map(([sectionKey, fullResponse]) => ({
    researchJobId: input.researchJobId,
    topic: SECTION_MAPPING_KEY_TO_DB[sectionKey],
    fullResponse,
    analysisType: 'DOCUMENT' as const,
    modelUsed: 'gpt-4o',
    tokensUsed: 0,
    documentStatus: input.documentStatus,
    groundingReport: input.groundingReport,
  }));

  if (data.length === 0) return 0;
  await prisma.aiAnalysis.createMany({ data });
  return data.length;
}

function parseArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function resolveReportPath(fileName: string): string {
  return path.resolve(__dirname, '..', '..', '..', 'docs', 'baselines', fileName);
}

async function getJobSnapshot(jobId: string) {
  const [
    docsFinal,
    docsDraft,
    calendarRuns,
    competitorCandidates,
    competitorSnapshots,
    clientSnapshots,
  ] = await Promise.all([
    prisma.aiAnalysis.count({
      where: {
        researchJobId: jobId,
        analysisType: 'DOCUMENT',
        OR: [{ documentStatus: 'FINAL' }, { documentStatus: null }],
      },
    }),
    prisma.aiAnalysis.count({
      where: {
        researchJobId: jobId,
        analysisType: 'DOCUMENT',
        documentStatus: 'DRAFT',
      },
    }),
    prisma.contentCalendarRun.count({ where: { researchJobId: jobId } }),
    prisma.competitorCandidateProfile.count({ where: { researchJobId: jobId } }),
    prisma.competitorProfileSnapshot.count({ where: { researchJobId: jobId } }),
    prisma.clientProfileSnapshot.count({ where: { researchJobId: jobId } }),
  ]);

  return {
    docsFinal,
    docsDraft,
    calendarRuns,
    competitorCandidates,
    competitorSnapshots,
    clientSnapshots,
  };
}

async function run() {
  const targetJobId = parseArgValue('--job');
  const dryRun = process.argv.includes('--dry-run');
  const refreshExistingDocs = process.argv.includes('--refresh-existing-docs');
  const refreshCalendar = process.argv.includes('--refresh-calendar');
  const refreshIntakeCompetitors = process.argv.includes('--refresh-intake-competitors');
  const requestedCalendarDays = Number(parseArgValue('--calendar-days') || 14);
  const calendarDays = [7, 14, 30, 90].includes(requestedCalendarDays)
    ? requestedCalendarDays
    : 14;
  const openAiConfigured = isOpenAiConfiguredForRealMode();

  const jobs = await prisma.researchJob.findMany({
    where: targetJobId ? { id: targetJobId } : undefined,
    include: {
      client: {
        select: { name: true },
      },
    },
    orderBy: { startedAt: 'asc' },
  });

  if (jobs.length === 0) {
    throw new Error(targetJobId ? `No job found for id ${targetJobId}` : 'No research jobs found');
  }

  const report: string[] = [];
  report.push(`# Legacy Remediation Report (${new Date().toISOString()})`);
  report.push(`- dryRun: ${dryRun}`);
  report.push(`- openAiConfigured: ${openAiConfigured}`);
  report.push(`- refreshExistingDocs: ${refreshExistingDocs}`);
  report.push(`- refreshCalendar: ${refreshCalendar}`);
  report.push(`- refreshIntakeCompetitors: ${refreshIntakeCompetitors}`);
  report.push(`- calendarDays: ${calendarDays}`);
  report.push(`- jobsProcessed: ${jobs.length}`);
  report.push('');

  for (const job of jobs) {
    report.push(`## Job ${job.id}`);
    report.push(`- client: ${job.client?.name || '(no name)'}`);
    report.push(`- status: ${job.status}`);

    const before = await getJobSnapshot(job.id);
    report.push(`- before.docsFinal: ${before.docsFinal}`);
    report.push(`- before.docsDraft: ${before.docsDraft}`);
    report.push(`- before.calendarRuns: ${before.calendarRuns}`);
    report.push(`- before.competitorCandidates: ${before.competitorCandidates}`);
    report.push(`- before.competitorSnapshots: ${before.competitorSnapshots}`);
    report.push(`- before.clientSnapshots: ${before.clientSnapshots}`);

    const readiness = await scoreAndPersistJobSnapshotReadiness(job.id);
    const readyClient = readiness.client.filter((row) => row.status === 'READY').length;
    const readyCompetitor = readiness.competitor.filter((row) => row.status === 'READY').length;
    report.push(`- readiness.clientReady: ${readyClient}/${readiness.client.length}`);
    report.push(`- readiness.competitorReady: ${readyCompetitor}/${readiness.competitor.length}`);

    if (refreshIntakeCompetitors) {
      const inputData = (job.inputData || {}) as Record<string, unknown>;
      const links = Array.isArray(inputData.competitorInspirationLinks)
        ? (inputData.competitorInspirationLinks as string[])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : [];
      if (links.length === 0) {
        report.push('- action.refreshIntakeCompetitors: skipped (no competitorInspirationLinks)');
      } else if (dryRun) {
        report.push(`- action.refreshIntakeCompetitors: skipped (dry-run, links=${links.length})`);
      } else {
        const seeded = await seedTopPicksFromInspirationLinks(job.id, links);
        report.push(`- action.refreshIntakeCompetitors: reseeded topPicks=${seeded.topPicks}`);
      }
    } else {
      report.push('- action.refreshIntakeCompetitors: not requested');
    }

    if (readyCompetitor === 0 && before.competitorCandidates > 0) {
      if (!dryRun) {
        const queueResult = await continueCompetitorScrape(job.id, {
          onlyPending: true,
          forceUnavailable: true,
          forceMaterialize: true,
        });
        report.push(`- action.queueCompetitors: queued=${queueResult.queuedCount}, skipped=${queueResult.skippedCount}`);
      } else {
        report.push('- action.queueCompetitors: skipped (dry-run)');
      }
    } else {
      report.push('- action.queueCompetitors: not needed');
    }

    const groundingBackfill = await backfillFinalDocumentGroundingReadiness(job.id, {
      dryRun,
      source: 'legacy_remediation_backfill',
    });
    report.push(
      `- action.backfillDocGroundingReadiness: checked=${groundingBackfill.checked}, missing=${groundingBackfill.missing}, updated=${groundingBackfill.updated}${dryRun ? ' (dry-run)' : ''}`
    );

    const shouldGenerateStrategy = before.docsFinal === 0 || refreshExistingDocs;
    if (shouldGenerateStrategy) {
      if (!openAiConfigured) {
        report.push('- action.generateStrategy: skipped (OpenAI not configured)');
      } else if (dryRun) {
        report.push('- action.generateStrategy: skipped (dry-run)');
      } else {
        try {
          const generated = await generateStrategyDocument(job.id, ['all']);
          const qualityGate = await evaluateStrategyQualityGate({
            researchJobId: job.id,
            sections: generated.sections,
            requestedSections: ['all'],
            mode: 'document',
            minSectionScore: 80,
          });

          const sections = buildSectionsForPersist(qualityGate.correctedSections);
          const groundingReport = toPrismaJson(await buildGroundingReportFromQualityGate(
            job.id,
            qualityGate,
            {
              blocked: !qualityGate.allowPersist,
              defaultSource: 'legacy_remediation',
              readiness: qualityGate.readiness,
            }
          ));

          if (!qualityGate.allowPersist) {
            const persistedDraft = await persistStrategySections({
              researchJobId: job.id,
              sections,
              documentStatus: 'DRAFT',
              groundingReport,
            });
            report.push(
              `- action.generateStrategy: persisted DRAFT sections=${persistedDraft} blockedBy=${qualityGate.reasonCodes.join(',')}`
            );
          } else {
            const persistedFinal = await persistStrategySections({
              researchJobId: job.id,
              sections,
              documentStatus: 'FINAL',
              groundingReport,
            });
            report.push(`- action.generateStrategy: persisted FINAL sections=${persistedFinal}`);
          }
        } catch (error: any) {
          report.push(`- action.generateStrategy: failed (${error?.message || String(error)})`);
        }
      }
    } else {
      report.push('- action.generateStrategy: not needed (final docs exist)');
    }

    const afterDocs = await getJobSnapshot(job.id);

    const calendarEligible =
      afterDocs.docsFinal > 0 && readyClient > 0 && readyCompetitor > 0;
    const shouldGenerateCalendar =
      calendarEligible && (afterDocs.calendarRuns === 0 || refreshCalendar);

    if (shouldGenerateCalendar) {
      if (dryRun) {
        report.push('- action.generateCalendar: skipped (dry-run)');
      } else {
        try {
          const calendar = await runContentCalendarPipeline(job.id, { durationDays: calendarDays });
          report.push(`- action.generateCalendar: created run=${calendar.runId} slots=${calendar.slotsCount}`);
        } catch (error: any) {
          report.push(`- action.generateCalendar: failed (${error?.message || String(error)})`);
        }
      }
    } else {
      report.push('- action.generateCalendar: not eligible yet');
    }

    const after = await getJobSnapshot(job.id);
    report.push(`- after.docsFinal: ${after.docsFinal}`);
    report.push(`- after.docsDraft: ${after.docsDraft}`);
    report.push(`- after.calendarRuns: ${after.calendarRuns}`);
    report.push('');
  }

  const reportPath = resolveReportPath('legacy-remediation-report.md');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${report.join('\n')}\n`, 'utf8');
  console.log(`[LegacyRemediation] Report written: ${reportPath}`);
}

run()
  .catch((error) => {
    console.error('[LegacyRemediation] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
