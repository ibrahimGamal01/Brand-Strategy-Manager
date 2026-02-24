import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ToolConfirmationBlock } from '../types';

type ToolConfirmationBlockViewProps = {
  block: ToolConfirmationBlock;
};

function toRiskLabel(level?: string): 'low' | 'medium' | 'high' {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium') return normalized;
  return 'low';
}

const RISK_STYLE: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-emerald-300/60 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200',
  medium: 'border-amber-300/60 bg-amber-50/70 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200',
  high: 'border-destructive/45 bg-destructive/10 text-destructive',
};

export function ToolConfirmationBlockView({ block }: ToolConfirmationBlockViewProps) {
  const risk = toRiskLabel(block.riskLevel);
  const details = Array.isArray(block.details)
    ? block.details.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return (
    <section className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          {block.title ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {block.title}
            </p>
          ) : null}
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {risk === 'high' ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-emerald-600" />}
            Confirm tool action
          </h4>
          <p className="text-xs text-muted-foreground">
            {block.summary}
          </p>
        </div>
        <Badge variant="outline" className={RISK_STYLE[risk]}>
          {risk.toUpperCase()} RISK
        </Badge>
      </header>

      {details.length ? (
        <ul className="space-y-1 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {details.map((detail, index) => (
            <li key={`${block.blockId}-detail-${index}`}>• {detail}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
