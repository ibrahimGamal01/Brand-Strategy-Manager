import { openai, OpenAI } from '../openai-client';
import { COST_PROTECTION, costTracker, checkCostLimit } from '../validation/cost-protection';
import { buildChatRagContext, formatChatContextForLLM } from './chat-rag-context';
import { buildChatSystemPrompt, buildChatUserPrompt } from './chat-prompt';
import type { ChatBlock, ChatDesignOption } from '../../chat/chat-types';
import { normalizeChatComponentPayload } from './chat-component-policy';
import { resolveModelForTask } from '../model-router';

const BLOCKS_START = '<chat_blocks>';
const BLOCKS_END = '</chat_blocks>';

function wantsDesignOptions(userMessage: string): boolean {
  return /\b(design|layout|ui|ux|mockup|theme|visual|variant|option)\b/i.test(userMessage || '');
}

function stripStructuredPayload(raw: string): string {
  let text = raw;
  const start = text.indexOf(BLOCKS_START);
  if (start !== -1) {
    const end = text.indexOf(BLOCKS_END, start);
    const dropEnd = end !== -1 ? end + BLOCKS_END.length : text.length;
    text = text.slice(0, start) + text.slice(dropEnd);
  }
  text = text.replace(/```json[\s\S]*?```/gi, '');
  text = text.replace(/\{\s*"blocks"\s*:\s*\[\s*\]\s*,\s*"designOptions"\s*:\s*\[\s*\]\s*\}\s*$/is, '');
  return text.trim();
}

export type ChatGenerationResult = {
  content: string;
  blocks: ChatBlock[];
  designOptions: ChatDesignOption[];
  followUp: string[];
};

export type ChatStreamCallbacks = {
  onStart?: (messageId: string) => void;
  onDelta?: (delta: string) => void;
  onBlocks?: (blocks: ChatBlock[], designOptions: ChatDesignOption[]) => void;
  onDone?: () => void;
};

function parseBlocksPayload(raw: string): {
  blocks: ChatBlock[];
  designOptions: ChatDesignOption[];
  followUp: string[];
  componentPlan?: unknown;
} {
  if (!raw) return { blocks: [], designOptions: [], followUp: [] };
  const trimmed = raw.trim();
  if (!trimmed) return { blocks: [], designOptions: [], followUp: [] };
  try {
    const parsed = JSON.parse(trimmed);
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    const designOptions = Array.isArray(parsed?.designOptions) ? parsed.designOptions : [];
    const followUp = Array.isArray(parsed?.follow_up)
      ? (parsed.follow_up as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const componentPlan = parsed?.component_plan ?? parsed?.componentPlan;
    return { blocks, designOptions, followUp, componentPlan };
  } catch (error) {
    console.warn('[Chat Generator] Failed to parse blocks payload:', (error as Error).message);
    return { blocks: [], designOptions: [], followUp: [] };
  }
}


export async function streamChatCompletion(params: {
  researchJobId: string;
  sessionId: string;
  userMessage: string;
  callbacks?: ChatStreamCallbacks;
}): Promise<ChatGenerationResult> {
  const chatModel = resolveModelForTask('workspace_chat');
  const costCheck = checkCostLimit();
  if (!costCheck.allowed) {
    throw new Error(`Cost limit reached: ${costCheck.reason}`);
  }

  const chatContext = await buildChatRagContext(params.researchJobId, params.sessionId);
  const contextText = formatChatContextForLLM(chatContext);

  if (COST_PROTECTION.mockMode) {
    const normalized = normalizeChatComponentPayload({
      content: 'Pick a direction below and I will adapt the response.',
      blocks: [
        {
          type: 'guided_question_card',
          blockId: 'guided-mock',
          title: 'Choose next step',
          question: 'What do you want to produce first?',
          options: [
            { id: 'ideas', label: 'Content ideas' },
            { id: 'voice', label: 'Brand voice direction' },
            { id: 'calendar', label: '7-day content calendar' },
          ],
          allowFreeText: true,
        },
      ],
      designOptions: [],
      followUp: ['Compare options', 'Refine audience', 'Generate a draft preview'],
      userMessage: params.userMessage,
    });
    params.callbacks?.onDelta?.(normalized.content);
    params.callbacks?.onBlocks?.(normalized.blocks, normalized.designOptions);
    params.callbacks?.onDone?.();
    return normalized;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildChatSystemPrompt() },
    { role: 'user', content: buildChatUserPrompt(contextText, params.userMessage) },
  ];

  const response = (await openai.chat.completions.create({
    model: chatModel,
    messages,
    temperature: 0.25,
    max_tokens: Math.min(900, COST_PROTECTION.maxTokensPerCall),
    stream: true,
    stream_options: { include_usage: true },
  })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

  let content = '';
  let blocksBuffer = '';
  let pending = '';
  let inBlocks = false;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

  for await (const chunk of response) {
    const delta = chunk?.choices?.[0]?.delta?.content || '';
    if (delta) {
      if (!inBlocks) {
        const combined = pending + delta;
        const startIndex = combined.indexOf(BLOCKS_START);
        if (startIndex === -1) {
          const safeLength = Math.max(0, combined.length - BLOCKS_START.length);
          const safeText = combined.slice(0, safeLength);
          pending = combined.slice(safeLength);
          if (safeText) {
            content += safeText;
            params.callbacks?.onDelta?.(safeText);
          }
        } else {
          const before = combined.slice(0, startIndex);
          if (before) {
            content += before;
            params.callbacks?.onDelta?.(before);
          }
          const afterStart = combined.slice(startIndex + BLOCKS_START.length);
          blocksBuffer += afterStart;
          pending = '';
          inBlocks = true;
        }
      } else {
        blocksBuffer += delta;
      }
    }
    if (chunk?.usage) {
      usage = chunk.usage;
    }
  }

  if (!inBlocks && pending) {
    content += pending;
    params.callbacks?.onDelta?.(pending);
  }

  const cleanedContent = stripStructuredPayload(content);

  let payload = blocksBuffer;
  const endIndex = payload.indexOf(BLOCKS_END);
  if (endIndex !== -1) {
    payload = payload.slice(0, endIndex);
  }

  const parsedPayload = parseBlocksPayload(payload);
  const allowDesignOptions = wantsDesignOptions(params.userMessage);
  let finalBlocks = parsedPayload.blocks;
  let finalDesigns = allowDesignOptions ? parsedPayload.designOptions : [];
  let finalFollowUp = parsedPayload.followUp;
  let finalComponentPlan = parsedPayload.componentPlan;
  if (finalBlocks.length === 0) {
    const fenceMatch = content.match(/```json\s*({[\s\S]*?})\s*```/);
    if (fenceMatch) {
      try {
        const parsed = JSON.parse(fenceMatch[1]);
        finalBlocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
        finalDesigns = Array.isArray(parsed?.designOptions) ? parsed.designOptions : [];
        finalFollowUp = Array.isArray(parsed?.follow_up)
          ? parsed.follow_up.filter((entry: unknown): entry is string => typeof entry === 'string')
          : finalFollowUp;
        finalComponentPlan = parsed?.component_plan ?? parsed?.componentPlan;
      } catch {
        // ignore
      }
    }
  }
  const normalized = normalizeChatComponentPayload({
    content: cleanedContent.trim(),
    blocks: finalBlocks,
    designOptions: finalDesigns,
    followUp: finalFollowUp,
    componentPlan: finalComponentPlan,
    userMessage: params.userMessage,
  });
  params.callbacks?.onBlocks?.(normalized.blocks, normalized.designOptions);
  params.callbacks?.onDone?.();

  if (usage?.prompt_tokens && usage?.completion_tokens) {
    costTracker.addUsage(chatModel, usage.prompt_tokens, usage.completion_tokens);
  }

  return normalized;
}
