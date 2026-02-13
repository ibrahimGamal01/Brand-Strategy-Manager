'use client';

import { JsonViewer } from '@/components/ui/json-viewer';
import type { BrainCoverageReport } from '@/lib/brain-data/coverage-contract';

interface BrainRawInspectorProps {
  researchJob: Record<string, unknown>;
  brainPayload: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
  report: BrainCoverageReport;
}

export function BrainRawInspector({ researchJob, brainPayload, events, report }: BrainRawInspectorProps) {
  const payload = {
    researchJob,
    brainPayload,
    events,
    coverageSummary: report.summary,
    extraTopLevelKeys: report.extras,
    missingDatasets: report.invisibleDatasets,
  };

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-4">
      <div>
        <h3 className="text-sm font-semibold">Raw Data Inspector</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Fallback view for any fields not yet mapped into dedicated BAT cards.
        </p>
      </div>

      <JsonViewer data={payload} title="Brain + Research Payload" defaultExpanded={false} />
    </section>
  );
}
