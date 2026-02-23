export type PlannerToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type HeuristicToolCall = PlannerToolCall & {
  reason: string;
};

function compactQuery(value: string): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 180);
}

function includesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

export function inferHeuristicToolCalls(input: {
  userMessage: string;
  existingCalls?: PlannerToolCall[];
}): HeuristicToolCall[] {
  const message = String(input.userMessage || '').toLowerCase();
  if (!message.trim()) return [];

  const existingNames = new Set((input.existingCalls || []).map((call) => call.name));
  const calls: HeuristicToolCall[] = [];

  const asksPosts = includesAny(message, [
    /\bbest post\b/i,
    /\btop post\b/i,
    /\bpost performance\b/i,
    /\bhighest engagement\b/i,
    /\bexamples?\b/i,
    /\blink(s|ed)?\b/i,
    /\bshow .*posts?\b/i,
    /\bposts?\b/i,
  ]);

  const asksVideos = includesAny(message, [/\bvideos?\b/i, /\byoutube\b/i]);
  const asksNews = includesAny(message, [/\bnews\b/i, /\bpress\b/i, /\barticles?\b/i]);
  const asksLastWeek = includesAny(message, [/\blast week\b/i, /\bpast week\b/i, /\bthis week\b/i, /\bweekly\b/i]);
  const asksLastMonth = includesAny(message, [/\blast month\b/i, /\bpast month\b/i, /\bmonthly\b/i]);
  const asksRecent = includesAny(message, [/\brecent\b/i, /\blatest\b/i, /\bnewest\b/i]);

  if (asksPosts && !existingNames.has('evidence.posts')) {
    const competitorOnly = includesAny(message, [/\bcompetitors?\b/i, /\btheir\s+posts\b/i]);
    const includeClient = !competitorOnly || /\bmy\b/i.test(message);
    const includeCompetitors = competitorOnly || /\bcompetitors?\b/i.test(message);
    const sort: 'engagement' | 'recent' = asksRecent ? 'recent' : 'engagement';
    const lastNDays = asksLastWeek ? 7 : asksLastMonth ? 30 : undefined;
    calls.push({
      name: 'evidence.posts',
      args: {
        platform: 'any',
        sort,
        limit: /\b(top|best)\b/i.test(message) ? 5 : 10,
        includeClient,
        includeCompetitors,
        ...(lastNDays ? { lastNDays } : {}),
      },
      reason: 'Message requests post examples/performance and should be grounded with post evidence links.',
    });
  }

  if (asksVideos && !existingNames.has('evidence.videos')) {
    calls.push({
      name: 'evidence.videos',
      args: {
        query: compactQuery(input.userMessage),
        limit: 8,
      },
      reason: 'Message requests videos; include stored video evidence links.',
    });
  }

  if (asksNews && !existingNames.has('evidence.news')) {
    calls.push({
      name: 'evidence.news',
      args: {
        query: compactQuery(input.userMessage),
        limit: 8,
      },
      reason: 'Message requests news/press context; include stored news evidence links.',
    });
  }

  return calls;
}
