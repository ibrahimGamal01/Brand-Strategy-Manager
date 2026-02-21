import type { ComparisonBlock } from '../types';

interface ComparisonBlockViewProps {
  block: ComparisonBlock;
}

export function ComparisonBlockView({ block }: ComparisonBlockViewProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.left?.title || 'Option A'}
        </h4>
        <ul className="mt-2 space-y-1 text-sm">
          {(block.left?.items || []).map((item, index) => (
            <li key={`${block.blockId}-left-${index}`} className="flex items-start gap-2">
              <span className="text-xs text-muted-foreground">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.right?.title || 'Option B'}
        </h4>
        <ul className="mt-2 space-y-1 text-sm">
          {(block.right?.items || []).map((item, index) => (
            <li key={`${block.blockId}-right-${index}`} className="flex items-start gap-2">
              <span className="text-xs text-muted-foreground">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

