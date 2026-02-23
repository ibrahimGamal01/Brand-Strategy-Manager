import type { ChatBlock } from '../../../chat/chat-types';
import { INTERACTIVE_BLOCK_TYPES, KNOWN_BLOCK_TYPES } from './types';
import type { NormalizePayloadInput, NormalizePayloadResult } from './types';
import { sanitizeFollowUp } from './follow-up';
import {
  ensureBlockPresence,
  ensureSourceList,
  normalizeBlocks,
  normalizeDesignOptions,
  parseComponentPlan,
} from './normalizers';
import {
  buildComponentBlock,
  createActionButtonsFromPlan,
  createGuidedQuestionBlock,
  createProgressBlock,
  createQuickReplyBlock,
  enforceNarrativeContent,
  hasInteractiveBlock,
} from './builders';
import { ensureCrudActionBlock } from './crud-intent';

const MAX_BLOCKS = 6;
const SOURCE_LIST_TYPE = 'source_list';

function pruneBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const seen = new Set<string>();
  const deduped: ChatBlock[] = [];
  for (const block of blocks) {
    const type = String(block.type || '').toLowerCase();
    const key = `${type}:${String(block.blockId || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(block);
  }

  const sourceList = deduped.find((block) => String(block.type || '').toLowerCase() === SOURCE_LIST_TYPE) || null;
  const withoutSource = deduped.filter((block) => String(block.type || '').toLowerCase() !== SOURCE_LIST_TYPE);
  const capped = withoutSource.slice(0, Math.max(1, MAX_BLOCKS - (sourceList ? 1 : 0)));
  return sourceList ? [...capped, sourceList] : capped;
}

export function normalizeChatComponentPayload(input: NormalizePayloadInput): NormalizePayloadResult {
  const followUp = sanitizeFollowUp(input.followUp || [], input.userMessage);
  const componentPlan = parseComponentPlan(input.componentPlan);
  let blocks = normalizeBlocks(input.blocks || []);
  blocks = ensureCrudActionBlock(blocks, input.userMessage);
  const plannedActionButtons = createActionButtonsFromPlan(componentPlan);
  if (plannedActionButtons) {
    blocks = ensureBlockPresence(blocks, 'action_buttons', () => plannedActionButtons);
  }

  if (!blocks.some((block) => String(block.type || '').toLowerCase() === 'progress_stepper')) {
    blocks = [createProgressBlock(componentPlan), ...blocks];
  }

  const primary = componentPlan?.primary_component;
  if (primary && KNOWN_BLOCK_TYPES.has(primary) && INTERACTIVE_BLOCK_TYPES.has(primary)) {
    blocks = ensureBlockPresence(blocks, primary, () => {
      return buildComponentBlock(primary, componentPlan, followUp) || createGuidedQuestionBlock(componentPlan, followUp);
    });
  }

  const optional = (componentPlan?.optional_components || []).slice(0, 2);
  for (const component of optional) {
    if (!INTERACTIVE_BLOCK_TYPES.has(component)) continue;
    blocks = ensureBlockPresence(blocks, component, () => {
      return buildComponentBlock(component, componentPlan, followUp) || createQuickReplyBlock(followUp);
    });
  }

  if (!hasInteractiveBlock(blocks)) {
    blocks = ensureBlockPresence(blocks, 'guided_question_card', () => createGuidedQuestionBlock(componentPlan, followUp));
  }

  blocks = ensureBlockPresence(blocks, 'quick_reply_bar', () => createQuickReplyBlock(followUp));
  blocks = ensureSourceList(blocks);
  blocks = normalizeBlocks(blocks);
  blocks = pruneBlocks(blocks);

  const designOptions = normalizeDesignOptions(input.designOptions || []);
  const content = enforceNarrativeContent(input.content, hasInteractiveBlock(blocks));

  return { content, blocks: blocks as ChatBlock[], designOptions, followUp };
}
