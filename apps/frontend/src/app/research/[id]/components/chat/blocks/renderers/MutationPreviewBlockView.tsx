import { Badge } from '@/components/ui/badge';
import type { MutationPreviewBlock } from '../types';

type MutationPreviewBlockViewProps = {
  block: MutationPreviewBlock;
};

function formatSample(sample: Array<Record<string, unknown>> | undefined): string {
  if (!sample || !sample.length) return 'No sample rows.';
  return JSON.stringify(sample.slice(0, 2), null, 2);
}

export function MutationPreviewBlockView({ block }: MutationPreviewBlockViewProps) {
  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          {block.title ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{block.title}</p>
          ) : null}
          <h4 className="text-sm font-semibold text-foreground">
            Preview {String(block.kind || '').toUpperCase()} on {block.section}
          </h4>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase">
          {block.matchedCount} match{block.matchedCount === 1 ? '' : 'es'}
        </Badge>
      </header>

      {Array.isArray(block.warnings) && block.warnings.length ? (
        <ul className="space-y-1 rounded-lg border border-amber-400/40 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          {block.warnings.map((warning, index) => (
            <li key={`${warning}-${index}`}>• {warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Before sample</p>
          <pre className="max-h-44 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-2 text-[10px] leading-relaxed">
            {formatSample(block.beforeSample)}
          </pre>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">After sample</p>
          <pre className="max-h-44 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-2 text-[10px] leading-relaxed">
            {formatSample(block.afterSample)}
          </pre>
        </div>
      </div>
    </section>
  );
}

