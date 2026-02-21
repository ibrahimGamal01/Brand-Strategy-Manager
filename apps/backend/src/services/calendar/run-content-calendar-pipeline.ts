/**
 * Content Calendar Pipeline Orchestrator
 * Build context → Stage 1 (Processor) → validate → Stage 2 (Generator) → validate → persist.
 */

import { prisma } from '../../lib/prisma';
import { buildContentCalendarContext } from './content-calendar-context';
import { runContentCalendarProcessor } from './content-calendar-processor';
import { runContentCalendarGenerator, runDeterministicContentCalendarGenerator } from './content-calendar-generator';
import type { ContentCalendar, ContentCalendarSlot } from './calendar-validators';
import { scoreAndPersistJobSnapshotReadiness } from '../orchestration/content-readiness';

const STATUS_MAP: Record<string, 'PLANNED' | 'BLOCKED' | 'READY_TO_GENERATE'> = {
  planned: 'PLANNED',
  blocked: 'BLOCKED',
  ready_to_generate: 'READY_TO_GENERATE',
};

function fallbackScheduledAtIso(weekStart: string, dayOffset: number): string {
  const base = new Date(weekStart);
  const start = Number.isFinite(base.getTime()) ? base : new Date();
  start.setUTCDate(start.getUTCDate() + Math.max(0, dayOffset));
  const dateStr = start.toISOString().slice(0, 10);
  return `${dateStr}T14:00:00.000Z`;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export interface RunContentCalendarPipelineResult {
  runId: string;
  weekStart: string;
  timezone: string;
  slotsCount: number;
  contentCalendar: ContentCalendar;
}

export async function runContentCalendarPipeline(
  researchJobId: string,
  options: { weekStart?: string; timezone?: string; durationDays?: number } = {}
): Promise<RunContentCalendarPipelineResult> {
  await scoreAndPersistJobSnapshotReadiness(researchJobId);
  console.log('[Calendar Pipeline] Building context for job:', researchJobId);
  const context = await buildContentCalendarContext(researchJobId, {
    durationDays: options.durationDays,
  });

  console.log('[Calendar Pipeline] Stage 1: Processor');
  const { brief, errors: processorErrors } = await runContentCalendarProcessor(context, {
    durationDays: options.durationDays,
  });
  const usedFallback = processorErrors.some((e) => e.toLowerCase().includes('fallback'));

  console.log('[Calendar Pipeline] Stage 2: Generator');
  const generatorConfig = {
    durationDays: options.durationDays,
    timezone: options.timezone || context.client.timezone,
    weekStart: options.weekStart,
  };
  const contentCalendar = usedFallback
    ? runDeterministicContentCalendarGenerator(brief, generatorConfig)
    : await runContentCalendarGenerator(brief, generatorConfig);

  const weekStart = contentCalendar.meta?.weekStart || new Date().toISOString().slice(0, 10);
  const timezone = contentCalendar.meta?.timezone || 'Africa/Cairo';

  const run = await prisma.contentCalendarRun.create({
    data: {
      researchJobId,
      weekStart: new Date(weekStart),
      timezone,
      calendarBriefJson: brief as unknown as object,
      contentCalendarJson: contentCalendar as unknown as object,
      status: 'COMPLETE',
      diagnostics: {
        processorErrors,
        usedFallback,
      } as object,
      completedAt: new Date(),
    },
  });

  const schedule = contentCalendar.schedule || [];
  const briefSlots = brief.slots || [];
  const validPostIds = new Set(
    (context.posts || [])
      .map((post) => String(post?.postId || '').trim())
      .filter(Boolean)
  );
  let forcedBlockedForEvidence = 0;
  let fallbackScheduledAtCount = 0;
  let fallbackSlotIndexCount = 0;
  let droppedInvalidInspirationRefs = 0;
  for (const [loopIndex, slot] of schedule.entries()) {
    const briefSlot =
      (typeof slot.slotIndex === 'number' && Number.isInteger(slot.slotIndex)
        ? briefSlots[slot.slotIndex]
        : undefined) ||
      briefSlots.find((item) => item.slotIndex === slot.slotIndex) ||
      briefSlots[loopIndex];

    const slotIndex = Number.isInteger(slot.slotIndex)
      ? Number(slot.slotIndex)
      : Number.isInteger(briefSlot?.slotIndex)
        ? Number(briefSlot?.slotIndex)
        : loopIndex;
    if (!Number.isInteger(slot.slotIndex)) {
      fallbackSlotIndexCount += 1;
    }

    const platform = String(slot.platform || briefSlot?.platform || 'instagram')
      .trim()
      .toLowerCase();
    const contentType = String(
      slot.contentType || briefSlot?.contentType || (platform === 'tiktok' ? 'video' : 'reel')
    )
      .trim()
      .toLowerCase();

    const mappedStatus = STATUS_MAP[(slot.status || 'planned').toLowerCase()] || 'PLANNED';
    const inspirationPosts =
      Array.isArray(slot.inspirationPosts) && slot.inspirationPosts.length > 0
        ? slot.inspirationPosts
        : briefSlot?.inspirationPosts || [];
    const rawInspirationPostIds = dedupe(
      inspirationPosts.map((p) => String(p?.postId || '').trim()).filter(Boolean)
    );
    const inspirationPostIds = rawInspirationPostIds.filter((postId) => validPostIds.has(postId));
    droppedInvalidInspirationRefs += Math.max(0, rawInspirationPostIds.length - inspirationPostIds.length);
    let status = mappedStatus;
    let blockReason = String((slot as ContentCalendarSlot & { blockReason?: string }).blockReason || '').trim();

    const rawScheduledAt = String((slot as ContentCalendarSlot).scheduledAt || '').trim();
    const scheduledAtDate =
      Number.isFinite(new Date(rawScheduledAt).getTime())
        ? new Date(rawScheduledAt)
        : new Date(fallbackScheduledAtIso(weekStart, loopIndex));
    if (!Number.isFinite(new Date(rawScheduledAt).getTime())) {
      fallbackScheduledAtCount += 1;
    }

    if (inspirationPostIds.length === 0 && status !== 'BLOCKED') {
      status = 'BLOCKED';
      blockReason = 'MISSING_INSPIRATION_EVIDENCE';
      forcedBlockedForEvidence += 1;
    }
    if (status === 'BLOCKED' && !blockReason) {
      blockReason = 'BLOCKED_BY_GENERATOR';
    }

    await prisma.calendarSlot.create({
      data: {
        calendarRunId: run.id,
        slotIndex,
        platform,
        contentType,
        scheduledAt: scheduledAtDate,
        theme: slot.theme ?? undefined,
        pillarId: slot.pillarId ?? undefined,
        objective: slot.objective ?? briefSlot?.objective ?? undefined,
        productionBriefJson: (slot.productionBrief || {}) as object,
        generationPlanJson: (slot.generationPlan || {}) as object,
        inspirationPostIds,
        status,
        blockReason: blockReason || undefined,
      },
    });
  }

  if (forcedBlockedForEvidence > 0) {
    await prisma.contentCalendarRun.update({
      where: { id: run.id },
      data: {
        diagnostics: {
          processorErrors,
          usedFallback,
          forcedBlockedForEvidence,
          fallbackScheduledAtCount,
          fallbackSlotIndexCount,
          droppedInvalidInspirationRefs,
        } as object,
      },
    });
  } else if (fallbackScheduledAtCount > 0 || fallbackSlotIndexCount > 0) {
    await prisma.contentCalendarRun.update({
      where: { id: run.id },
      data: {
        diagnostics: {
          processorErrors,
          usedFallback,
          fallbackScheduledAtCount,
          fallbackSlotIndexCount,
          droppedInvalidInspirationRefs,
        } as object,
      },
    });
  } else if (droppedInvalidInspirationRefs > 0) {
    await prisma.contentCalendarRun.update({
      where: { id: run.id },
      data: {
        diagnostics: {
          processorErrors,
          usedFallback,
          droppedInvalidInspirationRefs,
        } as object,
      },
    });
  }

  console.log('[Calendar Pipeline] Persisted run', run.id, 'with', schedule.length, 'slots');

  return {
    runId: run.id,
    weekStart,
    timezone,
    slotsCount: schedule.length,
    contentCalendar,
  };
}
