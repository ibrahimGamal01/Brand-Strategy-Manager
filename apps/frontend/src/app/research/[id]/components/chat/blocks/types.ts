export type BaseBlock = {
  type: string;
  blockId: string;
  title?: string;
};

export type TableBlock = BaseBlock & {
  type: 'table';
  caption?: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};

export type MetricCardsBlock = BaseBlock & {
  type: 'metric_cards';
  cards: Array<{
    label: string;
    value: string | number;
    change?: string;
    description?: string;
  }>;
};

export type InsightBlock = BaseBlock & {
  type: 'insight';
  title: string;
  body: string;
  severity?: 'low' | 'medium' | 'high';
};

export type PostGridBlock = BaseBlock & {
  type: 'post_grid';
  title?: string;
  postIds: string[];
};

export type ComparisonBlock = BaseBlock & {
  type: 'comparison';
  title?: string;
  left: { title?: string; items: string[] };
  right: { title?: string; items: string[] };
};

export type SourceListBlock = BaseBlock & {
  type: 'source_list';
  sources: Array<{ handle: string; note?: string }>;
};

export type ActionButtonsBlock = BaseBlock & {
  type: 'action_buttons';
  title?: string;
  buttons: Array<{
    label: string;
    sublabel?: string;
    href?: string;
    action?:
      | 'open_url'
      | 'open_module'
      | 'run_intel'
      | 'run_orchestrator'
      | 'run_intelligence'
      | 'run_orchestration'
      | 'run_scraper'
      | 'document_generate'
      | 'user_context_upsert'
      | 'user_context_delete'
      | 'mutation_apply'
      | 'mutation_undo'
      | 'intel_crud'
      | 'intel_create'
      | 'intel_read'
      | 'intel_update'
      | 'intel_delete'
      | 'intel_clear';
    intent?: 'primary' | 'secondary' | 'ghost';
    icon?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    payload?: Record<string, unknown>;
  }>;
};

export type TimelineBlock = BaseBlock & {
  type: 'timeline';
  steps: Array<{
    title: string;
    detail?: string;
    date?: string;
    status?: 'pending' | 'in_progress' | 'done';
  }>;
};

export type FunnelBlock = BaseBlock & {
  type: 'funnel';
  title?: string;
  stages: Array<{
    label: string;
    current: number;
    target?: number;
    conversionRate?: number;
  }>;
};

export type ChartBlock = BaseBlock & {
  type: 'chart';
  title?: string;
  variant?: 'bar' | 'spark';
  series: Array<{ label: string; value: number; color?: string }>;
  caption?: string;
};

export type PollBlock = BaseBlock & {
  type: 'poll';
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
};

export type ScoreboardBlock = BaseBlock & {
  type: 'scoreboard';
  rows: Array<{ label: string; score: number; maxScore?: number; note?: string; rank?: number }>;
};

export type MoodboardBlock = BaseBlock & {
  type: 'moodboard';
  palette: Array<{ hex: string; name?: string }>;
  fonts?: Array<{ name: string; style?: string }>;
  keywords?: string[];
  aesthetic?: string;
};

export type SwotBlock = BaseBlock & {
  type: 'swot';
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
};

export type BrandVoiceMeterBlock = BaseBlock & {
  type: 'brand_voice_meter';
  dimensions: Array<{ leftLabel: string; rightLabel: string; value: number; note?: string }>;
  summary?: string;
};

export type ProgressStepperBlock = BaseBlock & {
  type: 'progress_stepper';
  currentStep: number;
  totalSteps: number;
  phase?: string;
  status?: string;
};

export type GuidedQuestionCardBlock = BaseBlock & {
  type: 'guided_question_card';
  question: string;
  hint?: string;
  options: Array<{ id: string; label: string; description?: string }>;
  allowFreeText?: boolean;
};

export type ChoiceChipsBlock = BaseBlock & {
  type: 'choice_chips';
  prompt: string;
  selectionMode?: 'single' | 'multiple';
  choices: Array<{ id: string; label: string; description?: string }>;
  allowSkip?: boolean;
  allowUnsure?: boolean;
};

export type OptionCardsBlock = BaseBlock & {
  type: 'option_cards';
  prompt: string;
  selectionMode?: 'single' | 'multiple';
  cards: Array<{ id: string; title: string; summary?: string; tags?: string[] }>;
};

export type RecapEditorBlock = BaseBlock & {
  type: 'recap_editor';
  summary?: string;
  items: Array<{ key: string; label: string; value: string; editable?: boolean }>;
  ctaLabel?: string;
};

export type QuickReplyBarBlock = BaseBlock & {
  type: 'quick_reply_bar';
  suggestions: string[];
};

export type CompareModesBlock = BaseBlock & {
  type: 'compare_modes';
  modes: Array<{ id: string; title: string; summary: string; pros?: string[]; cons?: string[] }>;
};

export type ScenarioSimulatorBlock = BaseBlock & {
  type: 'scenario_simulator';
  scenarioPrompt?: string;
  scenarios: Array<{ id: string; label: string; impact: string; risk?: string }>;
};

export type ConstraintBuilderBlock = BaseBlock & {
  type: 'constraint_builder';
  prompt?: string;
  constraints: Array<{ id: string; label: string; description?: string; selected?: boolean }>;
  allowCustom?: boolean;
};

export type ExamplesGalleryBlock = BaseBlock & {
  type: 'examples_gallery';
  examples: Array<{ id: string; title: string; summary?: string; source?: string }>;
};

export type TradeoffMatrixBlock = BaseBlock & {
  type: 'tradeoff_matrix';
  criteria: string[];
  options: Array<{ id: string; label: string; scores: number[]; summary?: string }>;
};

export type DraftPreviewCardBlock = BaseBlock & {
  type: 'draft_preview_card';
  preview: string;
  checks?: string[];
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
};

export type ConfidenceCheckBlock = BaseBlock & {
  type: 'confidence_check';
  assumption: string;
  confidence: number;
  options?: string[];
};

export type ChatBlock =
  | TableBlock
  | MetricCardsBlock
  | InsightBlock
  | PostGridBlock
  | ComparisonBlock
  | SourceListBlock
  | ActionButtonsBlock
  | TimelineBlock
  | FunnelBlock
  | ChartBlock
  | PollBlock
  | ScoreboardBlock
  | MoodboardBlock
  | SwotBlock
  | BrandVoiceMeterBlock
  | ProgressStepperBlock
  | GuidedQuestionCardBlock
  | ChoiceChipsBlock
  | OptionCardsBlock
  | RecapEditorBlock
  | QuickReplyBarBlock
  | CompareModesBlock
  | ScenarioSimulatorBlock
  | ConstraintBuilderBlock
  | ExamplesGalleryBlock
  | TradeoffMatrixBlock
  | DraftPreviewCardBlock
  | ConfidenceCheckBlock
  | BaseBlock;

export type ChatDesignOption = {
  designId: string;
  label: string;
  blocks: ChatBlock[];
};
