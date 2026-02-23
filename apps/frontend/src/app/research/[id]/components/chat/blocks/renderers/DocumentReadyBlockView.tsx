import { Button } from '@/components/ui/button';
import type { DocumentReadyBlock } from '../types';

type DocumentReadyBlockViewProps = {
  block: DocumentReadyBlock;
};

function formatSize(bytes: number | undefined): string | null {
  if (!Number.isFinite(bytes)) return null;
  if ((bytes as number) < 1024) return `${bytes} B`;
  if ((bytes as number) < 1024 * 1024) return `${((bytes as number) / 1024).toFixed(1)} KB`;
  return `${((bytes as number) / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentReadyBlockView({ block }: DocumentReadyBlockViewProps) {
  const href = block.storagePath
    ? (block.storagePath.startsWith('/') ? block.storagePath : `/${block.storagePath}`)
    : null;

  return (
    <section className="space-y-2">
      {block.title ? (
        <p className="text-sm font-semibold text-foreground">{block.title}</p>
      ) : (
        <p className="text-sm font-semibold text-foreground">Document ready</p>
      )}
      <p className="text-xs text-muted-foreground">
        {[block.mimeType, formatSize(block.sizeBytes)].filter(Boolean).join(' • ') || 'PDF ready for download'}
      </p>
      {href ? (
        <Button asChild size="sm">
          <a href={href} target="_blank" rel="noreferrer">
            Open PDF
          </a>
        </Button>
      ) : null}
    </section>
  );
}

