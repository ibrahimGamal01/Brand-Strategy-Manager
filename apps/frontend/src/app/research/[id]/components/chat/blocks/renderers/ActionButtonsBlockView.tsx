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
  onAction?: (action: string | undefined, href?: string, payload?: Record<string, unknown>) => void;
}) {
  if (!block.buttons?.length) return null;

  return (
    <div className="space-y-3">
      {block.title ? (
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{block.title}</p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {block.buttons.map((btn) => {
          const handleClick = () => {
            onAction?.(btn.action, btn.href, btn.payload);
            if (!onAction && btn.href) {
              const target = btn.href.startsWith('http') ? '_blank' : '_self';
              window.open(btn.href, target);
              return;
            }
          };
          return (
            <Button
              key={`${block.blockId}-${btn.label}`}
              variant={intentToVariant(btn.intent)}
              className="h-auto min-h-[54px] justify-between rounded-xl border border-border/70 bg-gradient-to-r from-card to-card/80 px-3 py-2.5 text-left shadow-[0_10px_24px_-20px_rgba(15,23,42,0.6)] hover:border-primary/45"
              onClick={handleClick}
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold leading-tight">{btn.label}</span>
                {btn.sublabel ? <span className="mt-0.5 text-xs text-muted-foreground">{btn.sublabel}</span> : null}
              </span>
              {btn.action === 'run_intel' ||
              btn.action === 'run_orchestrator' ||
              btn.action === 'run_intelligence' ||
              String(btn.action || '').startsWith('intel_') ? (
                <Play className="h-4 w-4" />
              ) : (
                <ArrowUpRight className="h-4 w-4" />
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
