'use client';

import { Building2, Clock3, Download, PlayCircle, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface BatClientTopbarProps {
  client: Record<string, unknown>;
  job: Record<string, unknown>;
  activeModuleLabel: string;
  onContinueNow?: () => void | Promise<void>;
  isContinuing?: boolean;
  onExportCompetitors?: () => void | Promise<void>;
  isExportingCompetitors?: boolean;
}

function normalizeStatus(status?: string) {
  const value = String(status || 'PENDING').toUpperCase();
  if (value === 'COMPLETE') return { label: 'Complete', variant: 'success' as const };
  if (value === 'FAILED') return { label: 'Failed', variant: 'destructive' as const };
  if (value === 'ANALYZING') return { label: 'Analyzing', variant: 'processing' as const };
  if (value === 'DISCOVERING_COMPETITORS') return { label: 'Discovering', variant: 'warning' as const };
  if (value === 'SCRAPING_CLIENT' || value === 'SCRAPING_COMPETITORS') return { label: 'Scraping', variant: 'warning' as const };
  return { label: 'Pending', variant: 'pending' as const };
}

export function BatClientTopbar({
  client,
  job,
  activeModuleLabel,
  onContinueNow,
  isContinuing = false,
  onExportCompetitors,
  isExportingCompetitors = false,
}: BatClientTopbarProps) {
  const status = normalizeStatus(typeof job?.status === 'string' ? job.status : undefined);
  const clientAccounts = Array.isArray(client?.clientAccounts)
    ? (client.clientAccounts as Array<Record<string, unknown>>)
    : [];
  const primaryHandle = typeof clientAccounts[0]?.handle === 'string' ? clientAccounts[0].handle : null;
  const continuityIntervalHours =
    typeof job?.continuityIntervalHours === 'number' ? job.continuityIntervalHours : 2;
  const continuityEnabled = Boolean(job?.continuityEnabled);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {typeof client?.name === 'string' ? client.name : 'BAT Workspace'}
            </h1>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              BAT
            </Badge>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              {activeModuleLabel}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Social intelligence studio powered by BAT Brain.
            {primaryHandle ? ` Tracking @${primaryHandle}.` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.variant} className="gap-1">
          <Sparkles className="h-3 w-3" />
          {status.label}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Clock3 className="h-3 w-3" />
          {continuityEnabled ? `Auto ${Math.max(2, continuityIntervalHours)}h` : 'Auto off'}
        </Badge>
        {onExportCompetitors ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onExportCompetitors}
            disabled={isExportingCompetitors}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {isExportingCompetitors ? 'Exporting...' : 'Export competitors'}
          </Button>
        ) : null}
        {onContinueNow ? (
          <Button size="sm" onClick={onContinueNow} disabled={isContinuing} className="gap-1.5">
            <PlayCircle className="h-3.5 w-3.5" />
            {isContinuing ? 'Running...' : 'Continue'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
