import { Button } from '@/components/ui/button';
import type { DocumentRequestBlock } from '../types';

type DocumentRequestBlockViewProps = {
  block: DocumentRequestBlock;
  onSelect?: (value: string) => void;
};

export function DocumentRequestBlockView({ block, onSelect }: DocumentRequestBlockViewProps) {
  const options = Array.isArray(block.options) ? block.options : [];
  if (!options.length && !block.question) return null;

  return (
    <section className="space-y-3">
      {block.title ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{block.title}</p>
      ) : null}
      {block.question ? <p className="text-sm text-foreground">{block.question}</p> : null}
      {options.length ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option, index) => (
            <Button
              key={option.id || `doc-option-${index + 1}`}
              size="sm"
              variant="outline"
              className="h-auto whitespace-normal px-3 py-2 text-left"
              onClick={() => onSelect?.(option.label)}
            >
              <span className="space-y-1">
                <span className="block text-xs font-medium">{option.label}</span>
                {option.description ? (
                  <span className="block text-[11px] font-normal text-muted-foreground">{option.description}</span>
                ) : null}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

