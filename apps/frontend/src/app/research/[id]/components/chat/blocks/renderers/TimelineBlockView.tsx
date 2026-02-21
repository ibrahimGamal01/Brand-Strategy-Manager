import { CheckCircle2, Clock3, Loader2 } from 'lucide-react';
import type { TimelineBlock } from '../types';

function StatusIcon({ status }: { status?: string }) {
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === 'in_progress') return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
  return <Clock3 className="h-4 w-4 text-muted-foreground" />;
}

export function TimelineBlockView({ block }: { block: TimelineBlock }) {
  return (
    <div className="relative space-y-4 pl-4">
      <div className="absolute left-1 top-2 bottom-2 w-px bg-border" />
      {block.steps.map((step, idx) => (
        <div key={`${block.blockId}-${idx}`} className="relative flex gap-3">
          <div className="relative z-10 mt-1 rounded-full bg-card p-1 shadow-sm ring-1 ring-border/60">
            <StatusIcon status={step.status} />
          </div>
          <div className="space-y-1 rounded-lg border border-border/60 bg-background/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{step.title}</span>
              {step.date ? <span className="text-[11px] text-muted-foreground">{step.date}</span> : null}
            </div>
            {step.detail ? <p className="text-sm text-muted-foreground">{step.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
