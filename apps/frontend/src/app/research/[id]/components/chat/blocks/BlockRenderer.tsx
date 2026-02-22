import { useEffect, useRef, useState } from 'react';
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
import { ClarificationBlockView } from './renderers/ClarificationBlockView';

// Type guards
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
// Inline type for ClarificationBlock
interface ClarificationBlock {
  type: 'clarification';
  blockId: string;
  question: string;
  options: string[];
  allowFreeText?: boolean;
}

const isClarificationBlock = (b: ChatBlock): b is ClarificationBlock & ChatBlock =>
  b.type === 'clarification';

interface BlockRendererProps {
  block: ChatBlock;
  isPinned?: boolean;
  onView?: (block: ChatBlock) => void;
  onPin?: (block: ChatBlock) => void;
  onUnpin?: (block: ChatBlock) => void;
  onAction?: (action?: string, href?: string) => void;
  onClarify?: (answer: string) => void;
}

export function BlockRenderer({ block, isPinned, onView, onPin, onUnpin, onAction, onClarify }: BlockRendererProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const viewedRef = useRef(false);
  const [, setHasViewed] = useState(false);

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

  // Source list: render inline, no card wrapping
  if (isSourceListBlock(block)) {
    return (
      <div ref={ref}>
        <SourceListBlockView block={block} />
      </div>
    );
  }

  // Clarification: render inline, no pin
  if (isClarificationBlock(block)) {
    return (
      <div ref={ref}>
        <ClarificationBlockView
          block={block as ClarificationBlock}
          onAnswer={(answer: string) => onClarify?.(answer)}
        />
      </div>
    );
  }

  // All other blocks: render with pin button overlay (no outer wrapper card)
  return (
    <div ref={ref} className="group relative">
      {/* Pin button - hover only */}
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
        {isPinned ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-amber-500 hover:text-amber-600"
            title="Unpin"
            onClick={() => onUnpin?.(block)}
          >
            📌
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground/40 hover:text-muted-foreground"
            title="Pin to saved"
            onClick={() => onPin?.(block)}
          >
            📌
          </Button>
        )}
      </div>

      {isTableBlock(block) && <TableBlockView block={block} />}
      {isMetricCardsBlock(block) && <MetricCardsBlockView block={block} />}
      {isInsightBlock(block) && <InsightBlockView block={block} />}
      {isPostGridBlock(block) && <PostGridBlockView block={block} />}
      {isComparisonBlock(block) && <ComparisonBlockView block={block} />}
      {isActionButtonsBlock(block) && <ActionButtonsBlockView block={block} onAction={onAction} />}
      {isTimelineBlock(block) && <TimelineBlockView block={block} />}
      {isFunnelBlock(block) && <FunnelBlockView block={block} />}
      {isChartBlock(block) && <ChartBlockView block={block} />}
      {isPollBlock(block) && <PollBlockView block={block} />}
      {isScoreboardBlock(block) && <ScoreboardBlockView block={block} />}
      {isMoodboardBlock(block) && <MoodboardBlockView block={block} />}
      {isSwotBlock(block) && <SwotBlockView block={block} />}
      {isBrandVoiceMeterBlock(block) && <BrandVoiceMeterBlockView block={block} />}

      {/* Unknown block type fallback */}
      {!isTableBlock(block) &&
        !isMetricCardsBlock(block) &&
        !isInsightBlock(block) &&
        !isPostGridBlock(block) &&
        !isComparisonBlock(block) &&
        !isActionButtonsBlock(block) &&
        !isTimelineBlock(block) &&
        !isFunnelBlock(block) &&
        !isChartBlock(block) &&
        !isPollBlock(block) &&
        !isScoreboardBlock(block) &&
        !isMoodboardBlock(block) &&
        !isSwotBlock(block) &&
        !isBrandVoiceMeterBlock(block) ? (
        <pre className="rounded border border-border/40 bg-muted/40 p-3 text-xs text-muted-foreground">
          {JSON.stringify(block, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
