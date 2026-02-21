import type { ChartBlock } from '../types';

export function ChartBlockView({ block }: { block: ChartBlock }) {
  const max = Math.max(...block.series.map((s) => s.value || 0), 1);
  return (
    <div className="space-y-2">
      {block.series.map((s, idx) => {
        const width = Math.max(8, Math.min(100, (s.value / max) * 100));
        return (
          <div key={`${block.blockId}-${idx}`} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{s.label}</span>
              <span className="font-semibold text-foreground">{s.value}</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted">
              <div
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: `${width}%`,
                  background: s.color || 'linear-gradient(90deg, #38bdf8, #a855f7)',
                }}
              />
            </div>
          </div>
        );
      })}
      {block.caption ? <p className="text-xs text-muted-foreground">{block.caption}</p> : null}
    </div>
  );
}
