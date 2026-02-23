'use client';

import { useMemo, useState } from 'react';
import type { ChoiceChipsBlock } from '../types';

interface ChoiceChipsBlockViewProps {
  block: ChoiceChipsBlock;
  onSelect?: (answer: string) => void;
}

export function ChoiceChipsBlockView({ block, onSelect }: ChoiceChipsBlockViewProps) {
  const multi = block.selectionMode === 'multiple';
  const [selected, setSelected] = useState<string[]>([]);
  const normalizedSelected = useMemo(() => new Set(selected), [selected]);

  function toggle(value: string) {
    if (!multi) {
      setSelected([value]);
      onSelect?.(value);
      return;
    }
    setSelected((prev) => {
      if (prev.includes(value)) return prev.filter((item) => item !== value);
      return [...prev, value];
    });
  }

  function submitMulti() {
    if (!selected.length) return;
    onSelect?.(selected.join(', '));
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">{block.prompt}</p>
      <div className="flex flex-wrap gap-2">
        {block.choices.map((choice) => {
          const isSelected = normalizedSelected.has(choice.label);
          return (
            <button
              key={choice.id}
              onClick={() => toggle(choice.label)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 bg-background/60 text-foreground hover:border-primary/40'
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {multi ? (
          <button
            onClick={submitMulti}
            className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
          >
            Use selected
          </button>
        ) : null}
        {block.allowSkip ? (
          <button
            onClick={() => onSelect?.('Skip this step')}
            className="rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground"
          >
            Skip
          </button>
        ) : null}
        {block.allowUnsure ? (
          <button
            onClick={() => onSelect?.('I am not sure yet')}
            className="rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground"
          >
            Not sure
          </button>
        ) : null}
      </div>
    </div>
  );
}

