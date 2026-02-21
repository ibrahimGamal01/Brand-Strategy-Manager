import type { FunnelBlock } from '../types';

function percent(value?: number) {
  if (value === undefined || value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function FunnelBlockView({ block }: { block: FunnelBlock }) {
  const max = Math.max(...block.stages.map((s) => s.current || 0), 1);
  return (
    <div className="space-y-3">
      {block.stages.map((stage, idx) => {
        const width = Math.max(18, Math.min(100, (stage.current / max) * 100));
        return (
          <div key={`${block.blockId}-${idx}`} className="space-y-1">
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span>{stage.label}</span>
              <span>
                {stage.current}
                {stage.target ? ` / ${stage.target}` : ''}{' '}
                {stage.conversionRate !== undefined ? ` · ${percent(stage.conversionRate)}` : ''}
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted">
              <div
                className="h-3 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
