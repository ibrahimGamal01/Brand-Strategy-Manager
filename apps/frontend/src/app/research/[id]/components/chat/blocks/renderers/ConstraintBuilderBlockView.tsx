'use client';

import { useMemo, useState } from 'react';
import type { ConstraintBuilderBlock } from '../types';

interface ConstraintBuilderBlockViewProps {
  block: ConstraintBuilderBlock;
  onSelect?: (answer: string) => void;
}

export function ConstraintBuilderBlockView({ block, onSelect }: ConstraintBuilderBlockViewProps) {
  const initial = useMemo(
    () => new Set(block.constraints.filter((item) => item.selected !== false).map((item) => item.label)),
    [block.constraints]
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [custom, setCustom] = useState('');

  function toggle(label: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function submit() {
    const payload = Array.from(selected);
    if (block.allowCustom && custom.trim()) payload.push(custom.trim());
    if (!payload.length) return;
    onSelect?.(`Constraints: ${payload.join(', ')}`);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">{block.prompt || 'Set constraints'}</p>
      <div className="space-y-2">
        {block.constraints.map((constraint) => {
          const active = selected.has(constraint.label);
          return (
            <button
              key={constraint.id}
              onClick={() => toggle(constraint.label)}
              className={`w-full rounded-lg border p-2 text-left text-xs transition-colors ${
                active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border/60 bg-background/70 text-muted-foreground hover:border-primary/40'
              }`}
            >
              <p className="font-semibold">{constraint.label}</p>
              {constraint.description ? <p>{constraint.description}</p> : null}
            </button>
          );
        })}
      </div>
      {block.allowCustom ? (
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder="Add custom constraint"
          className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs focus:border-primary/40 focus:outline-none"
        />
      ) : null}
      <button
        onClick={submit}
        className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
      >
        Apply constraints
      </button>
    </div>
  );
}

