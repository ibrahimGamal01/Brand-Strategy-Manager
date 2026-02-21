/**
 * Stage 1: Content Calendar Processor
 * Calls LLM with Processor Input JSON → CalendarBrief (with validation + optional repair).
 */

import { openai } from '../ai/openai-client';
import type { ProcessorInput, ProcessorInputPost } from './content-calendar-context';
import type { CalendarBrief, CalendarBriefSlot } from './calendar-validators';
import { validateCalendarBrief, parseJsonSafe } from './calendar-validators';
import { CONTENT_CALENDAR_PROMPTS } from '../ai/prompts/content-calendar-prompts';

const MODEL = 'gpt-4o';

/** Ensure slots and usedPostIds are arrays so validation and downstream code don't fail on LLM omissions. */
function normalizeCalendarBrief(brief: CalendarBrief): CalendarBrief {
  return {
    ...brief,
    slots: Array.isArray(brief.slots) ? brief.slots : [],
    usedPostIds: Array.isArray(brief.usedPostIds) ? brief.usedPostIds : [],
  };
}

const MAX_REPAIR_ATTEMPTS = 2;

const FALLBACK_THEMES = [
  'Launch', 'Engagement', 'Storytelling', 'Behind the scenes', 'Tips & how-to',
  'Testimonial', 'Product highlight', 'Community', 'CTA', 'Trending', 'FAQ',
  'Recap', 'Teaser', 'Value',
];

const HOOK_TEMPLATES = [
  'If you are trying to improve {{keyword}}, start here.',
  'Most founders get {{keyword}} wrong. Here is the fix.',
  'Save this before your next {{keyword}} move.',
  '3 steps to stronger {{keyword}} this week.',
  'The fastest way to improve {{keyword}} without burnout.',
];

const CTA_BY_OBJECTIVE: Record<string, string> = {
  awareness: 'Follow for more practical insights this week.',
  education: 'Save this and share it with one person who needs it.',
  engagement: 'Comment your biggest challenge so we can build the next post around it.',
  conversion: 'DM us with \"START\" to get the next step.',
  retention: 'Come back tomorrow for part 2 in this series.',
};

const GENERIC_KEYWORDS = [
  'growth',
  'content',
  'engagement',
  'strategy',
  'consistency',
  'audience',
  'conversion',
  'storytelling',
];

function formatObjective(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Awareness';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function objectiveFromIndex(index: number): string {
  const objectiveOptions = ['Awareness', 'Education', 'Engagement', 'Conversion', 'Retention'];
  return objectiveOptions[index % objectiveOptions.length];
}

function ctaForObjective(objective: string): string {
  const key = objective.toLowerCase();
  return CTA_BY_OBJECTIVE[key] || CTA_BY_OBJECTIVE.awareness;
}

function cleanThemeLabel(raw: string): string {
  return String(raw || '')
    .replace(/^#+\s*/g, '')
    .replace(/^part\s+\d+\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
}

function extractFallbackKeywords(posts: ProcessorInputPost[], handleStopWords: string[]): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'our', 'are', 'was', 'were', 'have',
    'has', 'had', 'will', 'just', 'into', 'about', 'when', 'what', 'where', 'how', 'why', 'today', 'tomorrow',
    'instagram', 'tiktok', 'reel', 'video', 'post', 'posts', 'content', 'business',
    'https', 'http', 'www', 'com', 'net', 'org',
    ...handleStopWords,
  ]);
  const freq = new Map<string, number>();
  for (const post of posts) {
    const caption = String(post.caption || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[@#][a-z0-9_]+/g, ' ');
    const tokens = caption.match(/[a-z][a-z0-9]{3,}/g) || [];
    for (const token of tokens) {
      if (stopWords.has(token)) continue;
      if (token.length > 15) continue;
      if (/[0-9]{2,}/.test(token)) continue;
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }
  const ranked = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 12);
  return ranked.length > 0 ? ranked : GENERIC_KEYWORDS;
}

function themePoolFromInput(input: ProcessorInput): string[] {
  const strategyThemes = (input.strategySnippets?.contentPillars || [])
    .map((p) => cleanThemeLabel(String(p?.name || '')))
    .filter(Boolean);
  const intelligenceThemes = (input.contentIntelligence?.pillars || [])
    .map((p) => cleanThemeLabel(String(p?.name || '')))
    .filter(Boolean);
  const merged = Array.from(new Set([...strategyThemes, ...intelligenceThemes]));
  return merged.length > 0 ? merged : FALLBACK_THEMES;
}

function suggestedHookFromTemplate(keyword: string, index: number): string {
  const template = HOOK_TEMPLATES[index % HOOK_TEMPLATES.length];
  return template.replaceAll('{{keyword}}', keyword);
}

function focusTermFromTheme(theme: string, fallbackKeyword: string): string {
  const candidates = String(theme || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !/^\d+$/.test(token))
    .slice(0, 3);
  if (candidates.length === 0) return fallbackKeyword;
  return candidates.join(' ');
}

/** Build a minimal CalendarBrief with one slot per day when the LLM returns empty slots after repair. */
function buildMinimalBrief(input: ProcessorInput, durationDays: number): CalendarBrief {
  const posts = [...(input.posts || [])];
  const handleStopWords = Object.values(input.client?.handles || {})
    .map((value) => String(value || '').replace(/^@/, '').toLowerCase())
    .flatMap((handle) => handle.split(/[^a-z0-9]+/g))
    .filter(Boolean);
  const keywords = extractFallbackKeywords(posts, handleStopWords);
  const themePool = themePoolFromInput(input);
  const activeHandlePlatforms = Object.entries(input.client?.handles || {})
    .filter(([, handle]) => String(handle || '').trim().length > 0)
    .map(([platform]) => platform.toLowerCase())
    .filter((platform) => platform === 'instagram' || platform === 'tiktok');

  const postsByPlatform = posts.reduce<Record<string, ProcessorInputPost[]>>((acc, post) => {
    const platform = String(post.platform || '').toLowerCase();
    if (!acc[platform]) acc[platform] = [];
    acc[platform].push(post);
    return acc;
  }, {});

  const scorePost = (post: ProcessorInputPost): number => {
    return Number(post.likesCount || 0) + Number(post.commentsCount || 0) * 2 + Number(post.viewsCount || 0) * 0.1;
  };

  for (const platform of Object.keys(postsByPlatform)) {
    postsByPlatform[platform].sort((a, b) => scorePost(b) - scorePost(a));
  }

  const fallbackPlatformOrder = ['instagram', 'tiktok'].filter((platform) => {
    return (postsByPlatform[platform] || []).length > 0;
  });
  const platformOrder =
    activeHandlePlatforms.filter((platform) => (postsByPlatform[platform] || []).length > 0).length > 0
      ? activeHandlePlatforms.filter((platform) => (postsByPlatform[platform] || []).length > 0)
      : fallbackPlatformOrder.length > 0
        ? fallbackPlatformOrder
        : ['instagram'];

  const contentTypeOptions: Record<string, string[]> = {
    instagram: ['reel', 'carousel', 'image'],
    tiktok: ['video'],
  };

  const usedPostIds = new Set<string>();
  const slots: CalendarBriefSlot[] = [];
  for (let i = 0; i < durationDays; i++) {
    const platform = platformOrder[i % platformOrder.length] || 'instagram';
    const platformPosts = postsByPlatform[platform] || posts;
    const contentTypePool = contentTypeOptions[platform] || ['reel'];
    const contentType = contentTypePool[i % contentTypePool.length];

    const primaryPost = platformPosts.length > 0 ? platformPosts[i % platformPosts.length] : undefined;
    const secondaryPost =
      platformPosts.length > 1 && i % 3 === 0
        ? platformPosts[(i + 1) % platformPosts.length]
        : undefined;
    const objective = objectiveFromIndex(i);
    const theme = themePool[i % themePool.length] || FALLBACK_THEMES[i % FALLBACK_THEMES.length];
    const keyword = keywords[i % keywords.length];
    const focusTerm = focusTermFromTheme(theme, keyword);

    const inspirationPosts = [primaryPost, secondaryPost]
      .filter((post): post is ProcessorInputPost => Boolean(post))
      .filter((post, index, arr) => arr.findIndex((item) => item.postId === post.postId) === index)
      .slice(0, 2)
      .map((post, idx) => {
        usedPostIds.add(post.postId);
        return {
          postId: post.postId,
          handle: post.handle,
          postUrl: post.postUrl,
          reasonType: idx === 0 ? ('reference' as const) : ('benchmark' as const),
          reason: idx === 0 ? 'Primary inspiration from readiness-qualified post' : 'Secondary benchmark for variation',
          metricsUsed: {
            likesCount: post.likesCount,
            commentsCount: post.commentsCount,
            viewsCount: post.viewsCount,
            engagementRate: post.engagementRate,
          },
        };
      });

    const evidenceLines = inspirationPosts
      .map((ref) => {
        const sourcePost = posts.find((post) => post.postId === ref.postId);
        return `- postId: ${ref.postId} | handle: ${ref.handle} | platform: ${sourcePost?.platform || platform} | metrics: likes=${sourcePost?.likesCount ?? '—'}, comments=${sourcePost?.commentsCount ?? '—'}, views=${sourcePost?.viewsCount ?? '—'}, ER=${sourcePost?.engagementRate ?? '—'}`;
      })
      .join('\n');

    slots.push({
      slotIndex: i,
      platform,
      contentType,
      theme,
      objective,
      briefConcept: `Create one ${contentType} focused on ${theme} with a practical angle on ${keyword}, grounded in recent top-performing ${platform} posts.`,
      inspirationPosts,
      suggestedHook: suggestedHookFromTemplate(focusTerm, i),
      requiredInputs: [{ type: 'b-roll', priority: 'high' }],
      originalityRules: ['Do not copy the reference post; use it only as style/format inspiration.'],
      notesForGenerator: evidenceLines
        ? `Evidence:\n${evidenceLines}\nCTA suggestion: ${ctaForObjective(objective)}`
        : `CTA suggestion: ${ctaForObjective(objective)}`,
    });
  }

  return {
    meta: { timezone: input.client?.timezone || 'Africa/Cairo' },
    slots,
    usedPostIds: Array.from(usedPostIds),
  };
}

export async function runContentCalendarProcessor(
  input: ProcessorInput,
  options: { durationDays?: number } = {}
): Promise<{ brief: CalendarBrief; errors: string[] }> {
  const durationDays = [7, 14, 30, 90].includes(Number(options.durationDays || input.planningHorizonDays || 14))
    ? Number(options.durationDays || input.planningHorizonDays || 14)
    : 14;
  const inputJson = JSON.stringify(input, null, 0);
  const userPrompt = CONTENT_CALENDAR_PROMPTS.processor.userTemplate(inputJson, durationDays);

  let raw: string;
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: CONTENT_CALENDAR_PROMPTS.processor.system },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 8000,
    });
    raw = (response as any).choices?.[0]?.message?.content ?? '';
  } catch (e) {
    console.error('[Calendar Processor] OpenAI error:', e);
    throw e;
  }

  const parsed = parseJsonSafe<CalendarBrief>(raw);
  if (!parsed.success) {
    throw new Error(`Calendar Processor: failed to parse JSON: ${parsed.error}`);
  }

  let brief = normalizeCalendarBrief(parsed.data);
  let result = validateCalendarBrief(brief, input.posts);
  let attempts = 0;

  while (!result.valid && attempts < MAX_REPAIR_ATTEMPTS) {
    attempts++;
    console.warn('[Calendar Processor] Validation failed, attempting repair:', result.errors.slice(0, 3));
    const repairPrompt = CONTENT_CALENDAR_PROMPTS.repairStage1(inputJson, raw, result.errors);
    const repairResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: CONTENT_CALENDAR_PROMPTS.processor.system },
        { role: 'user', content: repairPrompt },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    });
    raw = (repairResponse as any).choices?.[0]?.message?.content ?? '';
    const repairParsed = parseJsonSafe<CalendarBrief>(raw);
    if (!repairParsed.success) {
      throw new Error(`Calendar Processor: repair parse failed: ${repairParsed.error}`);
    }
    brief = normalizeCalendarBrief(repairParsed.data);
    result = validateCalendarBrief(brief, input.posts);
  }

  if (!result.valid) {
    const emptySlotsError = result.errors.some((e) => e.includes('non-empty') || e.includes('slots must be'));
    if (emptySlotsError && input.posts.length > 0) {
      console.warn(`[Calendar Processor] Using fallback minimal brief (${durationDays} slots) after LLM returned empty slots`);
      brief = buildMinimalBrief(input, durationDays);
      const fallbackResult = validateCalendarBrief(brief, input.posts);
      if (!fallbackResult.valid) {
        throw new Error(`Calendar Processor: fallback brief invalid: ${fallbackResult.errors.join('; ')}`);
      }
      return { brief, errors: [`Used fallback minimal brief (${durationDays} slots)`] };
    }
    throw new Error(`Calendar Processor: validation failed after repair: ${result.errors.join('; ')}`);
  }

  return { brief, errors: [] };
}
