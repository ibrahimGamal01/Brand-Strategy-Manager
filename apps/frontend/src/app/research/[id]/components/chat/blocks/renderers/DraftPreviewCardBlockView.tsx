'use client';

import type { DraftPreviewCardBlock } from '../types';

interface DraftPreviewCardBlockViewProps {
  block: DraftPreviewCardBlock;
  onSelect?: (answer: string) => void;
}

export function DraftPreviewCardBlockView({ block, onSelect }: DraftPreviewCardBlockViewProps) {
  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">{block.title || 'Draft preview'}</p>
      <p className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-foreground">{block.preview}</p>
      {block.checks?.length ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {block.checks.map((check) => (
            <p key={check}>- {check}</p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSelect?.(block.primaryActionLabel || 'Generate now')}
          className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
        >
          {block.primaryActionLabel || 'Generate now'}
        </button>
        {block.secondaryActionLabel ? (
          <button
            onClick={() => onSelect?.(block.secondaryActionLabel || 'Edit recap')}
            className="rounded-lg border border-border/60 bg-background/70 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground"
          >
            {block.secondaryActionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

