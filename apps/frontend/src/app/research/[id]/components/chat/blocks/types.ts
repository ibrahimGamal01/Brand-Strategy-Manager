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
    action?: 'open_url' | 'open_module' | 'run_intel' | 'run_orchestrator';
    intent?: 'primary' | 'secondary' | 'ghost';
    icon?: string;
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
  | BaseBlock;

export type ChatDesignOption = {
  designId: string;
  label: string;
  blocks: ChatBlock[];
};
