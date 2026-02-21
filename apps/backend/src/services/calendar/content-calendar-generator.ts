/**
 * Stage 2: Content Calendar Generator
 * Converts CalendarBrief → ContentCalendar (schedule + productionBrief + generationPlan per slot).
 * Uses deterministic scheduling in code; LLM fills productionBrief + generationPlan.
 */

import { openai } from '../ai/openai-client';
import type { CalendarBrief } from './calendar-validators';
import type { ContentCalendar, ContentCalendarSlot } from './calendar-validators';
import { validateContentCalendar, parseJsonSafe } from './calendar-validators';
import { CONTENT_CALENDAR_PROMPTS } from '../ai/prompts/content-calendar-prompts';

const MODEL = 'gpt-4o';
const MAX_REPAIR_ATTEMPTS = 1;

const DEFAULT_POSTING_WINDOWS: Record<string, string[]> = {
  instagram: ['12:00', '18:30', '21:00'],
  tiktok: ['14:00', '20:00'],
};

const CTA_BY_OBJECTIVE: Record<string, string> = {
  awareness: 'Follow for more practical insights.',
  education: 'Save this post and share it with someone who needs it.',
  engagement: 'Comment your biggest challenge below.',
  conversion: 'Send us a DM with \"START\" for the next step.',
  retention: 'Come back tomorrow for the next part.',
};

function objectiveCta(objective: string | undefined): string {
  const key = String(objective || '').toLowerCase();
  return CTA_BY_OBJECTIVE[key] || CTA_BY_OBJECTIVE.awareness;
}

function workflowKeyForType(platform: string, contentType: string): string {
  const p = String(platform || '').toLowerCase();
  const t = String(contentType || '').toLowerCase();
  if (p === 'tiktok' || t === 'video') return 'short_video_workflow';
  if (t === 'carousel') return 'carousel_creation_workflow';
  if (t === 'image') return 'single_image_workflow';
  if (t === 'story') return 'story_creation_workflow';
  return 'reel_creation_workflow';
}

function renderParamsForType(contentType: string): Record<string, string> {
  const t = String(contentType || '').toLowerCase();
  if (t === 'carousel' || t === 'image') return { format: 'jpg', resolution: '1080x1080' };
  if (t === 'story') return { format: 'jpg', resolution: '1080x1920' };
  return { format: 'mp4', resolution: '1080x1920' };
}

function deliverableSpecForType(contentType: string): Record<string, string | number> {
  const t = String(contentType || '').toLowerCase();
  if (t === 'carousel') return { slideCount: 6, aspectRatio: '1:1' };
  if (t === 'image') return { aspectRatio: '1:1' };
  if (t === 'story') return { frameCount: 3, aspectRatio: '9:16' };
  return { duration: '30-45 seconds', aspectRatio: '9:16' };
}

function cleanThemeLabel(raw: string | undefined): string {
  const cleaned = String(raw || '')
    .replace(/^#+\s*/g, '')
    .replace(/^part\s+\d+\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Growth';
}

function captionForObjective(theme: string, objective: string, cta: string): string {
  const key = String(objective || '').toLowerCase();
  if (key === 'education') return `${theme}: save this practical framework for your next post.\n\n${cta}`;
  if (key === 'engagement') return `${theme}: tell us your biggest blocker in the comments.\n\n${cta}`;
  if (key === 'conversion') return `${theme}: here is the next move if you are ready to act.\n\n${cta}`;
  if (key === 'retention') return `${theme}: this is part of a weekly sequence, do not miss tomorrow.\n\n${cta}`;
  return `${theme}: one practical move you can apply today.\n\n${cta}`;
}

export function runDeterministicContentCalendarGenerator(
  brief: CalendarBrief,
  config: GeneratorConfig = {}
): ContentCalendar {
  const durationDays = [7, 14, 30, 90].includes(Number(config.durationDays || 14))
    ? Number(config.durationDays || 14)
    : 14;
  const timezone = config.timezone || brief.meta?.timezone || 'Africa/Cairo';
  const weekStart = config.weekStart || nextMonday(timezone);
  const scheduleScaffold = assignScheduledAt(brief.slots || [], weekStart, timezone);
  const slots = brief.slots || [];

  const schedule: ContentCalendarSlot[] = slots.map((slot, idx) => {
    const slotIndex = Number.isInteger(slot.slotIndex) ? Number(slot.slotIndex) : idx;
    const platform = String(slot.platform || 'instagram').toLowerCase();
    const contentType = String(slot.contentType || (platform === 'tiktok' ? 'video' : 'reel')).toLowerCase();
    const objective = String(slot.objective || 'Awareness');
    const theme = cleanThemeLabel(slot.theme);
    const inspirationPosts = Array.isArray(slot.inspirationPosts) ? slot.inspirationPosts.slice(0, 3) : [];
    const hasInspiration = inspirationPosts.length > 0;
    const cta = objectiveCta(objective);

    const scriptOutline = [
      `Hook: ${slot.suggestedHook || `Start with a sharp insight about ${theme}.`}`,
      `Body: Deliver 2-3 practical points tied to "${slot.briefConcept || theme}".`,
      `Evidence: Reference the style/angle of selected inspiration posts while keeping original wording.`,
      `Close: ${cta}`,
    ].join('\n');

    return {
      slotId: `slot-${slotIndex}`,
      slotIndex,
      platform,
      contentType,
      scheduledAt: scheduleScaffold.get(slotIndex) || `${weekStart}T14:00:00.000Z`,
      theme,
      pillarId: slot.pillarId,
      objective,
      inspirationPosts,
      productionBrief: {
        hook: slot.suggestedHook || `Start with a high-tension question around ${theme}.`,
        structure: 'Hook → Value → Proof → CTA',
        script: scriptOutline,
        caption: captionForObjective(theme, objective, cta),
        cta,
        requiredInputs:
          slot.requiredInputs && slot.requiredInputs.length > 0
            ? slot.requiredInputs
            : [{ type: contentType === 'carousel' ? 'slides' : 'b-roll', priority: 'high' }],
        originalityRules:
          slot.originalityRules && slot.originalityRules.length > 0
            ? slot.originalityRules
            : ['Use inspiration as reference only. Do not copy captions or scripts.'],
        deliverableSpec: deliverableSpecForType(contentType),
      },
      generationPlan: {
        workflowKey: workflowKeyForType(platform, contentType),
        steps: [
          'Extract insight from selected inspiration posts',
          'Draft hook + body + CTA',
          'Produce first cut with on-screen text',
          'Run final compliance and quality check',
        ],
        renderParams: renderParamsForType(contentType),
      },
      status: hasInspiration ? 'ready_to_generate' : 'blocked',
      ...(hasInspiration ? {} : { blockReason: 'MISSING_INSPIRATION_EVIDENCE' }),
    };
  });

  return {
    meta: {
      weekStart,
      timezone,
      createdAt: new Date().toISOString(),
      version: 1,
      durationDays,
    } as Record<string, unknown>,
    schedule: schedule.slice(0, durationDays),
  };
}

function nextMonday(timezone: string): string {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  return monday.toISOString().slice(0, 10);
}

function assignScheduledAt(
  slots: CalendarBrief['slots'],
  weekStart: string,
  timezone: string
): Map<number, string> {
  const schedule = new Map<number, string>();
  if (!slots?.length) return schedule;
  const windows = DEFAULT_POSTING_WINDOWS;
  const slotCount = slots.length;
  const maxPerDay = slotCount <= 14 ? 1 : 2;
  let dayOffset = 0;
  let slotInDay = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const platform = (slot.platform || 'instagram').toLowerCase();
    const times = windows[platform] || windows.instagram;
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    const dateStr = d.toISOString().slice(0, 10);
    const timeIdx = slotInDay % times.length;
    const time = times[timeIdx];
    const [hours, minutes] = time.split(':').map(Number);
    const iso = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`;
    schedule.set(slot.slotIndex, iso);
    slotInDay++;
    if (slotInDay >= maxPerDay) {
      slotInDay = 0;
      dayOffset++;
    }
  }
  return schedule;
}

export interface GeneratorConfig {
  timezone?: string;
  weekStart?: string | null;
  durationDays?: number;
  postingWindows?: Record<string, string[]>;
  maxPerDay?: Record<string, number>;
}

export async function runContentCalendarGenerator(
  brief: CalendarBrief,
  config: GeneratorConfig = {}
): Promise<ContentCalendar> {
  const durationDays = [7, 14, 30, 90].includes(Number(config.durationDays || 14))
    ? Number(config.durationDays || 14)
    : 14;
  const timezone = config.timezone || brief.meta?.timezone || 'Africa/Cairo';
  const weekStart = config.weekStart || nextMonday(timezone);
  const scheduleScaffold = assignScheduledAt(brief.slots || [], weekStart, timezone);

  const briefWithScaffold = {
    ...brief,
    _scheduleScaffold: Object.fromEntries(
      Array.from(scheduleScaffold.entries()).map(([idx, at]) => [String(idx), at])
    ),
    _weekStart: weekStart,
    _timezone: timezone,
  };

  const generatorConfig = {
    durationDays,
    timezone,
    weekStart,
    postingWindows: config.postingWindows || DEFAULT_POSTING_WINDOWS,
    maxPerDay: config.maxPerDay || { instagram: 2, tiktok: 2 },
  };

  const briefJson = JSON.stringify(briefWithScaffold, null, 0);
  const configJson = JSON.stringify(generatorConfig, null, 0);
  const userPrompt = CONTENT_CALENDAR_PROMPTS.generator.userTemplate(
    briefJson,
    configJson,
    durationDays
  );

  let raw: string;
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: CONTENT_CALENDAR_PROMPTS.generator.system },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 12000,
    });
    raw = (response as any).choices?.[0]?.message?.content ?? '';
  } catch (e) {
    console.error('[Calendar Generator] OpenAI error:', e);
    throw e;
  }

  const parsed = parseJsonSafe<ContentCalendar>(raw);
  if (!parsed.success) {
    throw new Error(`Calendar Generator: failed to parse JSON: ${parsed.error}`);
  }

  let cal = parsed.data;
  const stage1UsedPostIds = new Set(brief.usedPostIds || []);
  const stage1SlotsLength = brief.slots?.length ?? 0;
  let result = validateContentCalendar(cal, stage1UsedPostIds, stage1SlotsLength);
  let attempts = 0;

  while (!result.valid && attempts < MAX_REPAIR_ATTEMPTS) {
    attempts++;
    console.warn('[Calendar Generator] Validation failed, attempting repair:', result.errors.slice(0, 3));
    const repairPrompt = CONTENT_CALENDAR_PROMPTS.repairStage2(raw, result.errors);
    const repairResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: CONTENT_CALENDAR_PROMPTS.generator.system },
        { role: 'user', content: repairPrompt },
      ],
      temperature: 0.2,
      max_tokens: 12000,
    });
    raw = (repairResponse as any).choices?.[0]?.message?.content ?? '';
    const repairParsed = parseJsonSafe<ContentCalendar>(raw);
    if (!repairParsed.success) {
      throw new Error(`Calendar Generator: repair parse failed: ${repairParsed.error}`);
    }
    cal = repairParsed.data;
    result = validateContentCalendar(cal, stage1UsedPostIds, stage1SlotsLength);
  }

  if (!result.valid) {
    throw new Error(`Calendar Generator: validation failed after repair: ${result.errors.join('; ')}`);
  }

  const schedule = cal.schedule || [];
  const briefSlots = brief.slots || [];
  for (const slot of schedule) {
    const scaffoldAt = scheduleScaffold.get(slot.slotIndex);
    if (scaffoldAt && !slot.scheduledAt) {
      (slot as ContentCalendarSlot).scheduledAt = scaffoldAt;
    }

    const byIndex =
      typeof slot.slotIndex === 'number' && Number.isInteger(slot.slotIndex)
        ? briefSlots[slot.slotIndex]
        : undefined;
    const byMatch = briefSlots.find((item) => item.slotIndex === slot.slotIndex);
    const matchedBriefSlot = byIndex || byMatch;

    if (
      !(slot.inspirationPosts && slot.inspirationPosts.length) &&
      matchedBriefSlot?.inspirationPosts?.length
    ) {
      (slot as ContentCalendarSlot).inspirationPosts = matchedBriefSlot.inspirationPosts;
    }

    const hasInspiration = Array.isArray(slot.inspirationPosts) && slot.inspirationPosts.length > 0;
    const isBlocked = String(slot.status || '').toLowerCase() === 'blocked';

    if (!hasInspiration && !isBlocked) {
      (slot as ContentCalendarSlot).status = 'blocked';
      (slot as ContentCalendarSlot).blockReason = 'MISSING_INSPIRATION_EVIDENCE';
    } else if (!hasInspiration && isBlocked) {
      if (!String((slot as ContentCalendarSlot).blockReason || '').trim()) {
        (slot as ContentCalendarSlot).blockReason = 'MISSING_INSPIRATION_EVIDENCE';
      }
    } else if (hasInspiration && isBlocked) {
      // If inspiration exists, unblock and keep explicit generation-ready status.
      (slot as ContentCalendarSlot).status = 'ready_to_generate';
      delete (slot as ContentCalendarSlot).blockReason;
    }
  }

  const finalValidation = validateContentCalendar(cal, stage1UsedPostIds, stage1SlotsLength);
  if (!finalValidation.valid) {
    throw new Error(
      `Calendar Generator: post-normalization validation failed: ${finalValidation.errors.join('; ')}`
    );
  }

  if (!cal.meta) cal.meta = {};
  cal.meta.weekStart = weekStart;
  cal.meta.timezone = timezone;
  (cal.meta as Record<string, unknown>).durationDays = durationDays;
  cal.meta.createdAt = new Date().toISOString();
  cal.meta.version = 1;

  return cal;
}
