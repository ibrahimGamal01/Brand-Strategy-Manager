'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BrainCoverageReport, BrainCoverageStatus } from '@/lib/brain-data/coverage-contract';

interface BrainDataLedgerProps {
  report: BrainCoverageReport;
}

function statusBadge(status: BrainCoverageStatus) {
  if (status === 'mapped') return { label: 'Mapped', variant: 'success' as const };
  if (status === 'raw_inspector') return { label: 'Raw Inspector', variant: 'warning' as const };
  return { label: 'Missing', variant: 'destructive' as const };
}

export function BrainDataLedger({ report }: BrainDataLedgerProps) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/50">
      <header className="border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Brain Data Coverage Ledger</h3>
          <Badge variant="outline" className="text-[10px] uppercase">
            {report.summary.datasets} datasets
          </Badge>
          <Badge variant="success" className="text-[10px] uppercase">
            {report.summary.mapped} mapped
          </Badge>
          <Badge variant="warning" className="text-[10px] uppercase">
            {report.summary.rawInspector} raw
          </Badge>
          <Badge variant={report.summary.missing > 0 ? 'destructive' : 'success'} className="text-[10px] uppercase">
            {report.summary.missing} missing
          </Badge>
        </div>
      </header>

      <div className="max-h-[420px] overflow-auto custom-scrollbar">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-card/95 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Dataset</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Count</th>
              <th className="px-3 py-2 font-semibold">Module(s)</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              const badge = statusBadge(row.status);
              return (
                <tr key={row.key} className="border-t border-border/50 align-top">
                  <td className="px-3 py-2 font-mono text-[11px] text-foreground">{row.key}</td>
                  <td className="px-3 py-2">
                    <Badge variant={badge.variant} className="text-[10px] uppercase">
                      {badge.label}
                    </Badge>
                  </td>
                  <td className={cn('px-3 py-2 font-semibold', row.count === 0 ? 'text-muted-foreground' : 'text-foreground')}>
                    {row.count}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.mappedModules.length > 0 ? row.mappedModules.join(', ') : 'raw inspector'}
                    {row.notes ? <p className="mt-1 text-[10px] text-muted-foreground/80">{row.notes}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
