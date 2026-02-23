import { OpenAI } from '../openai-client';
import { COST_PROTECTION, costTracker, checkCostLimit } from '../validation/cost-protection';
import { buildChatSystemPrompt, buildChatUserPrompt } from './chat-prompt';
import type { ChatBlock, ChatDesignOption } from '../../chat/chat-types';
import { normalizeChatComponentPayload } from './chat-component-policy';
import { resolveModelForTask } from '../model-router';
import {
  parseFallbackJsonFromNarrative,
  stripStructuredPayload,
  wantsDesignOptions,
} from './chat-structured-payload';
import { runWriterStream } from './chat-writer-stream';
import {
  buildAgentContext,
  buildWriterUserPrompt,
  runPlannerToolLoop,
} from './chat-tool-runtime';

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

export async function streamChatCompletion(params: {
  researchJobId: string;
  sessionId: string;
  userMessage: string;
  callbacks?: ChatStreamCallbacks;
}): Promise<ChatGenerationResult> {
  const plannerModel = resolveModelForTask('workspace_chat_planner');
  const writerModel = resolveModelForTask('workspace_chat_writer');
  const validatorModel = resolveModelForTask('workspace_chat_validator');

  console.info('[Chat Generator] Model routing', {
    researchJobId: params.researchJobId,
    plannerModel,
    writerModel,
    validatorModel,
  });

  const costCheck = checkCostLimit();
  if (!costCheck.allowed) {
    throw new Error(`Cost limit reached: ${costCheck.reason}`);
  }

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

  const { agentContext, contextText } = await buildAgentContext(
    params.researchJobId,
    params.sessionId,
    params.userMessage,
  );

  let toolResults: Awaited<ReturnType<typeof runPlannerToolLoop>> = [];
  try {
    toolResults = await runPlannerToolLoop({
      contextText,
      userMessage: params.userMessage,
      agentContext,
    });
  } catch (error) {
    // Safe fallback keeps chat operational even if planner/tools fail.
    console.warn(
      '[Chat Generator] Planner/tool loop failed, falling back to writer-only mode:',
      (error as Error).message,
    );
  }

  const writerMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildChatSystemPrompt() },
    {
      role: 'user',
      content: buildWriterUserPrompt(
        contextText,
        params.userMessage,
        toolResults,
        buildChatUserPrompt,
      ),
    },
  ];

  const writerOutput = await runWriterStream({
    task: 'workspace_chat_writer',
    model: writerModel,
    messages: writerMessages,
    callbacks: params.callbacks,
  });

  const rawContent = writerOutput.content;
  const cleanedContent = stripStructuredPayload(rawContent);
  let parsedPayload = writerOutput.parsedPayload;

  if (parsedPayload.blocks.length === 0) {
    parsedPayload = parseFallbackJsonFromNarrative(rawContent, parsedPayload);
  }

  const normalized = normalizeChatComponentPayload({
    content: cleanedContent.trim(),
    blocks: parsedPayload.blocks,
    designOptions: wantsDesignOptions(params.userMessage) ? parsedPayload.designOptions : [],
    followUp: parsedPayload.followUp,
    componentPlan: parsedPayload.componentPlan,
    userMessage: params.userMessage,
  });

  params.callbacks?.onBlocks?.(normalized.blocks, normalized.designOptions);
  params.callbacks?.onDone?.();

  if (writerOutput.usage?.prompt_tokens && writerOutput.usage?.completion_tokens) {
    costTracker.addUsage(
      writerOutput.modelUsed || writerModel,
      writerOutput.usage.prompt_tokens,
      writerOutput.usage.completion_tokens,
    );
  }

  return normalized;
}
