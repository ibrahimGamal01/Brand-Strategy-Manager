'use client';

import type { CompareModesBlock } from '../types';

interface CompareModesBlockViewProps {
  block: CompareModesBlock;
  onSelect?: (answer: string) => void;
}

export function CompareModesBlockView({ block, onSelect }: CompareModesBlockViewProps) {
  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-4">
      {block.title ? <p className="text-sm font-semibold text-foreground">{block.title}</p> : null}
      <div className="grid gap-2 md:grid-cols-3">
        {block.modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onSelect?.(`Choose mode: ${mode.title}`)}
            className="rounded-lg border border-border/60 bg-background/70 p-3 text-left hover:border-primary/40"
          >
            <p className="text-sm font-semibold text-foreground">{mode.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{mode.summary}</p>
            {mode.pros?.length ? (
              <p className="mt-2 text-[11px] text-emerald-600">Pro: {mode.pros[0]}</p>
            ) : null}
            {mode.cons?.length ? (
              <p className="text-[11px] text-amber-600">Con: {mode.cons[0]}</p>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

