/**
 * Content Calendar API
 * POST /api/research-jobs/:id/content-calendar - generate calendar (7/14/30/90 days)
 * GET  /api/research-jobs/:id/content-calendar?weekStart=YYYY-MM-DD - returns run with most slots for job
 * POST /api/research-jobs/:id/content-calendar/slots/:slotId/generate - save draft with creative prompt
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { runContentCalendarPipeline } from '../services/calendar/run-content-calendar-pipeline';
import { buildCreativePrompt } from '../services/calendar/build-creative-prompt';

const router = Router();

router.post('/:id/content-calendar', async (req: Request, res: Response) => {
  try {
    const { id: researchJobId } = req.params;
    const { weekStart, timezone } = req.body || {};
    const durationDaysRaw = Number(req.body?.durationDays || 14);
    const durationDays = [7, 14, 30, 90].includes(durationDaysRaw) ? durationDaysRaw : 14;

    const job = await prisma.researchJob.findUnique({
      where: { id: researchJobId },
    });
    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }

    const result = await runContentCalendarPipeline(researchJobId, {
      durationDays,
      weekStart: weekStart || undefined,
      timezone: timezone || undefined,
    });

    res.json({
      runId: result.runId,
      weekStart: result.weekStart,
      timezone: result.timezone,
      durationDays,
      slotsCount: result.slotsCount,
      contentCalendar: result.contentCalendar,
    });
  } catch (e: any) {
    console.error('[Content Calendar API] POST error:', e);
    res.status(500).json({
      error: 'Failed to generate content calendar',
      message: e?.message || String(e),
    });
  }
});

router.get('/:id/content-calendar', async (req: Request, res: Response) => {
  try {
    const { id: researchJobId } = req.params;
    const weekStartParam = req.query.weekStart as string | undefined;

    const runs = await prisma.contentCalendarRun.findMany({
      where: {
        researchJobId,
        ...(weekStartParam
          ? {
              weekStart: new Date(weekStartParam),
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        slots: true,
      },
    });

    // Prefer the run with the most slots (e.g. 14-day over 1-slot) so the best calendar is shown
    const run = runs.length === 0
      ? null
      : runs.reduce((best, r) => (r.slots.length >= best.slots.length ? r : best), runs[0]);

    if (!run) {
      return res.status(404).json({
        status: 'NONE',
        message: 'No content calendar run found',
      });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    const contentCalendar = run.contentCalendarJson as any;
    const durationDays =
      Number(contentCalendar?.meta?.durationDays) ||
      Number(contentCalendar?.schedule?.length) ||
      Number(run.slots.length) ||
      14;
    const schedule = contentCalendar?.schedule || [];
    const scheduleByIndex = schedule.reduce((acc: Record<number, any>, s: any) => {
      acc[s.slotIndex] = s;
      return acc;
    }, {});
    const brief = run.calendarBriefJson as any;
    const briefSlots = brief?.slots || [];

    const slots = run.slots.map((s) => {
      const scheduleSlot = scheduleByIndex[s.slotIndex];
      const inspirationPosts =
        scheduleSlot?.inspirationPosts?.length > 0
          ? scheduleSlot.inspirationPosts
          : briefSlots[s.slotIndex]?.inspirationPosts ?? [];
      return {
        id: s.id,
        slotIndex: s.slotIndex,
        platform: s.platform,
        contentType: s.contentType,
        scheduledAt: s.scheduledAt,
        theme: s.theme,
        pillarId: s.pillarId,
        objective: s.objective,
        status: s.status,
        inspirationPostIds: s.inspirationPostIds,
        inspirationPosts,
        productionBrief: scheduleSlot?.productionBrief ?? null,
      };
    });

    res.json({
      runId: run.id,
      weekStart: run.weekStart.toISOString().slice(0, 10),
      timezone: run.timezone,
      durationDays,
      status: run.status,
      slotsCount: slots.length,
      contentCalendar,
      slots,
    });
  } catch (e: any) {
    console.error('[Content Calendar API] GET error:', e);
    res.status(500).json({
      error: 'Failed to fetch content calendar',
      message: e?.message || String(e),
    });
  }
});

router.post('/:id/content-calendar/slots/:slotId/generate', async (req: Request, res: Response) => {
  try {
    const { id: researchJobId, slotId } = req.params;
    const { creativePrompt: creativePromptOverride } = req.body || {};

    const slot = await prisma.calendarSlot.findUnique({
      where: { id: slotId },
      include: {
        calendarRun: true,
      },
    });
    if (!slot || slot.calendarRun.researchJobId !== researchJobId) {
      return res.status(404).json({ error: 'Slot not found or does not belong to this job' });
    }

    const run = slot.calendarRun;
    const contentCalendar = run.contentCalendarJson as any;
    const scheduleSlot = (contentCalendar?.schedule || []).find(
      (s: any) => s.slotIndex === slot.slotIndex
    );
    const inspirationPosts = scheduleSlot?.inspirationPosts ?? [];
    const productionBrief = scheduleSlot?.productionBrief;

    const creativePrompt =
      typeof creativePromptOverride === 'string' && creativePromptOverride.trim()
        ? creativePromptOverride.trim()
        : buildCreativePrompt(productionBrief, inspirationPosts);

    const maxVersion = await prisma.contentDraft
      .aggregate({
        where: { slotId },
        _max: { version: true },
      })
      .then((r) => r._max.version ?? 0);
    const version = maxVersion + 1;

    const draft = await prisma.contentDraft.create({
      data: {
        slotId,
        version,
        status: 'DRAFT',
        caption: creativePrompt,
        usedInspirationPostIds: slot.inspirationPostIds,
        generationParams: { source: 'user_edited_prompt' },
      },
    });

    res.json({
      id: draft.id,
      slotId: draft.slotId,
      version: draft.version,
      status: draft.status,
      caption: draft.caption,
      usedInspirationPostIds: draft.usedInspirationPostIds,
    });
  } catch (e: any) {
    console.error('[Content Calendar API] POST slot generate error:', e);
    res.status(500).json({
      error: 'Failed to save draft',
      message: e?.message || String(e),
    });
  }
});

export default router;
