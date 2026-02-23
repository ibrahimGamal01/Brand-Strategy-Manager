import type { ChatBlock } from '../../../chat/chat-types';

type CrudAction = 'read' | 'create' | 'update' | 'delete' | 'clear';

type CrudIntent = {
  action: CrudAction;
  section: string;
  target?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

const SECTION_ALIASES: Record<string, string> = {
  client_profile: 'client_profiles',
  client_profiles: 'client_profiles',
  profile: 'client_profiles',
  profiles: 'client_profiles',
  competitor: 'competitors',
  competitors: 'competitors',
  search_result: 'search_results',
  search_results: 'search_results',
  results: 'search_results',
  image: 'images',
  images: 'images',
  video: 'videos',
  videos: 'videos',
  news: 'news',
  mention: 'brand_mentions',
  mentions: 'brand_mentions',
  brand_mention: 'brand_mentions',
  brand_mentions: 'brand_mentions',
  media: 'media_assets',
  downloaded: 'media_assets',
  downloaded_content: 'media_assets',
  media_asset: 'media_assets',
  media_assets: 'media_assets',
  trend: 'search_trends',
  trends: 'search_trends',
  search_trend: 'search_trends',
  search_trends: 'search_trends',
  insight: 'community_insights',
  insights: 'community_insights',
  community_insight: 'community_insights',
  community_insights: 'community_insights',
  ai_question: 'ai_questions',
  ai_questions: 'ai_questions',
  question: 'ai_questions',
  questions: 'ai_questions',
};

function normalize(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function detectAction(text: string): CrudAction | null {
  if (/\b(clear|wipe|reset)\b/.test(text)) return 'clear';
  if (/\b(delete|remove|erase)\b/.test(text)) return 'delete';
  if (/\b(update|edit|change|replace|set)\b/.test(text)) return 'update';
  if (/\b(create|add|insert|new)\b/.test(text)) return 'create';
  if (/\b(read|list|show|get|fetch)\b/.test(text)) return 'read';
  return null;
}

function detectSection(text: string): string | null {
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    const one = SECTION_ALIASES[tokens[i]];
    if (one) return one;
    if (i < tokens.length - 1) {
      const two = SECTION_ALIASES[`${tokens[i]}_${tokens[i + 1]}`];
      if (two) return two;
    }
  }
  return null;
}

function maybeParseJsonObject(input: string): Record<string, unknown> | null {
  const text = input.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTarget(rawMessage: string): Record<string, unknown> | undefined {
  const target: Record<string, unknown> = {};
  const urlMatch = rawMessage.match(/https?:\/\/[^\s)]+/i);
  if (urlMatch) {
    target.url = urlMatch[0];
    target.href = urlMatch[0];
    target.profileUrl = urlMatch[0];
    target.imageUrl = urlMatch[0];
  }

  const handleMatch = rawMessage.match(/@([a-z0-9._-]{2,40})/i);
  if (handleMatch) target.handle = handleMatch[1];

  const quoted = Array.from(rawMessage.matchAll(/"([^"]{3,180})"/g)).map((match) => match[1].trim());
  if (quoted.length) {
    target.title = quoted[0];
    target.question = quoted[0];
    target.keyword = quoted[0];
  }

  const named = rawMessage.match(/\b(?:named|called|about|for)\s+([a-z0-9@._:/-]{3,120})/i);
  if (named && !target.title && !target.keyword) {
    target.title = named[1];
  }

  return Object.keys(target).length ? target : undefined;
}

function extractData(action: CrudAction, rawMessage: string): Record<string, unknown> | undefined {
  const jsonMatch = rawMessage.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    const parsed = maybeParseJsonObject(jsonMatch[0]);
    if (parsed && Object.keys(parsed).length > 0) return parsed;
  }

  const kvPairs = Array.from(rawMessage.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]\s*("[^"]+"|[^,]+)(?:,|$)/g));
  if (kvPairs.length) {
    const payload: Record<string, unknown> = {};
    kvPairs.forEach((match) => {
      const key = match[1];
      const rawValue = match[2].trim();
      payload[key] = rawValue.replace(/^"|"$/g, '');
    });
    if (Object.keys(payload).length > 0) return payload;
  }

  if (action === 'update') {
    const setMatch = rawMessage.match(/\bset\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:to|=)\s+(.+)$/i);
    if (setMatch) {
      return {
        [setMatch[1]]: setMatch[2].trim().replace(/^"|"$/g, ''),
      };
    }
  }

  if (action === 'create') {
    const quoted = Array.from(rawMessage.matchAll(/"([^"]{3,260})"/g)).map((match) => match[1].trim());
    if (quoted.length) {
      return { content: quoted[0], title: quoted[0], snippet: quoted[0], body: quoted[0] };
    }
  }

  return undefined;
}

function hasCrudActionButtons(blocks: ChatBlock[]): boolean {
  return blocks.some((block) => {
    if (String(block.type || '').toLowerCase() !== 'action_buttons') return false;
    const buttons = Array.isArray((block as any).buttons) ? ((block as any).buttons as Array<Record<string, unknown>>) : [];
    return buttons.some((button) => String(button.action || '').toLowerCase().startsWith('intel_'));
  });
}

export function detectCrudIntent(rawMessage: string): CrudIntent | null {
  const text = normalize(rawMessage || '');
  if (!text) return null;
  const action = detectAction(text);
  if (!action) return null;
  const section = detectSection(text);
  if (!section) return null;
  const target = extractTarget(rawMessage);
  const data = extractData(action, rawMessage);
  return { action, section, target, data };
}

export function ensureCrudActionBlock(blocks: ChatBlock[], rawMessage: string): ChatBlock[] {
  if (hasCrudActionButtons(blocks)) return blocks;
  const intent = detectCrudIntent(rawMessage);
  if (!intent) return blocks;

  const payload: Record<string, unknown> = {
    section: intent.section,
    action: intent.action,
  };
  if (intent.target) payload.target = intent.target;
  if (intent.data) payload.data = intent.data;

  const block: ChatBlock = {
    type: 'action_buttons',
    blockId: `crud-action-${intent.section}-${intent.action}`,
    title: 'Apply to Intelligence data',
    buttons: [
      {
        label: `Run ${intent.action.toUpperCase()}`,
        sublabel: `Section: ${intent.section.replace(/_/g, ' ')}`,
        action: `intel_${intent.action}`,
        intent: 'primary',
        payload,
      },
      {
        label: 'Preview section',
        sublabel: 'Open section for review',
        action: 'intel_read',
        intent: 'secondary',
        payload: {
          section: intent.section,
          action: 'read',
        },
      },
    ],
  };

  return [...blocks, block];
}
