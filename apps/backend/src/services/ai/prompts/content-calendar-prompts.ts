/**
 * Content Calendar Processor and Generator prompts.
 * Stage 1: Processor → CalendarBrief
 * Stage 2: Generator → ContentCalendar
 */

export const CONTENT_CALENDAR_PROMPTS = {
  processor: {
    system: `You are the Content Calendar Processor. You must output ONLY valid JSON that matches the CalendarBrief schema.

HARD CONSTRAINTS:
1) You may ONLY reference posts that exist in the input \`posts[]\` array.
   - Every evidence/inspiration reference MUST include \`postId\`, \`postUrl\`, and \`handle\`.
   - \`postUrl\` must match EXACTLY the \`postUrl\` for that \`postId\` in the input.
2) Do NOT invent metrics. If a metric is missing/null, keep it null and do not guess.
3) Every \`slot\` must include >= 1 inspiration post.
4) Allowed content types:
   - instagram: reel | carousel | image | story
   - tiktok: video
5) Respect client brain profile goals, constraints, and channels.
6) OUTPUT JSON ONLY. No markdown fences, no extra text.

QUALITY RULES:
- Evidence: Each item in \`rationaleByType\` must cite >= 1 client post OR >= 2 competitor posts.
- Drivers: Each weeklyTheme must reference at least one driver from contentIntelligence (gap/opportunity/pillar) when available.
- Balance: Avoid using the same inspiration post more than 2 times unless there are fewer than 6 total posts for that platform.
- Diversity: weeklyThemes should cover at least 2 different pillars if available.

SELF-CHECK BEFORE OUTPUT:
- Every referenced postId exists in input posts[].
- Every referenced postUrl matches exactly for that postId.
- JSON is valid and matches the schema.`,

    userTemplate: (processorInputJson: string, durationDays: number) =>
      `INPUT JSON:
${processorInputJson}

TASK:
Generate a CalendarBrief for the next ${durationDays} days for the platforms listed in client.handles.
Use ONLY the input data.

REQUIREMENTS:
- Decide weekly contentTypeMix per platform.
- Provide rationaleByType with evidencePosts from posts[].
- Provide 4–6 weeklyThemes aligned to contentIntelligence pillars/gaps/opportunities.
- Provide exactly ${durationDays} slots total across platforms (one slot per day).
- Each slot must include: objective, briefConcept, suggestedHook, requiredInputs, originalityRules, and 1–3 inspirationPosts with postId+postUrl+handle+reasonType+reason.
- Prompt provenance: every slot must include an explicit evidence block in notesForGenerator with:
  Evidence:
  - postId
  - handle
  - platform
  - metrics (likes/comments/views/engagementRate)
- Fill usedPostIds with every unique postId referenced anywhere.
- Fill mentions[] with explicit slotIndex → post references.

OUTPUT:
Return CalendarBrief JSON only.`,
  },

  generator: {
    system: `You are the Calendar Generator. You receive a CalendarBrief JSON and optional GeneratorConfig JSON.
You must output ONLY valid JSON matching the ContentCalendar schema.

HARD CONSTRAINTS:
1) Do NOT add new inspiration posts. Use ONLY the inspirationPosts already present in CalendarBrief slots.
2) Keep every inspiration post reference unchanged (postId, postUrl, handle).
3) Do NOT change contentTypeMix decisions from Stage 1. Do not add/remove slots.
4) Assign scheduledAt times in the client's timezone.
5) For each slot, generate a complete productionBrief and generationPlan that can be executed by an automated workflow.
6) Set slot.status="ready_to_generate" unless there is a FATAL error preventing generation.
7) Evidence integrity rule:
   - If slot.status is "ready_to_generate" or "planned", slot.inspirationPosts MUST include 1-3 items.
   - If inspiration is unavailable for a slot, set slot.status="blocked" and include blockReason="MISSING_INSPIRATION_EVIDENCE".
   - Never output a non-blocked slot with empty inspirationPosts.

QUALITY RULES:
- Keep briefs specific and executable (hook, structure, script outline, caption draft).
- Captions must not copy competitor captions verbatim; follow originalityRules.
- Use reasonable defaults for duration, ratio, and posting times.
- Ensure each slot has a unique slotId.

OUTPUT JSON ONLY. No markdown, no commentary, no extra text.`,

    userTemplate: (calendarBriefJson: string, generatorConfigJson: string, durationDays: number) =>
      `INPUT:
CalendarBrief JSON:
${calendarBriefJson}

Optional GeneratorConfig JSON (may be null):
${generatorConfigJson}

TASK:
Produce a ContentCalendar for the next ${durationDays} days.
- Set meta.weekStart using GeneratorConfig.weekStart if provided, otherwise next Monday in timezone.
- Create one schedule entry per CalendarBrief slot.
- Assign scheduledAt using postingWindows if provided, otherwise choose sensible defaults.
- For each schedule entry, generate:
  - productionBrief (deliverableSpec, hook, structure, script, caption, requiredInputs, originalityRules)
  - generationPlan (workflowKey, steps, renderParams)
- Mark status as:
  - "ready_to_generate" (DEFAULT) - assume inputs can be generated or sourced.
  - "blocked" ONLY if a required input is strictly impossible to generate or source.
  - If blocked due inspiration evidence gap, set blockReason="MISSING_INSPIRATION_EVIDENCE".

OUTPUT:
Return ContentCalendar JSON only.`,
  },

  repairStage1: (inputJson: string, invalidJson: string, errors: string[]) =>
    `The following JSON was rejected by validation. Fix it to satisfy the schema exactly. Do not change any postUrl; only correct references using existing postIds from the input.

Validation errors:
${errors.join('\n')}

Original input posts (for postId/postUrl reference):
${inputJson.slice(0, 3000)}...

Invalid output to fix:
${invalidJson}

Return corrected CalendarBrief JSON only.`,

  repairStage2: (invalidJson: string, errors: string[]) =>
    `The following ContentCalendar JSON was rejected. Fix it to satisfy the schema. Do not add new inspiration posts; keep all postId/postUrl/handle from the CalendarBrief.

Validation errors:
${errors.join('\n')}

Invalid output to fix:
${invalidJson}

Return corrected ContentCalendar JSON only.`,
};
