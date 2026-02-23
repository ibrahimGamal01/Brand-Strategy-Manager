'use client';

import type { TradeoffMatrixBlock } from '../types';

interface TradeoffMatrixBlockViewProps {
  block: TradeoffMatrixBlock;
  onSelect?: (answer: string) => void;
}

function scoreAt(scores: number[], index: number): number {
  const value = scores[index];
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return value;
}

export function TradeoffMatrixBlockView({ block, onSelect }: TradeoffMatrixBlockViewProps) {
  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">{block.title || 'Tradeoff matrix'}</p>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-border/60 p-2 text-left font-semibold text-muted-foreground">Option</th>
              {block.criteria.map((criteria) => (
                <th key={criteria} className="border-b border-border/60 p-2 text-left font-semibold text-muted-foreground">
                  {criteria}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.options.map((option) => (
              <tr key={option.id} className="hover:bg-background/70">
                <td className="border-b border-border/40 p-2">
                  <button
                    onClick={() => onSelect?.(`Select option: ${option.label}`)}
                    className="font-semibold text-foreground hover:text-primary"
                  >
                    {option.label}
                  </button>
                  {option.summary ? <p className="text-[11px] text-muted-foreground">{option.summary}</p> : null}
                </td>
                {block.criteria.map((criteria, idx) => (
                  <td key={`${option.id}-${criteria}`} className="border-b border-border/40 p-2 text-foreground">
                    {scoreAt(option.scores, idx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

