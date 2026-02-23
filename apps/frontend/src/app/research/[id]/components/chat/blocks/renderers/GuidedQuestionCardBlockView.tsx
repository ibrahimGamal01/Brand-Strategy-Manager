'use client';

import { useState } from 'react';
import type { GuidedQuestionCardBlock } from '../types';

interface GuidedQuestionCardBlockViewProps {
  block: GuidedQuestionCardBlock;
  onSelect?: (answer: string) => void;
}

export function GuidedQuestionCardBlockView({ block, onSelect }: GuidedQuestionCardBlockViewProps) {
  const [selected, setSelected] = useState<string>('');
  const [freeText, setFreeText] = useState('');

  function submit(answer: string) {
    const cleaned = answer.trim();
    if (!cleaned) return;
    setSelected(cleaned);
    onSelect?.(cleaned);
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/40 bg-card/60 p-5 shadow-sm">
      <div>
        <h4 className="text-[13px] font-semibold tracking-tight text-foreground">{block.question}</h4>
        {block.hint ? <p className="mt-1.5 text-xs text-muted-foreground/90 leading-relaxed">{block.hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {block.options.map((option) => {
          const isSelected = selected === option.label;
          return (
            <button
              key={option.id}
              onClick={() => submit(option.label)}
              className={`rounded-full border px-4 py-2 text-xs font-medium transition-all duration-200 ${isSelected
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
                  : 'border-border/60 bg-background/50 text-foreground hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-600 dark:hover:text-emerald-400'
                }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {block.allowFreeText ? (
        <div className="flex items-center gap-2 pt-2">
          <input
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit(freeText);
            }}
            placeholder="Or type your own answer..."
            className="flex-1 rounded-xl border border-border/50 bg-background/50 px-4 py-2.5 text-[13px] transition-colors focus:border-emerald-500/50 focus:bg-background focus:outline-none focus:ring-1 focus:ring-emerald-500/20 placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => submit(freeText)}
            disabled={!freeText.trim()}
            className="flex shrink-0 items-center justify-center rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-background transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
          >
            Submit
          </button>
        </div>
      ) : null}
    </div>
  );
}

