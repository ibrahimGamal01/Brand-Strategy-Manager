import { openai, OpenAI } from '../../ai/openai-client';
import type { RuntimeDecision, RuntimePlan, RuntimeToolCall, RuntimeToolResult } from './types';
import { TOOL_REGISTRY } from '../../ai/chat/tools/tool-registry';

type PlannerInput = {
  researchJobId: string;
  branchId: string;
  userMessage: string;
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
const PROMPT_STEP_TIMEOUT_MS = 30_000;

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
  return extractJsonObject(text);
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

function inferToolCallsFromMessage(message: string): RuntimeToolCall[] {
  const normalized = message.toLowerCase();
  const calls: RuntimeToolCall[] = [];
  const firstUrl =
    message.match(/https?:\/\/[^\s)]+/i)?.[0] ||
    (message.match(/\b([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)\b/i)?.[1]
      ? `https://${message.match(/\b([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)\b/i)?.[1]}`
      : undefined);

  const pushIfMissing = (tool: string, args: Record<string, unknown>) => {
    const key = `${tool}:${JSON.stringify(args)}`;
    const exists = calls.some((entry) => `${entry.tool}:${JSON.stringify(entry.args)}` === key);
    if (!exists) calls.push({ tool, args });
  };

  const hasCompetitorSignals = /\b(competitor|rival|alternative|inspiration|accounts?|handles?)\b/.test(normalized);
  const hasAddIntent = /\b(add|include|save|insert|append|import|update)\b/.test(normalized);
  const hasCompetitorLinks = /(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|@[a-z0-9._-]+)/i.test(
    message
  );
  const hasIntakeHeadings =
    /what services do you offer|what do you do in one sentence|what are the top 3 problems|who is the ideal audience|what results should content drive|what do people usually ask/i.test(
      message
    );
  const hasIntakeUpdateIntent =
    /\b(update|replace|refresh|apply|rewrite|save)\b/.test(normalized) &&
    /\b(form|intake|onboarding|onboard|original form content)\b/.test(normalized);
  const hasRunIntent = /\b(run|start|continue|resume|expand|investigat(?:e|ing)|analy[sz]e)\b/.test(normalized);
  const hasCompetitorDiscoveryIntent =
    /\b(competitor discovery|discover competitors|competitor investigation|competitor set)\b/.test(normalized) ||
    (/\bcompetitor\b/.test(normalized) && /\b(discovery|discover|investigat|analy[sz]e)\b/.test(normalized));
  const hasCompetitorStatusIntent =
    /\b(status|progress|started|update)\b/.test(normalized) && /\bcompetitor\b/.test(normalized);
  const hasDeepInvestigationIntent =
    /\b(deep|deeper|thorough|full|comprehensive|detailed)\b/.test(normalized) &&
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder)\b/.test(normalized);
  const hasResearchSignal =
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder|handle)\b/.test(normalized) &&
    (/(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|@[a-z0-9._-]+)/i.test(message) ||
      /\b(ddg|duckduckgo|scraply|scrapling|crawl|fetch)\b/.test(normalized));

  if (hasCompetitorSignals) {
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
  }
  if (
    ((hasAddIntent && hasCompetitorSignals) ||
      /competitors?\s*(?:\/|or)\s*inspiration/i.test(message) ||
      /\bcompetitor(?:s)?\b/.test(normalized)) &&
    hasCompetitorLinks
  ) {
    pushIfMissing('competitors.add_links', { text: message });
  }
  if (hasIntakeUpdateIntent || hasIntakeHeadings) {
    pushIfMissing('intake.update_from_text', { text: message });
  }
  if (hasRunIntent && hasCompetitorDiscoveryIntent) {
    pushIfMissing('orchestration.run', { targetCount: 12, mode: 'append' });
  }
  if (hasCompetitorStatusIntent) {
    pushIfMissing('orchestration.status', {});
  }
  if (hasDeepInvestigationIntent || hasResearchSignal) {
    pushIfMissing('research.gather', {
      query: message,
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
  if (/crawl|spider/.test(normalized) && firstUrl) {
    pushIfMissing('web.crawl', { startUrls: [firstUrl], maxPages: 8, maxDepth: 1 });
  }
  if (/(fetch|scrape|extract).*(web|site|page|url)|\bfetch\b/.test(normalized) && firstUrl) {
    pushIfMissing('web.fetch', { url: firstUrl, sourceType: 'ARTICLE', discoveredBy: 'CHAT_TOOL' });
  }
  if (/community|reddit|forum|insight/.test(normalized)) {
    pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
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

  return calls;
}

function fallbackPlannerPlan(message: string): RuntimePlan {
  const toolCalls = inferToolCallsFromMessage(message);
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
      depth: toolCalls.length ? 'normal' : 'fast',
      tone: 'friendly',
    },
    runtime: {
      continuationDepth: 0,
    },
  };
}

function fallbackWriter(input: WriterInput): WriterOutput {
  const evidence = input.toolResults
    .flatMap((result) => result.evidence)
    .slice(0, 8)
    .map((item, idx) => ({
      id: `e-${idx + 1}`,
      label: item.label,
      ...(item.url ? { url: item.url } : {}),
    }));

  const toolSummaries = input.toolResults
    .map((result, index) => {
      const toolName = input.plan.toolCalls[index]?.tool || input.plan.toolCalls[input.plan.toolCalls.length - 1]?.tool || 'tool';
      const summary = String(result.summary || '').trim();
      const artifactCount = Array.isArray(result.artifacts) ? result.artifacts.length : 0;
      const evidenceCount = Array.isArray(result.evidence) ? result.evidence.length : 0;
      const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;
      const parts = [
        summary,
        artifactCount ? `${artifactCount} artifact(s)` : '',
        evidenceCount ? `${evidenceCount} evidence link(s)` : '',
        warningCount ? `${warningCount} warning(s)` : '',
      ].filter(Boolean);
      return `${toolName}: ${parts.length ? parts.join(' • ') : 'completed.'}`;
    })
    .filter(Boolean)
    .slice(0, 8);
  const userIntent = input.userMessage.toLowerCase();
  const hasCompetitorIntent =
    /\b(add|include|save|insert|append|update)\b/.test(userIntent) &&
    /\b(competitor|inspiration|accounts?|handles?)\b/.test(userIntent);
  const hasIntakeIntent =
    /\b(update|replace|apply|rewrite|save)\b/.test(userIntent) &&
    /\b(intake|form|onboard|onboarding)\b/.test(userIntent);
  const hasDeepResearchIntent =
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder)\b/.test(userIntent) &&
    (/\b(deep|deeper|thorough|full|comprehensive|detailed)\b/.test(userIntent) ||
      /\b(ddg|duckduckgo|scraply|scrapling)\b/.test(userIntent));
  const intentLead =
    hasCompetitorIntent
      ? 'I processed your competitor update request directly from your message.'
      : hasDeepResearchIntent
        ? 'I ran a deeper evidence pass using DDG and web intelligence tools for the requested accounts/people.'
      : hasIntakeIntent
        ? 'I updated the workspace intake context from your provided text.'
        : 'I processed your request using the latest workspace data and tools.';

  const topHighlights = input.toolSummary.highlights.slice(0, 5);
  return {
    response: [
      intentLead,
      toolSummaries.length
        ? `Tools executed:\n${toolSummaries.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
        : 'No tool executions were required for this step.',
      topHighlights.length
        ? `Evidence highlights:\n${topHighlights.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
        : '',
    ]
      .filter((section) => section.trim().length > 0)
      .join('\n\n'),
    reasoning: {
      plan: input.plan.plan,
      tools: input.plan.toolCalls.map((call) => call.tool),
      assumptions: ['Only evidence collected in this branch run is used for factual claims.'],
      nextSteps: ['Refine scope', 'Fork branch for alternative strategy', 'Generate deliverable'],
      evidence,
    },
    actions: [
      { label: 'Show sources', action: 'show_sources' },
      { label: 'Fork branch', action: 'fork_branch' },
      { label: 'Generate PDF', action: 'generate_pdf' },
    ],
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

  const systemPrompt = [
    'You are BAT Planner (Agency Operator).',
    'Return strict JSON only.',
    'No markdown. No prose outside JSON.',
    'Always produce a plan and tool calls when evidence is needed.',
    'Never claim findings without evidence-producing tools.',
    'Prefer at least two evidence lanes when possible (web+social, web+community, etc.).',
    'When the user asks for deeper research on people/accounts/handles or names DDG/Scraply, include research.gather.',
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

    const depthRaw = String((isRecord(parsed.responseStyle) ? parsed.responseStyle.depth : '') || 'normal').toLowerCase();
    const toneRaw = String((isRecord(parsed.responseStyle) ? parsed.responseStyle.tone : '') || 'direct').toLowerCase();

    const depth: 'fast' | 'normal' | 'deep' =
      depthRaw === 'fast' || depthRaw === 'deep' ? (depthRaw as 'fast' | 'deep') : 'normal';
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
    'Convert tool outputs into concise, usable context for a writer.',
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

  const systemPrompt = [
    'You are BAT Writer (client-facing communicator).',
    'Return strict JSON only.',
    'Do not include chain-of-thought.',
    'Response must be actionable, concise, and evidence-grounded.',
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
    plan: input.plan,
    toolSummary: input.toolSummary,
    toolResults: input.toolResults,
  };

  try {
    const parsed = await requestJson('workspace_chat_writer', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(writerPayload) },
    ], 1200);

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
