import type { InsightBlock } from '../types';

interface InsightBlockViewProps {
  block: InsightBlock;
}

const SEVERITY_STYLES: Record<string, string> = {
  high: 'border-rose-300 bg-rose-50 text-rose-700',
  medium: 'border-amber-300 bg-amber-50 text-amber-700',
  low: 'border-emerald-300 bg-emerald-50 text-emerald-700',
};

export function InsightBlockView({ block }: InsightBlockViewProps) {
  const tone = block.severity ? SEVERITY_STYLES[block.severity] : 'border-border/50 bg-card/60 text-foreground';

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <h4 className="text-sm font-semibold">{block.title}</h4>
      <p className="mt-1 text-sm leading-relaxed">{block.body}</p>
    </div>
  );
}

