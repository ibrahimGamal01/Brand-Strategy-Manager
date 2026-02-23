import type { ChatBlock, ChatDesignOption } from '../../../chat/chat-types';

export type ChatComponentPlan = {
  intent?: string;
  step?: number | { current?: number; total?: number; label?: string; status?: string };
  totalSteps?: number;
  primary_component?: string;
  optional_components?: string[];
  confidence?: number;
  props?: Record<string, unknown>;
  actions?: Array<{
    id?: string;
    label?: string;
    value?: string;
    description?: string;
    action?: string;
    href?: string;
    payload?: Record<string, unknown>;
  }>;
};

export type NormalizePayloadInput = {
  content: string;
  blocks: ChatBlock[];
  designOptions: ChatDesignOption[];
  followUp: string[];
  componentPlan?: unknown;
  userMessage: string;
};

export type NormalizePayloadResult = {
  content: string;
  blocks: ChatBlock[];
  designOptions: ChatDesignOption[];
  followUp: string[];
};

export const KNOWN_BLOCK_TYPES = new Set([
  'table',
  'metric_cards',
  'insight',
  'post_grid',
  'comparison',
  'source_list',
  'action_buttons',
  'timeline',
  'funnel',
  'chart',
  'poll',
  'scoreboard',
  'moodboard',
  'swot',
  'brand_voice_meter',
  'clarification',
  'progress_stepper',
  'guided_question_card',
  'choice_chips',
  'option_cards',
  'recap_editor',
  'quick_reply_bar',
  'compare_modes',
  'scenario_simulator',
  'constraint_builder',
  'examples_gallery',
  'tradeoff_matrix',
  'draft_preview_card',
  'confidence_check',
]);

export const INTERACTIVE_BLOCK_TYPES = new Set([
  'poll',
  'action_buttons',
  'clarification',
  'guided_question_card',
  'choice_chips',
  'option_cards',
  'recap_editor',
  'quick_reply_bar',
  'compare_modes',
  'scenario_simulator',
  'constraint_builder',
  'examples_gallery',
  'tradeoff_matrix',
  'draft_preview_card',
  'confidence_check',
]);

export const COMPONENT_ALIASES: Record<string, string> = {
  guidedquestioncard: 'guided_question_card',
  guided_question_card: 'guided_question_card',
  clarification: 'guided_question_card',
  choicechips: 'choice_chips',
  choice_chips: 'choice_chips',
  optioncards: 'option_cards',
  option_cards: 'option_cards',
  recapeditor: 'recap_editor',
  recap_editor: 'recap_editor',
  quickreplybar: 'quick_reply_bar',
  quick_reply_bar: 'quick_reply_bar',
  progressstepper: 'progress_stepper',
  progress_stepper: 'progress_stepper',
  comparemodes: 'compare_modes',
  compare_modes: 'compare_modes',
  scenariosimulator: 'scenario_simulator',
  scenario_simulator: 'scenario_simulator',
  constraintbuilder: 'constraint_builder',
  constraint_builder: 'constraint_builder',
  examplesgallery: 'examples_gallery',
  examples_gallery: 'examples_gallery',
  tradeoffmatrix: 'tradeoff_matrix',
  tradeoff_matrix: 'tradeoff_matrix',
  draftpreviewcard: 'draft_preview_card',
  draft_preview_card: 'draft_preview_card',
  confidencecheck: 'confidence_check',
  confidence_check: 'confidence_check',
  comparison: 'comparison',
  poll: 'poll',
  action_buttons: 'action_buttons',
};
