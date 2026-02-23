import type { SourceListBlock } from '../types';

interface SourceListBlockViewProps {
  block: SourceListBlock;
}

export function SourceListBlockView({ block }: SourceListBlockViewProps) {
  if (!block.sources?.length) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Context references</p>
      <div className="space-y-2 text-sm">
      {block.sources.map((source, index) => (
        <div
          key={`${block.blockId}-source-${index}`}
          className="rounded-lg border border-border/50 bg-card/80 px-3 py-2"
        >
          <p className="text-xs font-semibold text-foreground">
            {source.handle === 'workspace_context' ? 'Workspace context' : source.handle}
          </p>
          {source.note ? <p className="mt-0.5 text-xs text-muted-foreground">{source.note}</p> : null}
        </div>
      ))}
      </div>
    </div>
  );
}
