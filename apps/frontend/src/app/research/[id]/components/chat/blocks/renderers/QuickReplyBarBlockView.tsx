'use client';

import type { QuickReplyBarBlock } from '../types';

interface QuickReplyBarBlockViewProps {
  block: QuickReplyBarBlock;
  onSelect?: (answer: string) => void;
}

export function QuickReplyBarBlockView({ block, onSelect }: QuickReplyBarBlockViewProps) {
  if (!block.suggestions?.length) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-gradient-to-r from-background via-background to-primary/5 p-4">
      {block.title ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{block.title}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {block.suggestions.slice(0, 4).map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSelect?.(suggestion)}
            className="rounded-full border border-border/60 bg-card px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
