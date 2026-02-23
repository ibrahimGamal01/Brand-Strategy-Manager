'use client';

import type { ProgressStepperBlock } from '../types';

interface ProgressStepperBlockViewProps {
  block: ProgressStepperBlock;
}

export function ProgressStepperBlockView({ block }: ProgressStepperBlockViewProps) {
  const total = Math.max(1, Number(block.totalSteps || 1));
  const current = Math.min(total, Math.max(1, Number(block.currentStep || 1)));
  const percentage = Math.max(0, Math.min(100, Math.round((current / total) * 100)));

  return (
    <div className="rounded-xl border border-sky-500/15 bg-gradient-to-br from-sky-500/5 to-emerald-500/5 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">
          {block.title || 'Workflow Progress'}
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold text-foreground">{current}</span>
          <span className="text-sm font-medium text-muted-foreground">/ {total}</span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/50 dark:bg-slate-700/50">
        <div
          className="relative h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-700 ease-out"
          style={{ width: `${percentage}%` }}
        >
          {percentage > 0 && percentage < 100 && (
            <div className="absolute inset-0 bg-white/20 animate-pulse" />
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-medium text-muted-foreground">{block.phase || 'guided discovery'}</span>
        </div>
        <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-medium tracking-wide text-emerald-700 dark:text-emerald-400 uppercase text-[10px]">
          {block.status || 'Active'}
        </span>
      </div>
    </div>
  );
}
