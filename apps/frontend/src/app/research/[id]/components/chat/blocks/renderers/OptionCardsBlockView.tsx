'use client';

import { useState } from 'react';
import type { OptionCardsBlock } from '../types';

interface OptionCardsBlockViewProps {
  block: OptionCardsBlock;
  onSelect?: (answer: string) => void;
}

export function OptionCardsBlockView({ block, onSelect }: OptionCardsBlockViewProps) {
  const [selected, setSelected] = useState<string>('');
  const multi = block.selectionMode === 'multiple';
  const [multiSelected, setMultiSelected] = useState<string[]>([]);

  function choose(title: string) {
    if (!multi) {
      setSelected(title);
      onSelect?.(title);
      return;
    }
    setMultiSelected((prev) => (prev.includes(title) ? prev.filter((v) => v !== title) : [...prev, title]));
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/40 bg-card/60 p-5 shadow-sm">
      <p className="text-sm font-semibold tracking-tight text-foreground">{block.prompt}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {block.cards.map((card) => {
          const isSelected = multi ? multiSelected.includes(card.title) : selected === card.title;
          return (
            <button
              key={card.id}
              onClick={() => choose(card.title)}
              className={`group relative flex flex-col items-start rounded-xl border p-4 text-left transition-all duration-200 ${isSelected
                  ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/50'
                  : 'border-border/60 bg-background/50 hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:shadow-md'
                }`}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <p className={`text-[13px] font-semibold leading-tight ${isSelected ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'}`}>
                  {card.title}
                </p>
                {isSelected && (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white shadow-sm">
                    ✓
                  </span>
                )}
              </div>
              {card.summary ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground/90">{card.summary}</p> : null}
              {card.tags?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {card.tags.slice(0, 3).map((tag) => (
                    <span key={`${card.id}-${tag}`} className={`rounded bg-muted px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${isSelected ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
      {multi ? (
        <div className="flex justify-end pt-2">
          <button
            onClick={() => {
              if (!multiSelected.length) return;
              onSelect?.(multiSelected.join(', '));
            }}
            className="rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            disabled={multiSelected.length === 0}
          >
            Confirm Options ({multiSelected.length})
          </button>
        </div>
      ) : null}
    </div>
  );
}

