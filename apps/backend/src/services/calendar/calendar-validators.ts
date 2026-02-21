/**
 * Content Calendar validators: schema checks and post-reference validation.
 * No Zod dependency; returns string[] errors for repair flow.
 */

import type { ProcessorInput, ProcessorInputPost } from './content-calendar-context';

export interface CalendarBriefInspirationRef {
  postId: string;
  handle: string;
  postUrl: string;
  reasonType?: string;
  reason?: string;
  metricsUsed?: Record<string, number | null>;
}

export interface CalendarBriefSlot {
  slotIndex: number;
  platform: string;
  contentType: string;
  theme: string;
  pillarId?: string;
  objective?: string;
  briefConcept?: string;
  inspirationPosts?: CalendarBriefInspirationRef[];
  suggestedHook?: string;
  requiredInputs?: Array<{ type: string; priority: string }>;
  originalityRules?: string[];
  notesForGenerator?: string;
}

export interface CalendarBrief {
  meta?: { timezone?: string; weekCadence?: { minSlots: number; maxSlots: number }; dataNotes?: string[] };
  contentTypeMix?: Record<string, Record<string, number>>;
  rationaleByType?: Array<{
    platform: string;
    contentType: string;
    rationale: string;
    evidencePosts?: CalendarBriefInspirationRef[];
  }>;
  weeklyThemes?: Array<{
    theme: string;
    pillarId?: string;
    pillarName?: string;
    drivers?: Array<{ type: string; id: string }>;
    examplePosts?: CalendarBriefInspirationRef[];
  }>;
  slots?: CalendarBriefSlot[];
  usedPostIds?: string[];
  mentions?: Array<{ slotIndex: number; type: string; postId: string; handle: string; postUrl: string; text?: string }>;
}

export interface ContentCalendarSlot {
  slotId: string;
  slotIndex: number;
  platform: string;
  contentType: string;
  scheduledAt: string;
  theme?: string;
  pillarId?: string;
  objective?: string;
  inspirationPosts?: CalendarBriefInspirationRef[];
  productionBrief?: Record<string, unknown>;
  generationPlan?: { workflowKey?: string; steps?: unknown[]; renderParams?: Record<string, unknown> };
  status?: string;
  blockReason?: string;
}

export interface ContentCalendar {
  meta?: { weekStart?: string; timezone?: string; createdAt?: string; version?: number };
  weeklyGoals?: string[];
  schedule?: ContentCalendarSlot[];
  productionTimeline?: Array<{ day: string; tasks: string[] }>;
}

function assert(condition: boolean, message: string, errors: string[]) {
  if (!condition) errors.push(message);
}

export function validateCalendarBrief(
  brief: unknown,
  inputPosts: ProcessorInputPost[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const postMap = new Map(inputPosts.map((p) => [p.postId, p]));

  if (!brief || typeof brief !== 'object') {
    errors.push('CalendarBrief must be an object');
    return { valid: false, errors };
  }

  const b = brief as CalendarBrief;
  if (!Array.isArray(b.slots)) {
    errors.push('CalendarBrief.slots must be an array');
  } else if (b.slots.length === 0) {
    errors.push('CalendarBrief.slots must be a non-empty array (generate at least one slot for the week)');
  }
  if (!Array.isArray(b.usedPostIds)) {
    errors.push('CalendarBrief.usedPostIds must be an array');
  }

  const refs: Array<{ postId: string; postUrl: string; handle: string }> = [];
  (b.rationaleByType || []).forEach((r) => {
    (r.evidencePosts || []).forEach((e) => refs.push({ postId: e.postId, postUrl: e.postUrl, handle: e.handle }));
  });
  (b.weeklyThemes || []).forEach((t) => {
    (t.examplePosts || []).forEach((e) => refs.push({ postId: e.postId, postUrl: e.postUrl, handle: e.handle }));
  });
  (b.slots || []).forEach((s) => {
    (s.inspirationPosts || []).forEach((e) => refs.push({ postId: e.postId, postUrl: e.postUrl, handle: e.handle }));
  });
  (b.mentions || []).forEach((m) => refs.push({ postId: m.postId, postUrl: m.postUrl, handle: m.handle }));

  for (const ref of refs) {
    const input = postMap.get(ref.postId);
    assert(!!input, `Referenced postId "${ref.postId}" not in input posts`, errors);
    if (input) {
      assert(input.postUrl === ref.postUrl, `postUrl for ${ref.postId} does not match input (expected ${input.postUrl})`, errors);
    }
  }

  const usedSet = new Set(b.usedPostIds || []);
  const refPostIds = new Set(refs.map((r) => r.postId));
  refPostIds.forEach((id) => {
    assert(usedSet.has(id), `postId ${id} used but not in usedPostIds`, errors);
  });

  return { valid: errors.length === 0, errors };
}

export function validateContentCalendar(
  cal: unknown,
  stage1UsedPostIds: Set<string>,
  stage1SlotsLength: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!cal || typeof cal !== 'object') {
    errors.push('ContentCalendar must be an object');
    return { valid: false, errors };
  }

  const c = cal as ContentCalendar;
  const schedule = c.schedule || [];
  assert(schedule.length === stage1SlotsLength, `schedule length ${schedule.length} must equal Stage 1 slots length ${stage1SlotsLength}`, errors);

  const slotIds = new Set<string>();
  for (const slot of schedule) {
    assert(
      Number.isInteger(slot.slotIndex) && Number(slot.slotIndex) >= 0,
      `Slot ${slot.slotId || '(missing slotId)'} missing valid slotIndex`,
      errors
    );
    assert(!!slot.slotId, `Slot at index ${slot.slotIndex} missing slotId`, errors);
    if (slot.slotId) {
      assert(!slotIds.has(slot.slotId), `Duplicate slotId: ${slot.slotId}`, errors);
      slotIds.add(slot.slotId);
    }
    assert(
      typeof slot.platform === 'string' && slot.platform.trim().length > 0,
      `Slot ${slot.slotId} missing platform`,
      errors
    );
    assert(
      typeof slot.contentType === 'string' && slot.contentType.trim().length > 0,
      `Slot ${slot.slotId} missing contentType`,
      errors
    );
    assert(
      typeof slot.scheduledAt === 'string' &&
        Number.isFinite(new Date(slot.scheduledAt).getTime()),
      `Slot ${slot.slotId} missing valid scheduledAt`,
      errors
    );
    assert(!!slot.productionBrief, `Slot ${slot.slotId} missing productionBrief`, errors);
    assert(!!slot.generationPlan, `Slot ${slot.slotId} missing generationPlan`, errors);
    const hasInspiration = Array.isArray(slot.inspirationPosts) && slot.inspirationPosts.length > 0;
    const isBlocked = String(slot.status || '').toLowerCase() === 'blocked';
    assert(
      hasInspiration || isBlocked,
      `Slot ${slot.slotId} must include inspiration posts or be explicitly blocked`,
      errors
    );
    if (isBlocked) {
      assert(
        typeof slot.blockReason === 'string' && slot.blockReason.trim().length > 0,
        `Slot ${slot.slotId} is blocked but missing blockReason`,
        errors
      );
    }
    (slot.inspirationPosts || []).forEach((insp) => {
      assert(stage1UsedPostIds.has(insp.postId), `ContentCalendar added new postId ${insp.postId} not in Stage 1`, errors);
    });
  }

  return { valid: errors.length === 0, errors };
}

export function parseJsonSafe<T = unknown>(raw: string): { success: true; data: T } | { success: false; error: string } {
  try {
    const stripped = raw.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1');
    const data = JSON.parse(stripped) as T;
    return { success: true, data };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
