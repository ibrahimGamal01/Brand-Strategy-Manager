import type { SourceListBlock } from '../types';

interface SourceListBlockViewProps {
  block: SourceListBlock;
}

export function SourceListBlockView({ block }: SourceListBlockViewProps) {
  if (!block.sources?.length) {
    return <p className="text-xs text-muted-foreground">No sources listed.</p>;
  }

  return (
    <div className="space-y-2 text-sm">
      {block.sources.map((source, index) => (
        <div key={`${block.blockId}-source-${index}`} className="rounded-md border border-border/50 bg-card/60 px-3 py-2">
          <p className="font-mono text-xs">{source.handle}</p>
          {source.note ? <p className="text-xs text-muted-foreground">{source.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

