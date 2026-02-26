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
  const asksListData = includesAny(message, [
    /\blist\b/i,
    /\bshow\b/i,
    /\bread\b/i,
    /\bwhat do we have\b/i,
    /\bwhat do you see\b/i,
    /\bwhat(?:'s| is) here\b/i,
    /\boverview\b/i,
    /\bfetch\b/i,
  ]);
  const asksWorkspaceOverview = includesAny(message, [
    /\bwhat do you see\b/i,
    /\bwhat do we have\b/i,
    /\bwhat(?:'s| is) (on|in) (the )?(app|application|workspace)\b/i,
    /\bworkspace status\b/i,
    /\bworkspace snapshot\b/i,
    /\boverview\b/i,
  ]);
  const asksGetById = includesAny(message, [/\b(id|row|record)\b/i, /\bget\b/i]);
  const asksOriginalForm = includesAny(message, [
    /\b(original|initial|first)\b.*\b(form|intake|onboarding)\b.*\b(response|submission|answers?)\b/i,
    /\bwhat was my original form response\b/i,
  ]);

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

  if (asksListData && !existingNames.has('intel.list')) {
    const sectionPatterns: Array<{ section: string; patterns: RegExp[] }> = [
      { section: 'competitors', patterns: [/\bcompetitors?\b/i] },
      {
        section: 'competitor_entities',
        patterns: [/\bcompetitor (brands|entities|companies)\b/i, /\bbrand-level competitors?\b/i],
      },
      {
        section: 'competitor_accounts',
        patterns: [/\bcompetitor accounts?\b/i, /\bcompetitor handles?\b/i, /\bplatform competitors?\b/i],
      },
      { section: 'client_profiles', patterns: [/\bclient profiles?\b/i, /\baccounts?\b/i, /\bhandles?\b/i] },
      { section: 'news', patterns: [/\bnews\b/i, /\bpress\b/i, /\barticles?\b/i] },
      { section: 'videos', patterns: [/\bvideos?\b/i, /\byoutube\b/i] },
      { section: 'images', patterns: [/\bimages?\b/i, /\bphotos?\b/i] },
      { section: 'search_results', patterns: [/\bsearch results?\b/i, /\bserp\b/i] },
      { section: 'brand_mentions', patterns: [/\bbrand mentions?\b/i, /\bmentions?\b/i] },
      { section: 'community_insights', patterns: [/\bcommunity\b/i, /\binsights?\b/i] },
      { section: 'search_trends', patterns: [/\btrends?\b/i, /\bkeywords?\b/i] },
      { section: 'media_assets', patterns: [/\bmedia assets?\b/i, /\bdownloads?\b/i] },
      { section: 'ai_questions', patterns: [/\bquestions?\b/i, /\bai questions?\b/i] },
      { section: 'web_sources', patterns: [/\bweb sources?\b/i, /\bsources?\b/i] },
      { section: 'web_snapshots', patterns: [/\bweb snapshots?\b/i, /\bsnapshots?\b/i] },
      { section: 'web_extraction_recipes', patterns: [/\brecipes?\b/i, /\bextraction recipes?\b/i] },
      { section: 'web_extraction_runs', patterns: [/\bextraction runs?\b/i, /\bruns?\b/i] },
    ];

    const matched = sectionPatterns.find((entry) => includesAny(message, entry.patterns));
    if (matched) {
      calls.push({
        name: 'intel.list',
        args: {
          section: matched.section,
          limit: includesAny(message, [/\btop\b/i, /\bfew\b/i, /\bsummary\b/i]) ? 15 : 30,
          includeInactive: includesAny(message, [/\barchived\b/i, /\binactive\b/i]),
        },
        reason: `Message asks to list/read intelligence data for ${matched.section}.`,
      });
    } else if (asksWorkspaceOverview) {
      calls.push({
        name: 'intel.list',
        args: {
          section: 'web_snapshots',
          limit: 20,
          includeInactive: includesAny(message, [/\barchived\b/i, /\binactive\b/i]),
        },
        reason: 'Message asks for a workspace/app overview; list recent web snapshots as grounding context.',
      });
    }
  }

  if (asksGetById && !existingNames.has('intel.get')) {
    const idMatch = input.userMessage.match(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i);
    if (idMatch?.[0]) {
      calls.push({
        name: 'intel.get',
        args: {
          section: includesAny(message, [/\bcompetitors?\b/i]) ? 'competitors' : 'web_snapshots',
          id: idMatch[0],
        },
        reason: 'Message includes a specific record id and asks for details.',
      });
    }
  }

  if (asksOriginalForm && !existingNames.has('workspace.intake.get')) {
    calls.push({
      name: 'workspace.intake.get',
      args: {},
      reason: 'Message asks for original intake/form responses stored in the workspace.',
    });
  }

  return calls;
}
