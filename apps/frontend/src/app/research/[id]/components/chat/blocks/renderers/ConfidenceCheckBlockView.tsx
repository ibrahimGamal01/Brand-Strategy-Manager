'use client';

import type { ConfidenceCheckBlock } from '../types';

interface ConfidenceCheckBlockViewProps {
  block: ConfidenceCheckBlock;
  onSelect?: (answer: string) => void;
}

export function ConfidenceCheckBlockView({ block, onSelect }: ConfidenceCheckBlockViewProps) {
  const score = Math.max(0, Math.min(1, Number(block.confidence || 0)));
  const percentage = Math.round(score * 100);

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">{block.title || 'Confidence check'}</p>
      <p className="text-xs text-muted-foreground">{block.assumption}</p>
      <div className="h-2 w-full rounded-full bg-border/40">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">Confidence: {percentage}%</p>
      {block.options?.length ? (
        <div className="flex flex-wrap gap-2">
          {block.options.slice(0, 3).map((option) => (
            <button
              key={option}
              onClick={() => onSelect?.(option)}
              className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs text-foreground hover:border-primary/40"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

