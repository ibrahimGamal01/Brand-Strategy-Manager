import type { ChatBlock, ChatDesignOption } from '../../chat/chat-types';

export const CHAT_BLOCKS_START = '<chat_blocks>';
export const CHAT_BLOCKS_END = '</chat_blocks>';

export type ParsedBlocksPayload = {
  blocks: ChatBlock[];
  designOptions: ChatDesignOption[];
  followUp: string[];
  componentPlan?: unknown;
};

export function wantsDesignOptions(userMessage: string): boolean {
  return /\b(design|layout|ui|ux|mockup|theme|visual|variant|option)\b/i.test(userMessage || '');
}

export function stripStructuredPayload(raw: string): string {
  let text = raw;
  const start = text.indexOf(CHAT_BLOCKS_START);
  if (start !== -1) {
    const end = text.indexOf(CHAT_BLOCKS_END, start);
    const dropEnd = end !== -1 ? end + CHAT_BLOCKS_END.length : text.length;
    text = text.slice(0, start) + text.slice(dropEnd);
  }
  text = text.replace(/```json[\s\S]*?```/gi, '');
  text = text.replace(/\{\s*"blocks"\s*:\s*\[\s*\]\s*,\s*"designOptions"\s*:\s*\[\s*\]\s*\}\s*$/is, '');
  return text.trim();
}

export function parseBlocksPayload(raw: string): ParsedBlocksPayload {
  if (!raw) return { blocks: [], designOptions: [], followUp: [] };
  const trimmed = raw.trim();
  if (!trimmed) return { blocks: [], designOptions: [], followUp: [] };

  try {
    const parsed = JSON.parse(trimmed);
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    const designOptions = Array.isArray(parsed?.designOptions) ? parsed.designOptions : [];
    const followUp = Array.isArray(parsed?.follow_up)
      ? (parsed.follow_up as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : [];
    const componentPlan = parsed?.component_plan ?? parsed?.componentPlan;
    return { blocks, designOptions, followUp, componentPlan };
  } catch (error) {
    console.warn('[Chat Generator] Failed to parse blocks payload:', (error as Error).message);
    return { blocks: [], designOptions: [], followUp: [] };
  }
}

export function parseFallbackJsonFromNarrative(rawContent: string, base: ParsedBlocksPayload): ParsedBlocksPayload {
  const fenceMatch = rawContent.match(/```json\s*({[\s\S]*?})\s*```/);
  if (!fenceMatch) return base;
  try {
    const parsed = JSON.parse(fenceMatch[1]);
    return {
      blocks: Array.isArray(parsed?.blocks) ? parsed.blocks : base.blocks,
      designOptions: Array.isArray(parsed?.designOptions) ? parsed.designOptions : base.designOptions,
      followUp: Array.isArray(parsed?.follow_up)
        ? parsed.follow_up.filter((entry: unknown): entry is string => typeof entry === 'string')
        : base.followUp,
      componentPlan: parsed?.component_plan ?? parsed?.componentPlan ?? base.componentPlan,
    };
  } catch {
    return base;
  }
}
