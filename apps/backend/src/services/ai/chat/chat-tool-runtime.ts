import { randomUUID } from 'node:crypto';
import { openai, OpenAI } from '../openai-client';
import { COST_PROTECTION, costTracker } from '../validation/cost-protection';
import { buildChatRagContext, formatChatContextForLLM } from './chat-rag-context';
import { createAgentLinkHelpers, type AgentContext } from './agent-context';
import { listUserContexts } from '../../chat/user-context-repository';
import { TOOL_REGISTRY, getTool } from './tools/tool-registry';

const TOOL_TIMEOUT_MS = 10_000;
const TOTAL_TOOL_TIMEOUT_MS = 20_000;
const MAX_TOOL_LOOP_ITERATIONS = 2;

export type ToolExecutionResult = {
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
};

type PlannerToolCall = {
  name: string;
  args: Record<string, unknown>;
};

type PlannerPayload = {
  tool_calls: PlannerToolCall[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateArgsAgainstSchema(args: Record<string, unknown>, schema: Record<string, unknown>): boolean {
  if (!isRecord(schema) || schema.type !== 'object') return true;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (schema.additionalProperties === false) {
    const keys = Object.keys(args);
    if (keys.some((key) => !Object.hasOwn(properties, key))) return false;
  }

  for (const [key, fieldSchema] of Object.entries(properties)) {
    if (!Object.hasOwn(args, key)) continue;
    const value = args[key];
    if (!isRecord(fieldSchema)) continue;
    if (Array.isArray(fieldSchema.enum) && !fieldSchema.enum.includes(value)) return false;
    if (fieldSchema.type === 'number' && typeof value !== 'number') return false;
    if (fieldSchema.type === 'string' && typeof value !== 'string') return false;
    if (fieldSchema.type === 'boolean' && typeof value !== 'boolean') return false;
    if (fieldSchema.type === 'array' && !Array.isArray(value)) return false;
    if (typeof value === 'number') {
      if (typeof fieldSchema.minimum === 'number' && value < fieldSchema.minimum) return false;
      if (typeof fieldSchema.maximum === 'number' && value > fieldSchema.maximum) return false;
    }
  }
  return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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

function summarizeToolResults(results: ToolExecutionResult[]): string {
  if (!results.length) return 'No tool calls executed.';
  return results
    .map((result, index) => {
      const status = result.error ? `error=${result.error}` : 'ok';
      const data = result.result ? JSON.stringify(result.result).slice(0, 1800) : '{}';
      return `${index + 1}. ${result.name} ${status}\nargs: ${JSON.stringify(result.args)}\nresult: ${data}`;
    })
    .join('\n\n');
}

async function runPlanner(params: {
  model: string;
  contextText: string;
  userMessage: string;
  toolResults: ToolExecutionResult[];
}): Promise<PlannerPayload> {
  const toolNames = TOOL_REGISTRY.filter((tool) => !tool.mutate).map((tool) => tool.name);
  const plannerSystemPrompt = [
    'You are BAT planner.',
    'Return strict JSON only. No markdown.',
    `Allowed read-only tools: ${toolNames.join(', ') || 'none'}.`,
    'Never call mutate tools.',
    'If no tools are required, return {"tool_calls":[]}.',
    'JSON schema:',
    '{"tool_calls":[{"name":"tool","args":{}}]}',
  ].join('\n');
  const plannerUserPrompt = [
    `Context:\n${params.contextText}`,
    `\nUser message:\n${params.userMessage}`,
    `\nPrevious tool results:\n${summarizeToolResults(params.toolResults)}`,
  ].join('\n');

  const plannerResponse = (await openai.chat.completions.create({
    model: params.model,
    messages: [
      { role: 'system', content: plannerSystemPrompt },
      { role: 'user', content: plannerUserPrompt },
    ],
    temperature: 0,
    max_tokens: Math.min(350, COST_PROTECTION.maxTokensPerCall),
  })) as OpenAI.Chat.Completions.ChatCompletion;

  if (plannerResponse.usage?.prompt_tokens && plannerResponse.usage?.completion_tokens) {
    costTracker.addUsage(params.model, plannerResponse.usage.prompt_tokens, plannerResponse.usage.completion_tokens);
  }

  const raw = plannerResponse.choices?.[0]?.message?.content || '';
  try {
    const value = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value.tool_calls)) return { tool_calls: [] };

    return {
      tool_calls: value.tool_calls
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          name: String(entry.name || ''),
          args: isRecord(entry.args) ? entry.args : {},
        }))
        .filter((entry) => entry.name),
    };
  } catch (error) {
    console.warn('[Chat Planner] Failed to parse planner JSON:', (error as Error).message);
    return { tool_calls: [] };
  }
}

async function executeReadOnlyTools(context: AgentContext, calls: PlannerToolCall[]): Promise<ToolExecutionResult[]> {
  if (!calls.length) return [];
  const startedAt = Date.now();
  const results: ToolExecutionResult[] = [];

  for (const call of calls) {
    if (Date.now() - startedAt > TOTAL_TOOL_TIMEOUT_MS) {
      results.push({
        name: call.name,
        args: call.args,
        error: `Tool budget exceeded (${TOTAL_TOOL_TIMEOUT_MS}ms).`,
      });
      break;
    }

    const tool = getTool(call.name);
    if (!tool) {
      results.push({ name: call.name, args: call.args, error: 'Unknown tool.' });
      continue;
    }
    if (tool.mutate) {
      results.push({ name: call.name, args: call.args, error: 'Mutation tools are disabled in planner mode.' });
      continue;
    }
    if (!validateArgsAgainstSchema(call.args, tool.argsSchema)) {
      results.push({ name: call.name, args: call.args, error: 'Tool args failed schema validation.' });
      continue;
    }

    try {
      const result = await withTimeout(tool.execute(context, call.args), TOOL_TIMEOUT_MS, `Tool ${tool.name}`);
      results.push({ name: call.name, args: call.args, result });
    } catch (error) {
      results.push({
        name: call.name,
        args: call.args,
        error: (error as Error).message || 'Tool execution failed.',
      });
    }
  }

  return results;
}

export async function buildAgentContext(
  researchJobId: string,
  sessionId: string,
  userMessage: string,
): Promise<{ agentContext: AgentContext; contextText: string }> {
  const chatRag = await buildChatRagContext(researchJobId, sessionId);
  const userContexts = await listUserContexts(researchJobId).catch(() => []);
  const appOrigin = process.env.APP_ORIGIN || process.env.FRONTEND_URL || 'https://brand-strategy-manager-frontend.vercel.app';

  const agentContext: AgentContext = {
    researchJobId,
    sessionId,
    userMessage,
    chatRag,
    userContexts: userContexts.map((item) => ({
      category: item.category,
      key: item.key,
      value: item.value,
      label: item.label,
      createdAt: item.createdAt.toISOString(),
      lastMentionedAt: item.updatedAt?.toISOString() || null,
    })),
    links: createAgentLinkHelpers(appOrigin, researchJobId),
    runtime: {
      nowIso: new Date().toISOString(),
      requestId: randomUUID(),
    },
  };

  return {
    agentContext,
    contextText: formatChatContextForLLM(chatRag),
  };
}

export async function runPlannerToolLoop(params: {
  plannerModel: string;
  contextText: string;
  userMessage: string;
  agentContext: AgentContext;
}): Promise<ToolExecutionResult[]> {
  const toolResults: ToolExecutionResult[] = [];
  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration += 1) {
    const planner = await runPlanner({
      model: params.plannerModel,
      contextText: params.contextText,
      userMessage: params.userMessage,
      toolResults,
    });
    console.info('[Chat Tool Loop] Planner iteration result', {
      researchJobId: params.agentContext.researchJobId,
      iteration: iteration + 1,
      toolCalls: planner.tool_calls.map((entry) => entry.name),
    });

    if (!planner.tool_calls.length) break;

    const execution = await executeReadOnlyTools(params.agentContext, planner.tool_calls.slice(0, 4));
    console.info('[Chat Tool Loop] Tool execution summary', {
      researchJobId: params.agentContext.researchJobId,
      iteration: iteration + 1,
      calls: execution.map((entry) => ({
        name: entry.name,
        error: entry.error || null,
      })),
    });
    if (!execution.length) break;
    toolResults.push(...execution);
  }
  return toolResults;
}

export function buildWriterUserPrompt(
  contextText: string,
  userMessage: string,
  toolResults: ToolExecutionResult[],
  baseBuilder: (context: string, message: string) => string,
): string {
  if (!toolResults.length) return baseBuilder(contextText, userMessage);
  return [
    baseBuilder(contextText, userMessage).trim(),
    '',
    'Tool results (ground truth):',
    summarizeToolResults(toolResults),
    '',
    'Use these tool results directly when providing links and evidence.',
  ].join('\n');
}
