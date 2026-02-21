import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ChatBlock } from './types';
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
};

interface BlockRendererProps {
  block: ChatBlock;
  isPinned?: boolean;
  onView?: (block: ChatBlock) => void;
  onPin?: (block: ChatBlock) => void;
  onUnpin?: (block: ChatBlock) => void;
  onAction?: (action?: string, href?: string) => void;
}

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

      {block.type === 'table' ? (
        <TableBlockView block={block} />
      ) : null}
      {block.type === 'metric_cards' ? (
        <MetricCardsBlockView block={block} />
      ) : null}
      {block.type === 'insight' ? <InsightBlockView block={block} /> : null}
      {block.type === 'post_grid' ? <PostGridBlockView block={block} /> : null}
      {block.type === 'comparison' ? <ComparisonBlockView block={block} /> : null}
      {block.type === 'source_list' ? <SourceListBlockView block={block} /> : null}
      {block.type === 'action_buttons' ? <ActionButtonsBlockView block={block} onAction={onAction} /> : null}
      {block.type === 'timeline' ? <TimelineBlockView block={block} /> : null}
      {block.type === 'funnel' ? <FunnelBlockView block={block} /> : null}
      {block.type === 'chart' ? <ChartBlockView block={block} /> : null}
      {!BLOCK_LABELS[block.type] ? (
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{JSON.stringify(block, null, 2)}</pre>
      ) : null}
    </div>
  );
}
