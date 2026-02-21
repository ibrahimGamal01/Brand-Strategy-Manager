import { ArrowUpRight, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActionButtonsBlock } from '../types';

function intentToVariant(intent?: string) {
  switch (intent) {
    case 'primary':
      return 'default';
    case 'secondary':
      return 'secondary';
    default:
      return 'ghost';
  }
}

export function ActionButtonsBlockView({
  block,
  onAction,
}: {
  block: ActionButtonsBlock;
  onAction?: (action: string | undefined, href?: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {block.buttons.map((btn) => {
        const handleClick = () => {
          onAction?.(btn.action, btn.href);
          if (btn.href) {
            const target = btn.href.startsWith('http') ? '_blank' : '_self';
            window.open(btn.href, target);
            return;
          }
        };
        return (
          <Button
            key={`${block.blockId}-${btn.label}`}
            variant={intentToVariant(btn.intent)}
            className="justify-between rounded-lg border border-border/60 bg-background/80 text-left"
            onClick={handleClick}
          >
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{btn.label}</span>
              {btn.sublabel ? <span className="text-xs text-muted-foreground">{btn.sublabel}</span> : null}
            </span>
            {btn.action === 'run_intel' || btn.action === 'run_orchestrator' ? (
              <Play className="h-4 w-4" />
            ) : (
              <ArrowUpRight className="h-4 w-4" />
            )}
          </Button>
        );
      })}
    </div>
  );
}
