'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiFetchLong } from '@/lib/api/http';

interface ContentCalendarWorkspaceProps {
  jobId: string;
}

interface InspirationPost {
  postId?: string;
  handle?: string;
  postUrl?: string;
  reasonType?: string;
  reason?: string;
}

interface CalendarSlot {
  id?: string;
  slotIndex: number;
  platform: string;
  contentType: string;
  scheduledAt: string;
  theme?: string | null;
  pillarId?: string | null;
  objective?: string | null;
  status: string;
  inspirationPostIds?: string[];
  inspirationUrls?: (string | null)[];
  inspirationPosts?: InspirationPost[];
  productionBrief?: Record<string, unknown> | null;
}

function buildCreativePrompt(
  productionBrief: Record<string, unknown> | null | undefined,
  inspirationPosts: InspirationPost[] = []
): string {
  const lines: string[] = [];
  if (inspirationPosts.length > 0) {
    lines.push('Reference posts used for this slot:');
    inspirationPosts.forEach((p) => {
      const handle = p.handle || 'unknown';
      const url = p.postUrl || '';
      const reasonType = p.reasonType || 'reference';
      const reason = p.reason || '';
      lines.push(`- ${handle} ${url} (${reasonType}: ${reason})`);
    });
    lines.push('');
  }
  lines.push('Creative brief:');
  if (!productionBrief || typeof productionBrief !== 'object') {
    lines.push('(No production brief.)');
    return lines.join('\n');
  }
  const spec = productionBrief.deliverableSpec as Record<string, unknown> | undefined;
  if (spec && typeof spec === 'object') {
    lines.push(`Asset: ${(spec.assetType as string) ?? 'video'}`);
    const duration = spec.durationSeconds ?? spec.duration;
    if (duration != null) lines.push(`Duration: ${duration}`);
    const ratio = spec.aspectRatio ?? spec.ratio;
    if (ratio != null) lines.push(`Aspect ratio: ${ratio}`);
    if (Array.isArray(spec.mustInclude) && spec.mustInclude.length) lines.push(`Must include: ${(spec.mustInclude as string[]).join(', ')}`);
    if (Array.isArray(spec.mustAvoid) && spec.mustAvoid.length) lines.push(`Must avoid: ${(spec.mustAvoid as string[]).join(', ')}`);
    if (Array.isArray(spec.styleTags) && spec.styleTags.length) lines.push(`Style: ${(spec.styleTags as string[]).join(', ')}`);
    lines.push('');
  }
  const hookVal = productionBrief.hook;
  if (typeof hookVal === 'string' && (hookVal as string).trim()) {
    lines.push(`Hook: ${(hookVal as string).trim()}`);
    lines.push('');
  } else if (hookVal && typeof hookVal === 'object') {
    const hook = hookVal as Record<string, unknown>;
    if (hook.onScreenText) lines.push(`Hook (on-screen): ${hook.onScreenText}`);
    if (hook.voiceover) lines.push(`Hook (voiceover): ${hook.voiceover}`);
    lines.push('');
  }
  const structureVal = productionBrief.structure;
  if (typeof structureVal === 'string' && (structureVal as string).trim()) {
    lines.push('Structure:');
    lines.push((structureVal as string).trim());
    lines.push('');
  } else if (structureVal && typeof structureVal === 'object' && Array.isArray((structureVal as Record<string, unknown>).beats)) {
    const structure = structureVal as Record<string, unknown>;
    const beats = (structure.beats as string[]) || [];
    if (beats.length) {
      lines.push('Structure:');
      beats.forEach((b, i) => lines.push(`  ${i + 1}. ${b}`));
      lines.push('');
    }
  }
  const scriptVal = productionBrief.script;
  if (typeof scriptVal === 'string' && (scriptVal as string).trim()) {
    lines.push('Script (voiceover):');
    lines.push((scriptVal as string).trim());
    lines.push('');
  } else if (scriptVal && typeof scriptVal === 'object') {
    const script = scriptVal as Record<string, unknown>;
    if (script.voiceoverFull) lines.push(`Script (voiceover):\n${script.voiceoverFull}`);
    if (Array.isArray(script.onScreenTextLines) && (script.onScreenTextLines as string[]).length) {
      lines.push('On-screen lines:');
      (script.onScreenTextLines as string[]).forEach((l) => lines.push(`  - ${l}`));
    }
    lines.push('');
  }
  const captionVal = productionBrief.caption;
  if (typeof captionVal === 'string' && (captionVal as string).trim()) {
    lines.push('Caption draft:');
    lines.push((captionVal as string).trim());
    lines.push('');
  } else if (captionVal && typeof captionVal === 'object') {
    const caption = captionVal as Record<string, unknown>;
    if (caption.draft) lines.push(`Caption draft:\n${caption.draft}`);
    if (caption.cta) lines.push(`CTA: ${caption.cta}`);
    if (Array.isArray(caption.hashtags) && (caption.hashtags as string[]).length) lines.push(`Hashtags: ${(caption.hashtags as string[]).join(' ')}`);
    lines.push('');
  }
  const requiredInputs = productionBrief.requiredInputs;
  if (Array.isArray(requiredInputs) && requiredInputs.length) {
    lines.push('Required inputs:');
    requiredInputs.forEach((r: unknown) => {
      const item = r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
      if (item && (item.type || item.priority)) lines.push(`  - ${item.type ?? 'input'} (${item.priority ?? 'normal'})`);
    });
    lines.push('');
  }
  const originalityRules = productionBrief.originalityRules;
  if (Array.isArray(originalityRules) && originalityRules.length) {
    lines.push('Originality rules:');
    (originalityRules as string[]).forEach((r) => lines.push(`  - ${r}`));
  }
  return lines.join('\n').trim();
}

interface ContentCalendarResponse {
  runId: string;
  weekStart: string;
  timezone: string;
  durationDays?: number;
  status?: string;
  contentCalendar?: {
    schedule?: CalendarSlot[];
    meta?: { weekStart?: string; timezone?: string };
  };
  slots?: CalendarSlot[];
  slotsCount?: number;
}

export default function ContentCalendarWorkspace({ jobId }: ContentCalendarWorkspaceProps) {
  const [data, setData] = useState<ContentCalendarResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotPrompts, setSlotPrompts] = useState<Record<string, string>>({});
  const [slotGenerating, setSlotGenerating] = useState<Record<string, boolean>>({});
  const [slotDraftSaved, setSlotDraftSaved] = useState<Record<string, boolean>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [durationDays, setDurationDays] = useState(14);

  useEffect(() => {
    async function fetchCalendar() {
      try {
        const res = await apiFetch<ContentCalendarResponse>(`/research-jobs/${jobId}/content-calendar`, {
          cache: 'no-store',
          headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' },
        });
        setData(res);
        if (res.durationDays) {
          setDurationDays(res.durationDays);
        }
      } catch (err: any) {
        if (err?.status === 404) {
          setData(null);
        } else {
          setError(err?.message || 'Failed to load content calendar');
        }
      } finally {
        setIsLoading(false);
      }
    }
    fetchCalendar();
  }, [jobId]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await apiFetchLong<ContentCalendarResponse>(`/research-jobs/${jobId}/content-calendar`, {
        method: 'POST',
        body: JSON.stringify({ durationDays }),
      });
      setData(res);
      if (res.durationDays) {
        setDurationDays(res.durationDays);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to generate content calendar');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSlotGenerate = async (slot: CalendarSlot, promptText: string) => {
    const slotId = slot.id;
    if (!slotId) return;
    const slotKey = slotId;
    setSlotGenerating((prev) => ({ ...prev, [slotKey]: true }));
    setError(null);
    try {
      await apiFetch(`/research-jobs/${jobId}/content-calendar/slots/${slotId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creativePrompt: promptText || undefined }),
      });
      setSlotDraftSaved((prev) => ({ ...prev, [slotKey]: true }));
      setTimeout(() => setSlotDraftSaved((p) => ({ ...p, [slotKey]: false })), 3000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save draft');
    } finally {
      setSlotGenerating((prev) => ({ ...prev, [slotKey]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex justify-center py-12">
          <div className="text-center space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
            <p className="text-muted-foreground">Loading content calendar...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600 font-medium">Error: {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasSchedule = (data?.slots?.length ?? 0) > 0 || (data?.contentCalendar?.schedule?.length ?? 0) > 0;
  if (!data || !hasSchedule) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="max-w-2xl mx-auto text-center py-12">
          <h2 className="text-2xl font-bold mb-2">Content Calendar</h2>
          <p className="text-muted-foreground mb-6">
            Generate a content calendar grounded in readiness-qualified strategy and inspiration posts.
          </p>
          <div className="mb-4 flex items-center justify-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="calendar-duration">
              Duration
            </label>
            <select
              id="calendar-duration"
              value={durationDays}
              onChange={(event) => setDurationDays(Number(event.target.value))}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isGenerating ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                Generating calendar…
              </span>
            ) : (
              `Generate ${durationDays}-day calendar`
            )}
          </button>
          {isGenerating && (
            <p className="mt-4 text-sm text-muted-foreground">
              This may take 1–2 minutes. Do not close the page.
            </p>
          )}
        </div>
      </div>
    );
  }

  const rawSchedule = data.slots?.length
    ? data.slots
    : (data.contentCalendar?.schedule || []).map((s) => ({
        ...s,
        inspirationUrls: (s.inspirationPosts || []).map((p) => p.postUrl || null),
      }));
  const schedule = [...rawSchedule].sort(
    (a, b) => new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime()
  );

  const weekStart = data.weekStart || data.contentCalendar?.meta?.weekStart || '';
  const timezone = data.timezone || data.contentCalendar?.meta?.timezone || '';

  const refreshCalendar = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const res = await apiFetch<ContentCalendarResponse>(`/research-jobs/${jobId}/content-calendar`, {
        cache: 'no-store',
        headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' },
      });
      setData(res);
      if (res.durationDays) {
        setDurationDays(res.durationDays);
      }
    } catch (err: unknown) {
      setError(err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : 'Failed to refresh calendar');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-semibold">Content Calendar</h2>
            <p className="text-sm text-muted-foreground">
              Week of {weekStart} · {timezone}
              {data.durationDays ? ` · ${data.durationDays} days` : ''}
              {schedule.length > 0 && ` · ${schedule.length} slot${schedule.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshCalendar}
            disabled={isRefreshing}
            aria-label="Refresh calendar"
            className="rounded border border-border bg-muted px-3 py-1.5 text-sm hover:bg-muted/80 disabled:opacity-50"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schedule.map((slot) => {
            const slotKey = slot.id ?? `slot-${slot.slotIndex}`;
            const inspirationPosts = slot.inspirationPosts ?? [];
            const defaultPrompt = buildCreativePrompt(slot.productionBrief, inspirationPosts);
            const promptValue = slotPrompts[slotKey] ?? defaultPrompt;
            const scheduledDate = slot.scheduledAt
              ? new Date(slot.scheduledAt).toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
              : '—';
            const isGeneratingSlot = slotGenerating[slotKey];
            const draftSaved = slotDraftSaved[slotKey];

            return (
              <div
                key={slotKey}
                className="rounded-lg border border-border bg-card p-4 shadow-sm flex flex-col"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium">
                      {slot.platform}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">{slot.contentType}</span>
                  </div>
                  <span
                    role="status"
                    title={slot.status === 'READY_TO_GENERATE' ? 'Ready to generate draft' : slot.status === 'BLOCKED' ? 'Blocked: missing inputs or dependency' : 'Planned'}
                    className={`rounded px-2 py-0.5 text-xs ${slot.status === 'READY_TO_GENERATE'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : slot.status === 'BLOCKED'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                  >
                    {slot.status?.replace(/_/g, ' ') || 'planned'}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{scheduledDate}</p>
                {slot.theme && (
                  <p className="mt-1 text-xs text-muted-foreground">Theme: {slot.theme}</p>
                )}

                {inspirationPosts.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">Reference posts for this slot</p>
                    <ul className="mt-1 space-y-1">
                      {inspirationPosts.map((p, idx) => (
                        <li key={p.postId ?? idx} className="text-xs">
                          <a
                            href={p.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium"
                          >
                            {p.handle || 'Post'}
                          </a>
                          {p.reasonType != null || p.reason != null ? (
                            <span className="text-muted-foreground ml-1">
                              ({[p.reasonType, p.reason].filter(Boolean).join(': ')})
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex-1 flex flex-col min-h-0">
                  <label htmlFor={`prompt-${slotKey}`} className="text-xs font-medium text-muted-foreground mb-1">
                    Prompt for images/videos
                  </label>
                  <textarea
                    id={`prompt-${slotKey}`}
                    value={promptValue}
                    onChange={(e) => setSlotPrompts((p) => ({ ...p, [slotKey]: e.target.value }))}
                    className="w-full min-h-[120px] rounded border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    placeholder="Creative prompt (references + brief)"
                    aria-describedby={draftSaved ? `draft-saved-${slotKey}` : undefined}
                  />
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleSlotGenerate(slot, promptValue)}
                      disabled={isGeneratingSlot || !slot.id}
                      aria-label={isGeneratingSlot ? 'Saving draft' : 'Save draft and generate'}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      {isGeneratingSlot ? 'Saving…' : 'Generate'}
                    </button>
                    {draftSaved && (
                      <span id={`draft-saved-${slotKey}`} className="text-xs text-green-600 font-medium dark:text-green-400" role="status">
                        Draft saved
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
