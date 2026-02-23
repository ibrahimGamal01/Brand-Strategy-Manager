import assert from 'node:assert/strict';
import { normalizeChatComponentPayload } from '../services/ai/chat/chat-component-policy';

function hasType(blocks: Array<{ type?: string }>, type: string): boolean {
  return blocks.some((block) => String(block.type || '').toLowerCase() === type);
}

function testCreatesInteractiveFallback() {
  const result = normalizeChatComponentPayload({
    content:
      'This is a very long narrative response that should be reduced to a compact sentence so users focus on interactive components and not a huge wall of prose that slows decision making.',
    blocks: [],
    designOptions: [],
    followUp: [],
    userMessage: 'I need content ideas',
  });

  assert.ok(result.content.length <= 260, 'Narrative should be compact');
  assert.ok(hasType(result.blocks, 'progress_stepper'), 'Should include progress stepper');
  assert.ok(hasType(result.blocks, 'guided_question_card'), 'Should include guided question card fallback');
  assert.ok(hasType(result.blocks, 'quick_reply_bar'), 'Should include quick reply bar');
  assert.ok(hasType(result.blocks, 'source_list'), 'Should include source list');
  assert.ok(result.followUp.length >= 2, 'Should generate follow up suggestions');
}

function testAppliesComponentPlan() {
  const result = normalizeChatComponentPayload({
    content: '',
    blocks: [],
    designOptions: [],
    followUp: ['Compare options', 'Generate preview'],
    componentPlan: {
      intent: 'content_ideas',
      step: { current: 2, total: 5, label: 'audience' },
      primary_component: 'option_cards',
      optional_components: ['compare_modes', 'constraint_builder'],
      confidence: 0.8,
    },
    userMessage: 'Help me choose direction',
  });

  assert.ok(hasType(result.blocks, 'option_cards'), 'Primary component should be present');
  assert.ok(hasType(result.blocks, 'compare_modes'), 'Optional compare component should be present');
  assert.ok(hasType(result.blocks, 'constraint_builder'), 'Optional constraint component should be present');
}

function testSanitizesUnknownBlocks() {
  const result = normalizeChatComponentPayload({
    content: '',
    blocks: [
      { type: 'unknown_widget', blockId: 'u1' } as any,
      { type: 'choice_chips', blockId: 'c1', prompt: 'Pick', choices: [{ id: '1', label: 'One' }] } as any,
    ],
    designOptions: [],
    followUp: ['A', 'A', 'B', 'C', 'D'],
    userMessage: 'test',
  });

  assert.equal(hasType(result.blocks, 'unknown_widget'), false, 'Unknown widgets should be removed');
  assert.ok(hasType(result.blocks, 'choice_chips'), 'Known block should remain');
  assert.equal(result.followUp.length, 3, 'Follow up should be capped to 3');
}

function run() {
  testCreatesInteractiveFallback();
  testAppliesComponentPlan();
  testSanitizesUnknownBlocks();
  // eslint-disable-next-line no-console
  console.log('chat-component-policy tests passed');
}

run();

