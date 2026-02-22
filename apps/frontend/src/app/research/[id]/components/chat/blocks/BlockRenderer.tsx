import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  ChatBlock,
  TableBlock,
  MetricCardsBlock,
  InsightBlock,
  PostGridBlock,
  ComparisonBlock,
  SourceListBlock,
  ActionButtonsBlock,
  TimelineBlock,
  FunnelBlock,
  ChartBlock,
  PollBlock,
  ScoreboardBlock,
  MoodboardBlock,
  SwotBlock,
  BrandVoiceMeterBlock,
} from './types';
import { TableBlockView } from './renderers/TableBlockView';
import { MetricCardsBlockView } from './renderers/MetricCardsBlockView';
import { InsightBlockView } from './renderers/InsightBlockView';
import { PostGridBlockView } from './renderers/PostGridBlockView';
import { ComparisonBlockView } from './renderers/ComparisonBlockView';
import { SourceListBlockView } from './renderers/SourceListBlockView';
import { ActionButtonsBlockView } from './renderers/ActionButtonsBlockView';
import { TimelineBlockView } from './renderers/TimelineBlockView';
import { FunnelBlockView } from './renderers/FunnelBlockView';
import { ChartBlockView } from './renderers/ChartBlockView';
import { PollBlockView } from './renderers/PollBlockView';
import { ScoreboardBlockView } from './renderers/ScoreboardBlockView';
import { MoodboardBlockView } from './renderers/MoodboardBlockView';
import { SwotBlockView } from './renderers/SwotBlockView';
import { BrandVoiceMeterBlockView } from './renderers/BrandVoiceMeterBlockView';

const BLOCK_LABELS: Record<string, string> = {
  table: 'Table',
  metric_cards: 'Metrics',
  insight: 'Insight',
  post_grid: 'Post Grid',
  comparison: 'Comparison',
  source_list: 'Sources',
  action_buttons: 'Actions',
  timeline: 'Timeline',
  funnel: 'Funnel',
  chart: 'Chart',
  poll: 'Poll',
  scoreboard: 'Scoreboard',
  moodboard: 'Moodboard',
  swot: 'SWOT',
  brand_voice_meter: 'Voice Meter',
};

interface BlockRendererProps {
  block: ChatBlock;
  isPinned?: boolean;
  onView?: (block: ChatBlock) => void;
  onPin?: (block: ChatBlock) => void;
  onUnpin?: (block: ChatBlock) => void;
  onAction?: (action?: string, href?: string) => void;
}

// Type guards to keep TS happy even with the catch-all BaseBlock in the union
const isTableBlock = (b: ChatBlock): b is TableBlock => b.type === 'table';
const isMetricCardsBlock = (b: ChatBlock): b is MetricCardsBlock => b.type === 'metric_cards';
const isInsightBlock = (b: ChatBlock): b is InsightBlock => b.type === 'insight';
const isPostGridBlock = (b: ChatBlock): b is PostGridBlock => b.type === 'post_grid';
const isComparisonBlock = (b: ChatBlock): b is ComparisonBlock => b.type === 'comparison';
const isSourceListBlock = (b: ChatBlock): b is SourceListBlock => b.type === 'source_list';
const isActionButtonsBlock = (b: ChatBlock): b is ActionButtonsBlock => b.type === 'action_buttons';
const isTimelineBlock = (b: ChatBlock): b is TimelineBlock => b.type === 'timeline';
const isFunnelBlock = (b: ChatBlock): b is FunnelBlock => b.type === 'funnel';
const isChartBlock = (b: ChatBlock): b is ChartBlock => b.type === 'chart';
const isPollBlock = (b: ChatBlock): b is PollBlock => b.type === 'poll';
const isScoreboardBlock = (b: ChatBlock): b is ScoreboardBlock => b.type === 'scoreboard';
const isMoodboardBlock = (b: ChatBlock): b is MoodboardBlock => b.type === 'moodboard';
const isSwotBlock = (b: ChatBlock): b is SwotBlock => b.type === 'swot';
const isBrandVoiceMeterBlock = (b: ChatBlock): b is BrandVoiceMeterBlock => b.type === 'brand_voice_meter';

export function BlockRenderer({ block, isPinned, onView, onPin, onUnpin, onAction }: BlockRendererProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const viewedRef = useRef(false);
  const [hasViewed, setHasViewed] = useState(false);

  useEffect(() => {
    if (!ref.current || viewedRef.current || !onView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !viewedRef.current) {
            viewedRef.current = true;
            setHasViewed(true);
            onView(block);
          }
        });
      },
      { threshold: 0.35 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [block, onView]);

  const label = BLOCK_LABELS[block.type] || 'Block';

  return (
    <div ref={ref} className="rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] uppercase">
            {label}
          </Badge>
          {hasViewed ? (
            <Badge variant="secondary" className="text-[10px] uppercase">
              viewed
            </Badge>
          ) : null}
          {block.title ? <span className="text-xs font-medium">{block.title}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {isPinned ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onUnpin?.(block)}>
              Unpin
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onPin?.(block)}>
              Pin
            </Button>
          )}
        </div>
      </div>

      {isTableBlock(block) ? <TableBlockView block={block} /> : null}
      {isMetricCardsBlock(block) ? <MetricCardsBlockView block={block} /> : null}
      {isInsightBlock(block) ? <InsightBlockView block={block} /> : null}
      {isPostGridBlock(block) ? <PostGridBlockView block={block} /> : null}
      {isComparisonBlock(block) ? <ComparisonBlockView block={block} /> : null}
      {isSourceListBlock(block) ? <SourceListBlockView block={block} /> : null}
      {isActionButtonsBlock(block) ? <ActionButtonsBlockView block={block} onAction={onAction} /> : null}
      {isTimelineBlock(block) ? <TimelineBlockView block={block} /> : null}
      {isFunnelBlock(block) ? <FunnelBlockView block={block} /> : null}
      {isChartBlock(block) ? <ChartBlockView block={block} /> : null}
      {isPollBlock(block) ? <PollBlockView block={block} /> : null}
      {isScoreboardBlock(block) ? <ScoreboardBlockView block={block} /> : null}
      {isMoodboardBlock(block) ? <MoodboardBlockView block={block} /> : null}
      {isSwotBlock(block) ? <SwotBlockView block={block} /> : null}
      {isBrandVoiceMeterBlock(block) ? <BrandVoiceMeterBlockView block={block} /> : null}
      {!BLOCK_LABELS[block.type] ? (
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{JSON.stringify(block, null, 2)}</pre>
      ) : null}
    </div>
  );
}
