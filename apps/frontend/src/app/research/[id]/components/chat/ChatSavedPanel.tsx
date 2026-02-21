import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ChatSavedBlock } from './types';

interface ChatSavedPanelProps {
  blocks: ChatSavedBlock[];
  onUnpin: (block: ChatSavedBlock) => void;
  isLoading?: boolean;
}

function blockLabel(block: ChatSavedBlock) {
  const type = block.blockData?.type || 'block';
  const title = block.blockData?.title ? ` - ${block.blockData.title}` : '';
  return `${type}${title}`;
}

function blockPreview(block: ChatSavedBlock) {
  const data = block.blockData as any;
  if (!data) return 'Pinned from chat.';
  if (data.type === 'table' && Array.isArray(data.columns)) {
    return `Columns: ${data.columns.slice(0, 3).join(', ')}${data.columns.length > 3 ? '…' : ''}`;
  }
  if (data.type === 'metric_cards' && Array.isArray(data.cards)) {
    return `Cards: ${data.cards.map((card: any) => card.label).slice(0, 3).join(', ')}`;
  }
  if (data.type === 'insight') {
    return String(data.body || '').slice(0, 80);
  }
  if (data.type === 'comparison') {
    return `Compare: ${(data.left?.title || 'A')} vs ${(data.right?.title || 'B')}`;
  }
  if (data.type === 'source_list' && Array.isArray(data.sources)) {
    return `Sources: ${data.sources.map((source: any) => source.handle).slice(0, 3).join(', ')}`;
  }
  return 'Pinned from chat.';
}

export function ChatSavedPanel({ blocks, onUnpin, isLoading }: ChatSavedPanelProps) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Saved from chat</h3>
          <p className="text-xs text-muted-foreground">Pinned components and decisions.</p>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase">
          {blocks.length} saved
        </Badge>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading saved blocks...</p>
      ) : blocks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
          Nothing pinned yet. Pin a block to store it here.
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map((block) => (
            <div key={block.id} className="rounded-lg border border-border/50 bg-background/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {block.blockData?.type || 'block'}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => onUnpin(block)}
                >
                  Unpin
                </Button>
              </div>
              <p className="mt-2 text-xs font-medium">{blockLabel(block)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{blockPreview(block)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{block.blockId}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
