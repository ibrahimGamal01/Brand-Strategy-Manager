import type { MetricCardsBlock } from '../types';

interface MetricCardsBlockViewProps {
  block: MetricCardsBlock;
}

export function MetricCardsBlockView({ block }: MetricCardsBlockViewProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {block.cards.map((card, index) => (
        <div key={`${block.blockId}-card-${index}`} className="rounded-lg border border-border/50 bg-card/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{card.label}</p>
          <p className="mt-1 text-lg font-semibold">{card.value}</p>
          {card.change ? (
            <p className="text-xs text-emerald-600">{card.change}</p>
          ) : null}
          {card.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

