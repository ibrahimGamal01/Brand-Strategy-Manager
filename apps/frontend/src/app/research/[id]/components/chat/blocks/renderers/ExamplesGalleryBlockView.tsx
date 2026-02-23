'use client';

import type { ExamplesGalleryBlock } from '../types';

interface ExamplesGalleryBlockViewProps {
  block: ExamplesGalleryBlock;
  onSelect?: (answer: string) => void;
}

export function ExamplesGalleryBlockView({ block, onSelect }: ExamplesGalleryBlockViewProps) {
  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">{block.title || 'Examples'}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {block.examples.map((example) => (
          <button
            key={example.id}
            onClick={() => onSelect?.(`Use example: ${example.title}`)}
            className="rounded-lg border border-border/60 bg-background/70 p-3 text-left hover:border-primary/40"
          >
            <p className="text-sm font-semibold text-foreground">{example.title}</p>
            {example.summary ? <p className="mt-1 text-xs text-muted-foreground">{example.summary}</p> : null}
            {example.source ? <p className="mt-1 text-[11px] text-muted-foreground">Source: {example.source}</p> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

