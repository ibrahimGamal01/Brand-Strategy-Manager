import { openai, OpenAI } from '../openai-client';
import { COST_PROTECTION } from '../validation/cost-protection';
import { CHAT_BLOCKS_END, CHAT_BLOCKS_START, parseBlocksPayload, type ParsedBlocksPayload } from './chat-structured-payload';

type WriterCallbacks = {
  onDelta?: (delta: string) => void;
};

export async function runWriterStream(params: {
  task: 'workspace_chat_writer' | 'strategy_doc_chat';
  model?: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  callbacks?: WriterCallbacks;
}): Promise<{
  content: string;
  parsedPayload: ParsedBlocksPayload;
  modelUsed: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}> {
  const response = (await openai.bat.chatCompletion(params.task, {
    ...(params.model ? { model: params.model } : {}),
    messages: params.messages,
    temperature: 0.25,
    max_tokens: Math.min(900, COST_PROTECTION.maxTokensPerCall),
    stream: true,
    stream_options: { include_usage: true },
  })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

  let content = '';
  let blocksBuffer = '';
  let pending = '';
  let inBlocks = false;
  let modelUsed: string | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

  for await (const chunk of response) {
    if (!modelUsed && typeof chunk?.model === 'string' && chunk.model.trim()) {
      modelUsed = chunk.model.trim();
    }
    const delta = chunk?.choices?.[0]?.delta?.content || '';
    if (delta) {
      if (!inBlocks) {
        const combined = pending + delta;
        const startIndex = combined.indexOf(CHAT_BLOCKS_START);
        if (startIndex === -1) {
          const safeLength = Math.max(0, combined.length - CHAT_BLOCKS_START.length);
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
          const afterStart = combined.slice(startIndex + CHAT_BLOCKS_START.length);
          blocksBuffer += afterStart;
          pending = '';
          inBlocks = true;
        }
      } else {
        blocksBuffer += delta;
      }
    }
    if (chunk?.usage) usage = chunk.usage;
  }

  if (!inBlocks && pending) {
    content += pending;
    params.callbacks?.onDelta?.(pending);
  }

  let payload = blocksBuffer;
  const endIndex = payload.indexOf(CHAT_BLOCKS_END);
  if (endIndex !== -1) payload = payload.slice(0, endIndex);

  return { content, parsedPayload: parseBlocksPayload(payload), modelUsed, usage };
}
