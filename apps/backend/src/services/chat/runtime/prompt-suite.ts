import { openai, OpenAI } from '../../ai/openai-client';
import type { RuntimeDecision, RuntimePlan, RuntimeToolCall, RuntimeToolResult } from './types';
import { TOOL_REGISTRY } from '../../ai/chat/tools/tool-registry';

type PlannerInput = {
  researchJobId: string;
  branchId: string;
  userMessage: string;
  runtimeContext?: Record<string, unknown>;
  policy: {
    allowMutationTools: boolean;
    maxToolRuns: number;
    maxAutoContinuations: number;
  };
  previousMessages: Array<{ role: string; content: string }>;
};

type SummarizerInput = {
  userMessage: string;
  plan: RuntimePlan;
  toolResults: RuntimeToolResult[];
};

type SummarizerOutput = {
  highlights: string[];
  facts: Array<{
    claim: string;
    evidence: string[];
  }>;
  openQuestions: string[];
  recommendedContinuations: string[];
};

type WriterInput = {
  userMessage: string;
  plan: RuntimePlan;
  toolSummary: SummarizerOutput;
  toolResults: RuntimeToolResult[];
  runtimeContext?: Record<string, unknown>;
};

type WriterOutput = {
  response: string;
  reasoning: {
    plan: string[];
    tools: string[];
    assumptions: string[];
    nextSteps: string[];
    evidence: Array<{ id: string; label: string; url?: string }>;
  };
  actions: Array<{
    label: string;
    action: string;
    payload?: Record<string, unknown>;
  }>;
  decisions: RuntimeDecision[];
};

type ValidatorInput = {
  userMessage: string;
  plan: RuntimePlan;
  writerOutput: WriterOutput;
  toolResults: RuntimeToolResult[];
};

type ValidatorOutput = {
  pass: boolean;
  issues: Array<{
    code: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  suggestedFixes: string[];
};

const ALLOWED_PLANNER_TOOL_NAMES = TOOL_REGISTRY.map((tool) => tool.name).sort();
const SUPPORTED_TOOL_NAMES = new Set(TOOL_REGISTRY.map((tool) => tool.name));
const PROMPT_STEP_TIMEOUT_MS = 30_000;

const TOOL_NAME_ALIASES: Record<string, { tool: string; args: Record<string, unknown> }> = {
  competitoranalysis: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  competitoraudit: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  competitorfinderv3: { tool: 'competitors.discover_v3', args: { mode: 'standard' } },
  discovercompetitorsv3: { tool: 'competitors.discover_v3', args: { mode: 'standard' } },
  widecompetitordiscovery: { tool: 'competitors.discover_v3', args: { mode: 'wide' } },
  deepcompetitordiscovery: { tool: 'competitors.discover_v3', args: { mode: 'deep' } },
  searchweb: { tool: 'search.web', args: { provider: 'auto', count: 10 } },
  bravesearch: { tool: 'search.web', args: { provider: 'brave', count: 10 } },
  scraplyscan: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  const candidates: string[] = [text];
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const object = text.match(/\{[\s\S]*\}/);
  if (object?.[0]) {
    candidates.push(object[0].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // keep trying
    }
  }

  return null;
}

function normalizeStringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeToolCalls(value: unknown, max = 8): RuntimeToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: RuntimeToolCall[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const tool = String(item.tool || item.name || '').trim();
    if (!tool) continue;
    const args = isRecord(item.args) ? item.args : {};
    const dependsOn = normalizeStringArray(item.dependsOn, 8);
    calls.push({
      tool,
      args,
      ...(dependsOn.length ? { dependsOn } : {}),
    });
    if (calls.length >= max) break;
  }

  return calls;
}

function dedupeToolCalls(calls: RuntimeToolCall[], max = 8): RuntimeToolCall[] {
  const seen = new Set<string>();
  const out: RuntimeToolCall[] = [];
  for (const call of calls) {
    const key = `${call.tool}:${JSON.stringify(call.args || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeDecisions(value: unknown, max = 8): RuntimeDecision[] {
  if (!Array.isArray(value)) return [];
  const decisions: RuntimeDecision[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = String(item.id || '').trim();
    const title = String(item.title || '').trim();
    if (!id || !title) continue;

    const options: Array<{ value: string; label?: string }> = [];
    if (Array.isArray(item.options)) {
      for (const option of item.options) {
        if (typeof option === 'string') {
          const valuePart = option.trim();
          if (valuePart) options.push({ value: valuePart });
          continue;
        }
        if (!isRecord(option)) continue;
        const valuePart = String(option.value || option.label || '').trim();
        if (!valuePart) continue;
        options.push({
          value: valuePart,
          ...(typeof option.label === 'string' ? { label: option.label } : {}),
        });
      }
    }

    if (!options.length) continue;

    decisions.push({
      id,
      title,
      options,
      ...(typeof item.default === 'string' ? { default: item.default } : {}),
      blocking: Boolean(item.blocking),
    });

    if (decisions.length >= max) break;
  }

  return decisions;
}

function completionText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  return String(response.choices?.[0]?.message?.content || '').trim();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function requestJson(task: Parameters<typeof openai.bat.chatCompletion>[0], messages: OpenAI.Chat.ChatCompletionMessageParam[], maxTokens = 900) {
  const completion = (await withTimeout(
    openai.bat.chatCompletion(task, {
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }) as Promise<OpenAI.Chat.Completions.ChatCompletion>,
    PROMPT_STEP_TIMEOUT_MS,
    `Prompt task ${task}`
  )) as OpenAI.Chat.Completions.ChatCompletion;

  const text = completionText(completion);
  const parsed = extractJsonObject(text);
  if (parsed) return parsed;

  // One repair attempt for malformed JSON output.
  const repairCompletion = (await withTimeout(
    openai.bat.chatCompletion('analysis_fast', {
      messages: [
        {
          role: 'system',
          content:
            'You repair malformed JSON. Return one valid JSON object only with no markdown and no explanation.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    }) as Promise<OpenAI.Chat.Completions.ChatCompletion>,
    PROMPT_STEP_TIMEOUT_MS,
    `Prompt task ${task} (repair)`
  )) as OpenAI.Chat.Completions.ChatCompletion;

  return extractJsonObject(completionText(repairCompletion));
}

function fallbackSummarizer(input: SummarizerInput): SummarizerOutput {
  const highlights = input.toolResults.slice(0, 6).map((result) => result.summary);
  const facts = input.toolResults
    .flatMap((result) =>
      result.evidence.slice(0, 3).map((evidence) => ({
        claim: result.summary,
        evidence: [evidence.label],
      }))
    )
    .slice(0, 8);

  return {
    highlights: highlights.length ? highlights : ['No tool results were required for this response.'],
    facts,
    openQuestions: [],
    recommendedContinuations: input.toolResults
      .flatMap((result) => result.continuations)
      .flatMap((continuation) => continuation.suggestedNextTools || [])
      .slice(0, 6),
  };
}

function prefersConciseOutput(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  if (!normalized.trim()) return false;
  return /\b(concise|brief|short|tl;dr|tldr|in short|summarize quickly|quick summary)\b/.test(normalized);
}

function findFirstUrl(message: string): string | undefined {
  const fullUrl = message.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (fullUrl) return fullUrl;
  const bareDomain = message.match(/\b([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)\b/i)?.[1];
  return bareDomain ? `https://${bareDomain}` : undefined;
}

function findReferencedCrawlRunId(message: string): string | null {
  const directId = message.match(/\b(crawl-[a-z0-9-]+)\b/i);
  if (directId?.[1]) return directId[1].toLowerCase();

  const labeled = message.match(/\bcrawl\s*run[:\s#-]*([a-z0-9-]+)/i);
  if (!labeled?.[1]) return null;
  const candidate = labeled[1].trim().toLowerCase();
  if (!candidate) return null;
  return candidate.startsWith('crawl-') ? candidate : `crawl-${candidate}`;
}

function extractLibraryMentions(message: string): Array<{ id: string; title: string }> {
  const mentions: Array<{ id: string; title: string }> = [];
  const matcher = /@library\[([^\]|]+)\|([^\]]+)\]/gi;
  let current = matcher.exec(message);
  while (current) {
    const id = String(current[1] || '').trim();
    const title = String(current[2] || '').trim();
    if (id && title) {
      mentions.push({ id, title });
    }
    current = matcher.exec(message);
  }
  return mentions;
}

function withLibraryMentionHints(message: string): string {
  const mentions = extractLibraryMentions(message);
  if (!mentions.length) return message;
  const hints = mentions.map((entry) => `Use evidence from: ${entry.title}`).join('\n');
  return `${message}\n${hints}`;
}

function parseSlashCommand(message: string): { command: string; argsJson: Record<string, unknown> | null } | null {
  const match = String(message || '').trim().match(/^\/([a-z0-9_./-]+)(?:\s+([\s\S]+))?$/i);
  if (!match?.[1]) return null;
  const command = match[1].trim().toLowerCase();
  const argsRaw = String(match[2] || '').trim();
  if (!argsRaw) return { command, argsJson: null };
  if (argsRaw.startsWith('{') && argsRaw.endsWith('}')) {
    try {
      const parsed = JSON.parse(argsRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { command, argsJson: parsed as Record<string, unknown> };
      }
    } catch {
      // Ignore JSON parse failure for free-form slash commands.
    }
  }
  return { command, argsJson: null };
}

function normalizeToolAliasKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9._/-]/g, '')
    .replace(/[./_-]+/g, '');
}

function inferToolCallsFromMessage(message: string): RuntimeToolCall[] {
  const originalMessage = String(message || '');
  const messageWithMentions = withLibraryMentionHints(originalMessage);
  const normalized = messageWithMentions.toLowerCase();
  const calls: RuntimeToolCall[] = [];
  const firstUrl = findFirstUrl(messageWithMentions);
  const referencedCrawlRunId = findReferencedCrawlRunId(messageWithMentions);
  const libraryMentions = extractLibraryMentions(originalMessage);
  const slashCommand = parseSlashCommand(originalMessage);

  const pushIfMissing = (tool: string, args: Record<string, unknown>) => {
    const key = `${tool}:${JSON.stringify(args)}`;
    const exists = calls.some((entry) => `${entry.tool}:${JSON.stringify(entry.args)}` === key);
    if (!exists) calls.push({ tool, args });
  };

  const hasCompetitorSignals = /\b(competitor|rival|alternative|inspiration|accounts?|handles?)\b/.test(normalized);
  const hasAddIntent = /\b(add|include|save|insert|append|import|update)\b/.test(normalized);
  const hasCompetitorLinks = /(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|@[a-z0-9._-]+)/i.test(
    messageWithMentions
  );
  const hasIntakeHeadings =
    /what services do you offer|what do you do in one sentence|what are the top 3 problems|who is the ideal audience|what results should content drive|what do people usually ask/i.test(
      message
    );
  const hasIntakeUpdateIntent =
    /\b(update|replace|refresh|apply|rewrite|save)\b/.test(normalized) &&
    /\b(form|intake|onboarding|onboard|original form content)\b/.test(normalized);
  const hasIntakeReadIntent =
    /\b(original|initial|first)\b/.test(normalized) &&
    /\b(form|intake|onboarding)\b/.test(normalized) &&
    /\b(response|submission|answers?)\b/.test(normalized);
  const hasRunIntent = /\b(run|start|continue|resume|expand|investigat(?:e|ing)|analy[sz]e)\b/.test(normalized);
  const hasFindIntent = /\b(find|finder|discover|identify|map|search|look up)\b/.test(normalized);
  const hasCompetitorDiscoveryIntent =
    /\b(competitor discovery|discover competitors|competitor investigation|competitor set)\b/.test(normalized) ||
    (/\bcompetitor\b/.test(normalized) && /\b(discovery|discover|investigat|analy[sz]e)\b/.test(normalized));
  const hasV3DiscoveryIntent =
    /\b(v3|discover_v3|competitor finder|best competitor finder|wide competitor)\b/.test(normalized) ||
    (/\b(adjacent|substitute|aspirational|complementary)\b/.test(normalized) && /\bcompetitor\b/.test(normalized));
  const hasExplicitWebSearchIntent =
    /\b(search (the )?(web|internet)|web search|find online|look up online)\b/.test(normalized) &&
    !/\b(competitor|rival|alternative)\b/.test(normalized);
  const hasCompetitorStatusIntent =
    /\b(status|progress|started|update)\b/.test(normalized) && /\bcompetitor\b/.test(normalized);
  const hasDeepInvestigationIntent =
    /\b(deep|deeper|thorough|full|comprehensive|detailed)\b/.test(normalized) &&
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder)\b/.test(normalized);
  const hasResearchSignal =
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder|handle)\b/.test(normalized) &&
    (/(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|@[a-z0-9._-]+)/i.test(messageWithMentions) ||
      /\b(ddg|duckduckgo|scraply|scrapling|crawl|fetch)\b/.test(normalized));
  const hasEvidenceReferenceIntent =
    /use evidence from|evidence from/i.test(messageWithMentions) ||
    (/\b(evidence|source|sources)\b/.test(normalized) && /\b(use|ground|base|summariz|detail|answer)\b/.test(normalized));
  const hasWorkspaceOverviewIntent =
    /\b(what do (you|we) (see|have)|what['’]s (on|in) (the )?(app|application|workspace)|show (me )?(what|everything) (we|you) (have|see)|workspace status|workspace snapshot|summari[sz]e (the )?(workspace|app|application))\b/.test(
      normalized
    );

  if (slashCommand) {
    if (slashCommand.command === 'show_sources') {
      pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
      pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
      pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
      pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
      pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
      pushIfMissing('evidence.news', { limit: 8 });
    } else if (slashCommand.command === 'generate_pdf') {
      pushIfMissing('document.plan', {
        docType: 'STRATEGY_BRIEF',
        depth: 'standard',
        includeCompetitors: true,
        includeEvidenceLinks: true,
      });
    } else if (slashCommand.command === 'audit') {
      pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
      pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
      pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
      pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
      pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
      pushIfMissing('evidence.news', { limit: 8 });
    } else if (SUPPORTED_TOOL_NAMES.has(slashCommand.command as (typeof TOOL_REGISTRY)[number]['name'])) {
      pushIfMissing(slashCommand.command, slashCommand.argsJson || {});
    } else {
      const alias = TOOL_NAME_ALIASES[normalizeToolAliasKey(slashCommand.command)];
      if (alias) {
        pushIfMissing(alias.tool, {
          ...(slashCommand.argsJson || {}),
          ...(alias.args || {}),
        });
      }
    }
  }

  if (hasCompetitorSignals) {
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
  }
  if (
    ((hasAddIntent && hasCompetitorSignals) ||
      /competitors?\s*(?:\/|or)\s*inspiration/i.test(messageWithMentions) ||
      /\bcompetitor(?:s)?\b/.test(normalized)) &&
    hasCompetitorLinks
  ) {
    pushIfMissing('competitors.add_links', { text: messageWithMentions });
  }
  if (hasIntakeUpdateIntent || hasIntakeHeadings) {
    pushIfMissing('intake.update_from_text', { text: message });
  }
  if (hasIntakeReadIntent) {
    pushIfMissing('workspace.intake.get', {});
  }
  if ((hasRunIntent && hasCompetitorDiscoveryIntent) || (hasFindIntent && /\bcompetitor\b/.test(normalized))) {
    if (hasV3DiscoveryIntent) {
      pushIfMissing('competitors.discover_v3', {
        mode: hasDeepInvestigationIntent ? 'deep' : 'standard',
        maxCandidates: hasDeepInvestigationIntent ? 200 : 120,
        maxEnrich: hasDeepInvestigationIntent ? 18 : 10,
      });
    } else {
      pushIfMissing('orchestration.run', { targetCount: 12, mode: 'append' });
    }
  }
  if (hasCompetitorStatusIntent) {
    pushIfMissing('orchestration.status', {});
  }
  if (hasDeepInvestigationIntent || hasResearchSignal) {
    pushIfMissing('research.gather', {
      query: messageWithMentions,
      depth: hasDeepInvestigationIntent ? 'deep' : 'standard',
      includeScrapling: true,
      includeAccountContext: true,
    });
  }
  if (/intake|onboard|kickoff|audit|workspace|strategy|investigat|analy[sz]e/.test(normalized)) {
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
    pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
    pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
    pushIfMissing('evidence.news', { limit: 8 });
  }
  if (/web|site|website|source|snapshot|page/.test(normalized)) {
    pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 12 });
  }
  if (hasWorkspaceOverviewIntent) {
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
    pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
    pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
  }
  if (/crawl|spider/.test(normalized) && firstUrl) {
    pushIfMissing('web.crawl', { startUrls: [firstUrl], maxPages: 8, maxDepth: 1 });
  }
  if (referencedCrawlRunId) {
    pushIfMissing('web.crawl.list_snapshots', { runId: referencedCrawlRunId, limit: 50 });
  }
  if (hasEvidenceReferenceIntent && firstUrl) {
    pushIfMissing('web.fetch', { url: firstUrl, sourceType: 'ARTICLE', discoveredBy: 'CHAT_TOOL' });
  }
  if (/(fetch|scrape|extract).*(web|site|page|url)|\bfetch\b/.test(normalized) && firstUrl) {
    pushIfMissing('web.fetch', { url: firstUrl, sourceType: 'ARTICLE', discoveredBy: 'CHAT_TOOL' });
  }
  if (/community|reddit|forum|insight/.test(normalized)) {
    pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
  }
  if (hasExplicitWebSearchIntent) {
    pushIfMissing('search.web', { query: originalMessage, count: 10, provider: 'auto' });
  }
  if (/news|press|mention/.test(normalized)) {
    pushIfMissing('evidence.news', { limit: 8 });
  }
  if (/video|youtube/.test(normalized)) {
    pushIfMissing('evidence.videos', { limit: 8 });
  }
  if (/post|example|tiktok|instagram|social/.test(normalized)) {
    pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
  }
  if (/report|pdf|brief|document/.test(normalized)) {
    pushIfMissing('document.plan', {
      docType: 'STRATEGY_BRIEF',
      depth: 'standard',
      includeCompetitors: true,
      includeEvidenceLinks: true,
    });
  }

  if (libraryMentions.length) {
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
  }

  return calls;
}

function fallbackPlannerPlan(message: string): RuntimePlan {
  const toolCalls = inferToolCallsFromMessage(message);
  const concise = prefersConciseOutput(message);
  return {
    goal: 'Generate an evidence-grounded response for the active branch',
    plan: toolCalls.length
      ? [
          'Collect relevant evidence and intelligence signals',
          'Synthesize findings with assumptions and next steps',
          'Ask for approvals when required before mutations',
        ]
      : ['Respond directly with available context and suggest next actions'],
    toolCalls,
    needUserInput: false,
    decisionRequests: [],
    responseStyle: {
      depth: concise ? 'fast' : 'deep',
      tone: 'friendly',
    },
    runtime: {
      continuationDepth: 0,
    },
  };
}

function fallbackWriter(input: WriterInput): WriterOutput {
  const concise = prefersConciseOutput(input.userMessage);
  const evidence = input.toolResults
    .flatMap((result) => result.evidence)
    .slice(0, concise ? 8 : 14)
    .map((item, idx) => ({
      id: `e-${idx + 1}`,
      label: item.label,
      ...(item.url ? { url: item.url } : {}),
    }));

  const topHighlights = input.toolSummary.highlights
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, concise ? 4 : 8);
  const topFacts = input.toolSummary.facts
    .map((fact) => {
      const claim = String(fact.claim || '').trim();
      if (!claim) return '';
      const evidenceSnippet = fact.evidence
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, concise ? 2 : 3);
      return evidenceSnippet.length ? `${claim} (${evidenceSnippet.join('; ')})` : claim;
    })
    .filter(Boolean)
    .slice(0, concise ? 3 : 7);
  const topWarnings = Array.from(
    new Set(
      input.toolResults
        .flatMap((result) => result.warnings)
        .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  ).slice(0, concise ? 2 : 4);
  const hasToolResults = input.toolResults.length > 0;
  const runtimeContext = isRecord(input.runtimeContext) ? input.runtimeContext : {};
  const contextSummary: string[] = [];
  const clientName = String(runtimeContext.clientName || '').trim();
  const websites = Array.isArray(runtimeContext.websites)
    ? runtimeContext.websites.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const competitorsCount = Number(runtimeContext.competitorsCount || 0);
  const candidateCompetitorsCount = Number(runtimeContext.candidateCompetitorsCount || 0);
  const webSnapshotsCount = Number(runtimeContext.webSnapshotsCount || 0);

  if (clientName) contextSummary.push(`Workspace: ${clientName}.`);
  if (websites.length) contextSummary.push(`Known website(s): ${websites.join(', ')}.`);
  if (Number.isFinite(webSnapshotsCount) && webSnapshotsCount > 0) {
    contextSummary.push(`Stored web snapshots: ${webSnapshotsCount}.`);
  }
  if (Number.isFinite(competitorsCount) && competitorsCount > 0) {
    contextSummary.push(`Discovered competitors: ${competitorsCount}.`);
  }
  if (Number.isFinite(candidateCompetitorsCount) && candidateCompetitorsCount > 0) {
    contextSummary.push(`Candidate competitors pending review: ${candidateCompetitorsCount}.`);
  }

  const responseSections: string[] = [];
  if (!hasToolResults) {
    if (contextSummary.length) {
      responseSections.push(`Grounded workspace snapshot:\n${contextSummary.map((line, idx) => `${idx + 1}. ${line}`).join('\n')}`);
    }
    if (concise) {
      responseSections.push(
        'I do not have fresh tool output attached to this message yet, so I cannot verify claims from this run.'
      );
      responseSections.push('Share a URL or crawl run id and I will immediately return an evidence-backed summary.');
    } else {
      responseSections.push(
        'I do not have fresh tool output attached to this message yet, so I cannot responsibly make factual claims from this run.'
      );
      responseSections.push(
        'If you share a URL, crawl run id, or ask me to fetch/crawl now, I can produce a grounded answer that includes what was found, what it likely means for your strategy, and what to do next.'
      );
      responseSections.push(
        'If you want, I can also run a broader pass (web + social + news) and deliver a fuller narrative instead of a narrow point lookup.'
      );
    }
  } else {
    if (topHighlights.length > 0) {
      responseSections.push(topHighlights[0]);
    } else {
      responseSections.push('I reviewed the latest workspace evidence and compiled the most relevant takeaways.');
    }

    if (topHighlights.length > 1) {
      const findingLimit = concise ? 3 : 6;
      responseSections.push(
        `${concise ? 'Key findings' : 'What stands out most'}:\n${topHighlights
          .slice(1, 1 + findingLimit)
          .map((item, idx) => `${idx + 1}. ${item}`)
          .join('\n')}`
      );
    }

    if (topFacts.length > 0) {
      responseSections.push(
        `${concise ? 'Evidence references' : 'Evidence I used for this answer'}:\n${topFacts
          .map((item, idx) => `${idx + 1}. ${item}`)
          .join('\n')}`
      );
    }

    if (topWarnings.length > 0) {
      responseSections.push(
        `${concise ? 'Caveats' : 'What to keep in mind'}:\n${topWarnings.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
      );
    }

    if (!concise) {
      responseSections.push(
        'If you want, I can now turn this into a concrete deliverable next (for example: a post concept, testing plan, or client-ready brief) using the same evidence set.'
      );
    }
  }

  const nextSteps = hasToolResults
    ? concise
      ? ['Tell me which finding to prioritize first.', 'Say "go deeper" if you want an expanded strategic pass.']
      : [
          ...input.toolSummary.openQuestions.slice(0, 3).map((item) => String(item || '').trim()).filter(Boolean),
          'Tell me which angle to deepen first: strategy implications, content ideas, or execution plan.',
          'If helpful, I can draft the next output directly from this evidence (post prompt, campaign brief, or PDF).',
        ].slice(0, 5)
    : concise
      ? ['Provide a URL or crawl run id to inspect next.']
      : [
          'Provide one URL or crawl run id and I will run a grounded pass.',
          'Tell me if you want a narrow answer (single source) or a broad answer (web + social + news).',
      ];
  const hasCompetitorSignals = /\bcompetitor|adjacent|substitute|inspiration\b/i.test(String(input.userMessage || ''));
  const actions: WriterOutput['actions'] = [
    { label: 'Show sources', action: 'show_sources' },
    { label: 'Generate PDF', action: 'generate_pdf' },
  ];
  if (hasCompetitorSignals) {
    actions.unshift({
      label: 'Run V3 competitor finder',
      action: 'competitors.discover_v3',
      payload: { mode: 'standard', maxCandidates: 140, maxEnrich: 10 },
    });
  } else {
    actions.unshift({
      label: 'Search web evidence',
      action: 'search.web',
      payload: { query: String(input.userMessage || '').slice(0, 180), count: 10, provider: 'auto' },
    });
  }

  return {
    response: responseSections.filter((section) => section.trim().length > 0).join('\n\n'),
    reasoning: {
      plan: input.plan.plan,
      tools: input.plan.toolCalls.map((call) => call.tool),
      assumptions: hasToolResults
        ? ['Only evidence collected in this branch run is used for factual claims.']
        : ['No tool results were available in this run.'],
      nextSteps,
      evidence,
    },
    actions,
    decisions: [],
  };
}

function fallbackValidator(): ValidatorOutput {
  return {
    pass: true,
    issues: [],
    suggestedFixes: [],
  };
}

export async function generatePlannerPlan(input: PlannerInput): Promise<RuntimePlan> {
  const fallback = fallbackPlannerPlan(input.userMessage);
  const conciseRequested = prefersConciseOutput(input.userMessage);

  const systemPrompt = [
    'You are BAT Planner (Agency Operator).',
    'Return strict JSON only.',
    'No markdown. No prose outside JSON.',
    'Always produce a plan and tool calls when evidence is needed.',
    'Never claim findings without evidence-producing tools.',
    'Prefer at least two evidence lanes when possible (web+social, web+community, etc.).',
    'Default response depth should be deep and comfortable for real users.',
    'Only choose fast depth when the user explicitly asks for concise/brief output.',
    'When the user asks for deeper research on people/accounts/handles or names DDG/Scraply, include research.gather.',
    'Use intel.get only when you have section + id/target. For overviews, use intel.list.',
    'Mutation tools require explicit approvals and should be represented via decisionRequests.',
    `Only use tool names from this allowlist: ${ALLOWED_PLANNER_TOOL_NAMES.join(', ')}`,
    'JSON schema:',
    '{',
    '  "goal": "string",',
    '  "plan": ["step"],',
    '  "toolCalls": [{"tool":"name","args":{},"dependsOn":[]}],',
    '  "needUserInput": false,',
    '  "decisionRequests": [{"id":"...","title":"...","options":["..."],"default":"...","blocking":true}],',
    '  "responseStyle": {"depth":"fast|normal|deep","tone":"direct|friendly"}',
    '}',
  ].join('\n');

  const userPrompt = [
    `ResearchJob: ${input.researchJobId}`,
    `Branch: ${input.branchId}`,
    `Policy: ${JSON.stringify(input.policy)}`,
    `Runtime context snapshot: ${JSON.stringify(input.runtimeContext || {})}`,
    `User message: ${input.userMessage}`,
    `Recent branch messages: ${JSON.stringify(input.previousMessages.slice(-12))}`,
  ].join('\n\n');

  try {
    const parsed = await requestJson('workspace_chat_planner', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 900);

    if (!parsed) return fallback;

    const planSteps = normalizeStringArray(parsed.plan, 12);
    const plannerToolCalls = normalizeToolCalls(parsed.toolCalls, input.policy.maxToolRuns);
    const hasDeepResearchIntent =
      /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder|handle)\b/i.test(input.userMessage) &&
      /\b(deep|deeper|thorough|full|comprehensive|detailed|ddg|duckduckgo|scraply|scrapling)\b/i.test(input.userMessage);
    const fallbackResearchCall = fallback.toolCalls.find((entry) => entry.tool === 'research.gather');
    const plannerHasResearchGather = plannerToolCalls.some((entry) => entry.tool === 'research.gather');
    const mergedToolCalls = plannerToolCalls.length
      ? dedupeToolCalls(
          [
            ...(hasDeepResearchIntent && fallbackResearchCall && !plannerHasResearchGather ? [fallbackResearchCall] : []),
            ...plannerToolCalls,
            ...fallback.toolCalls,
          ],
          input.policy.maxToolRuns
        )
      : fallback.toolCalls;
    const decisions = normalizeDecisions(parsed.decisionRequests, 8);

    const defaultDepth = conciseRequested ? 'fast' : 'deep';
    const depthRaw = String((isRecord(parsed.responseStyle) ? parsed.responseStyle.depth : '') || defaultDepth).toLowerCase();
    const toneRaw = String((isRecord(parsed.responseStyle) ? parsed.responseStyle.tone : '') || 'direct').toLowerCase();

    const depth: 'fast' | 'normal' | 'deep' =
      conciseRequested
        ? 'fast'
        : depthRaw === 'fast' || depthRaw === 'deep'
          ? (depthRaw as 'fast' | 'deep')
          : 'deep';
    const tone: 'direct' | 'friendly' = toneRaw === 'friendly' ? 'friendly' : 'direct';

    return {
      goal: String(parsed.goal || fallback.goal),
      plan: planSteps.length ? planSteps : fallback.plan,
      toolCalls: mergedToolCalls,
      needUserInput: Boolean(parsed.needUserInput),
      decisionRequests: decisions,
      responseStyle: { depth, tone },
      runtime: {
        continuationDepth: 0,
      },
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Planner failed, using fallback:', (error as Error).message);
    return fallback;
  }
}

export async function summarizeToolResults(input: SummarizerInput): Promise<SummarizerOutput> {
  if (!input.toolResults.length) {
    return fallbackSummarizer(input);
  }

  const systemPrompt = [
    'You are BAT Tool Result Summarizer.',
    'Return strict JSON only.',
    'No markdown.',
    'Convert tool outputs into complete, specific, usable context for a writer.',
    'Prefer precision and coverage over brevity.',
    'JSON schema:',
    '{',
    '  "highlights": ["..."],',
    '  "facts": [{"claim":"...","evidence":["..."]}],',
    '  "openQuestions": ["..."],',
    '  "recommendedContinuations": ["tool.name"]',
    '}',
  ].join('\n');

  const payload = {
    userMessage: input.userMessage,
    plan: input.plan,
    toolResults: input.toolResults,
  };

  try {
    const parsed = await requestJson('analysis_fast', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(payload) },
    ], 900);

    if (!parsed) return fallbackSummarizer(input);

    const factsRaw = Array.isArray(parsed.facts) ? parsed.facts : [];
    const facts = factsRaw
      .map((fact) => {
        if (!isRecord(fact)) return null;
        const claim = String(fact.claim || '').trim();
        if (!claim) return null;
        return {
          claim,
          evidence: normalizeStringArray(fact.evidence, 8),
        };
      })
      .filter((fact): fact is { claim: string; evidence: string[] } => Boolean(fact))
      .slice(0, 12);

    return {
      highlights: normalizeStringArray(parsed.highlights, 12),
      facts,
      openQuestions: normalizeStringArray(parsed.openQuestions, 8),
      recommendedContinuations: normalizeStringArray(parsed.recommendedContinuations, 8),
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Summarizer failed, using fallback:', (error as Error).message);
    return fallbackSummarizer(input);
  }
}

export async function writeClientResponse(input: WriterInput): Promise<WriterOutput> {
  const fallback = fallbackWriter(input);
  const conciseRequested = prefersConciseOutput(input.userMessage);

  const systemPrompt = [
    'You are BAT Writer (client-facing communicator).',
    'Return strict JSON only.',
    'Do not include chain-of-thought.',
    'Response must be actionable, thorough, and evidence-grounded.',
    'Do not be terse. Provide enough detail to be directly usable.',
    'Default to a comfortable, high-context response with substantial detail.',
    'Only be concise when the user explicitly asks for concise/brief output.',
    `Concise mode for this request: ${conciseRequested ? 'true' : 'false'}.`,
    'Synthesize evidence into clear narrative and recommendations; do not just output sparse bullet points.',
    'Use the runtime workspace context to ground baseline facts before asking for missing information.',
    'Never include scaffolding labels like "Fork from here", "How BAT got here", "Tools used", "Assumptions", or "Evidence".',
    'Must include recommendation, evidence-backed why, and next steps.',
    'JSON schema:',
    '{',
    '  "response": "string",',
    '  "reasoning": {',
    '    "plan": ["..."],',
    '    "tools": ["tool.name"],',
    '    "assumptions": ["..."],',
    '    "nextSteps": ["..."],',
    '    "evidence": [{"id":"...","label":"...","url":"..."}]',
    '  },',
    '  "actions": [{"label":"...","action":"...","payload":{}}],',
    '  "decisions": [{"id":"...","title":"...","options":["..."],"default":"...","blocking":true}]',
    '}',
  ].join('\n');

  const writerPayload = {
    userMessage: input.userMessage,
    runtimeContext: input.runtimeContext || {},
    plan: input.plan,
    toolSummary: input.toolSummary,
    toolResults: input.toolResults,
  };

  try {
    const parsed = await requestJson('workspace_chat_writer', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(writerPayload) },
    ], 2200);

    if (!parsed) return fallback;

    const reasoningRaw = isRecord(parsed.reasoning) ? parsed.reasoning : {};
    const evidenceRaw = Array.isArray(reasoningRaw.evidence) ? reasoningRaw.evidence : [];

    const evidence = evidenceRaw
      .map((entry) => {
        if (!isRecord(entry)) return null;
        const id = String(entry.id || '').trim();
        const label = String(entry.label || '').trim();
        if (!id || !label) return null;
        return {
          id,
          label,
          ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
        };
      })
      .filter((entry): entry is { id: string; label: string; url?: string } => Boolean(entry))
      .slice(0, 20);

    const actions = Array.isArray(parsed.actions)
      ? parsed.actions
          .map((entry) => {
            if (!isRecord(entry)) return null;
            const label = String(entry.label || '').trim();
            const action = String(entry.action || '').trim();
            if (!label || !action) return null;
            return {
              label,
              action,
              ...(isRecord(entry.payload) ? { payload: entry.payload } : {}),
            };
          })
          .filter((entry): entry is { label: string; action: string; payload?: Record<string, unknown> } => Boolean(entry))
          .slice(0, 8)
      : [];

    return {
      response: String(parsed.response || fallback.response),
      reasoning: {
        plan: normalizeStringArray(reasoningRaw.plan, 12),
        tools: normalizeStringArray(reasoningRaw.tools, 12),
        assumptions: normalizeStringArray(reasoningRaw.assumptions, 10),
        nextSteps: normalizeStringArray(reasoningRaw.nextSteps, 10),
        evidence,
      },
      actions,
      decisions: normalizeDecisions(parsed.decisions, 8),
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Writer failed, using fallback:', (error as Error).message);
    return fallback;
  }
}

export async function validateClientResponse(input: ValidatorInput): Promise<ValidatorOutput> {
  const fallback = fallbackValidator();

  const systemPrompt = [
    'You are BAT Validator (trust and safety).',
    'Return strict JSON only.',
    'Check grounding, fallback quality, mutation confirmations, and response completeness.',
    'JSON schema:',
    '{',
    '  "pass": true,',
    '  "issues": [{"code":"...","severity":"low|medium|high","message":"..."}],',
    '  "suggestedFixes": ["..."]',
    '}',
  ].join('\n');

  try {
    const parsed = await requestJson('workspace_chat_validator', [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          userMessage: input.userMessage,
          plan: input.plan,
          writerOutput: input.writerOutput,
          toolResults: input.toolResults,
        }),
      },
    ], 700);

    if (!parsed) return fallback;

    const issuesRaw = Array.isArray(parsed.issues) ? parsed.issues : [];
    const issues = issuesRaw
      .map((issue) => {
        if (!isRecord(issue)) return null;
        const code = String(issue.code || '').trim();
        const message = String(issue.message || '').trim();
        if (!code || !message) return null;
        const severityRaw = String(issue.severity || 'low').trim().toLowerCase();
        const severity: 'low' | 'medium' | 'high' =
          severityRaw === 'high' || severityRaw === 'medium' ? (severityRaw as 'high' | 'medium') : 'low';
        return { code, message, severity };
      })
      .filter((issue): issue is { code: string; severity: 'low' | 'medium' | 'high'; message: string } => Boolean(issue))
      .slice(0, 12);

    return {
      pass: Boolean(parsed.pass),
      issues,
      suggestedFixes: normalizeStringArray(parsed.suggestedFixes, 10),
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Validator failed, using fallback:', (error as Error).message);
    return fallback;
  }
}
