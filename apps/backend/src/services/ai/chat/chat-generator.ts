import { openai, OpenAI } from '../openai-client';
import { COST_PROTECTION, costTracker, checkCostLimit } from '../validation/cost-protection';
import { buildChatRagContext, formatChatContextForLLM } from './chat-rag-context';
import { buildChatSystemPrompt, buildChatUserPrompt } from './chat-prompt';
import type { ChatBlock, ChatDesignOption } from '../../chat/chat-types';

const CHAT_MODEL = process.env.WORKSPACE_CHAT_MODEL || 'gpt-4o-mini';
const BLOCKS_START = '<chat_blocks>';
const BLOCKS_END = '</chat_blocks>';

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
};

export type ChatStreamCallbacks = {
  onStart?: (messageId: string) => void;
  onDelta?: (delta: string) => void;
  onBlocks?: (blocks: ChatBlock[], designOptions: ChatDesignOption[]) => void;
  onDone?: () => void;
};

function parseBlocksPayload(raw: string): { blocks: ChatBlock[]; designOptions: ChatDesignOption[] } {
  if (!raw) return { blocks: [], designOptions: [] };
  const trimmed = raw.trim();
  if (!trimmed) return { blocks: [], designOptions: [] };
  try {
    const parsed = JSON.parse(trimmed);
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    const designOptions = Array.isArray(parsed?.designOptions) ? parsed.designOptions : [];
    return { blocks, designOptions };
  } catch (error) {
    console.warn('[Chat Generator] Failed to parse blocks payload:', (error as Error).message);
    return { blocks: [], designOptions: [] };
  }
}

export async function streamChatCompletion(params: {
  researchJobId: string;
  sessionId: string;
  userMessage: string;
  callbacks?: ChatStreamCallbacks;
}): Promise<ChatGenerationResult> {
  const costCheck = checkCostLimit();
  if (!costCheck.allowed) {
    throw new Error(`Cost limit reached: ${costCheck.reason}`);
  }

  const chatContext = await buildChatRagContext(params.researchJobId, params.sessionId);
  const contextText = formatChatContextForLLM(chatContext);

  if (COST_PROTECTION.mockMode) {
    const content = 'AI fallback mode is enabled. Add a valid OpenAI key to enable full chat responses.';
    const mockBlocks: ChatBlock[] = [
      {
        type: 'source_list',
        blockId: 'sources-fallback',
        sources: [{ handle: 'brain_profile', note: 'Fallback mode active' }],
      },
    ];
    params.callbacks?.onDelta?.(content);
    params.callbacks?.onBlocks?.(mockBlocks, []);
    params.callbacks?.onDone?.();
    return { content, blocks: mockBlocks, designOptions: [] };
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildChatSystemPrompt() },
    { role: 'user', content: buildChatUserPrompt(contextText, params.userMessage) },
  ];

  const response = (await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    temperature: 0.4,
    max_tokens: Math.min(1500, COST_PROTECTION.maxTokensPerCall),
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

  const { blocks, designOptions } = parseBlocksPayload(payload);
  // Fallback: if no blocks parsed but JSON code fence exists in content, try to parse it.
  let finalBlocks = blocks;
  let finalDesigns = designOptions;
  if (finalBlocks.length === 0) {
    const fenceMatch = content.match(/```json\\s*({[\\s\\S]*?})\\s*```/);
    if (fenceMatch) {
      try {
        const parsed = JSON.parse(fenceMatch[1]);
        finalBlocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
        finalDesigns = Array.isArray(parsed?.designOptions) ? parsed.designOptions : [];
      } catch {
        // ignore
      }
    }
  }
  // If still empty, provide a minimal insight block as a safety net.
  if (finalBlocks.length === 0 && content.trim()) {
    finalBlocks = [
      {
        type: 'insight',
        blockId: 'auto-insight',
        title: 'Key points',
        body: content.slice(0, 280),
      },
    ];
  }
  params.callbacks?.onBlocks?.(blocks, designOptions);
  params.callbacks?.onDone?.();

  if (usage?.prompt_tokens && usage?.completion_tokens) {
    costTracker.addUsage(CHAT_MODEL, usage.prompt_tokens, usage.completion_tokens);
  }

  return { content: cleanedContent.trim(), blocks: finalBlocks, designOptions: finalDesigns };
}
