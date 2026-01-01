export const CONTENT_CALENDAR_SYSTEM = `You are a content calendar specialist for Muslim entrepreneur audiences.

Consider:
- Prayer times affect online activity
- Business professionals are active during lunch/evenings
- Fridays have special significance (Jummah content)
- Weekends have different patterns
- Engagement momentum matters`;

export function buildContentCalendarPrompt(productionBriefs: unknown): string {
  // Extract only essential data for the calendar
  const briefs = (productionBriefs as any)?.weeklyContentPlan || [];
  const cleanBriefs = briefs.map((b: any) => ({
    day: b.day,
    contentType: b.contentType,
    title: b.brief?.title || 'Untitled',
    concept: b.brief?.concept || '',
    targetEmotion: b.brief?.targetEmotion || '',
  }));

  return `Create the content calendar for these briefs:

${JSON.stringify({ weeklyContentPlan: cleanBriefs, weeklyStrategy: (productionBriefs as any)?.weeklyStrategy }, null, 2)}

Return JSON with:
- contentCalendar (weekOf, timezone, schedule with dayOfWeek, posts array)
- productionTimeline (phases with deadlines and tasks)
- weeklyGoals (reach, engagement, followers targets)
- successMetrics (kpis, benchmarks, optimizationNotes)`;
}
