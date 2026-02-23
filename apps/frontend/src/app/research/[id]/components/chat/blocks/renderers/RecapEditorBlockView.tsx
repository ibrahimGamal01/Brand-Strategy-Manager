'use client';

import type { RecapEditorBlock } from '../types';

interface RecapEditorBlockViewProps {
  block: RecapEditorBlock;
  onSelect?: (answer: string) => void;
}

export function RecapEditorBlockView({ block, onSelect }: RecapEditorBlockViewProps) {
  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{block.title || 'Recap'}</p>
        {block.summary ? <p className="mt-1 text-xs text-muted-foreground">{block.summary}</p> : null}
      </div>
      <div className="space-y-2">
        {block.items.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-2"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className="text-sm text-foreground">{item.value}</p>
            </div>
            {item.editable ? (
              <button
                onClick={() => onSelect?.(`Edit ${item.label}`)}
                className="rounded-lg border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                Edit
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <button
        onClick={() => onSelect?.(block.ctaLabel || 'Generate draft')}
        className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
      >
        {block.ctaLabel || 'Generate draft'}
      </button>
    </div>
  );
}

