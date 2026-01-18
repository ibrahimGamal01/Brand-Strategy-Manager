import { Search, Image, Users, Brain, CheckCircle2 } from 'lucide-react';
import type { ResearchJob } from '@/types/brand-strategy';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface PipelineProgressProps {
  job: ResearchJob;
}

const stages = [
  { id: 1, label: 'Data Collection', icon: Search, status: 'PENDING' },
  { id: 2, label: 'Media Processing', icon: Image, status: 'SCRAPING' },
  { id: 3, label: 'AI Analysis', icon: Brain, status: 'ANALYZING' },
  { id: 4, label: 'Strategy Output', icon: CheckCircle2, status: 'COMPLETE' },
];

const statusToStage: Record<string, number> = {
  PENDING: 1,
  SCRAPING: 2,
  ANALYZING: 3,
  COMPLETE: 4,
};

export function PipelineProgress({ job }: PipelineProgressProps) {
  const currentStage = statusToStage[job.status];

  return (
    <div className="border-b border-border bg-background/50">
      <div className="container mx-auto px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Pipeline Progress</span>
            <span className="text-xs text-muted-foreground font-mono">
              Stage {currentStage}/4
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {job.progress.label}
            </span>
            <span className="text-sm font-mono text-primary font-semibold">
              {job.progress.percentage}%
            </span>
          </div>
        </div>
        
        <Progress 
          value={job.progress.percentage} 
          variant={job.status === 'COMPLETE' ? 'success' : 'primary'}
          className="h-1.5 mb-5"
        />

        <div className="grid grid-cols-4 gap-4">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const isActive = currentStage === stage.id;
            const isCompleted = currentStage > stage.id;
            const isPending = currentStage < stage.id;

            return (
              <div
                key={stage.id}
                className={cn(
                  "relative flex flex-col items-center gap-2 p-3 rounded-lg transition-all duration-300",
                  isActive && "bg-primary/10 border border-primary/30",
                  isCompleted && "bg-success/5",
                  isPending && "opacity-50"
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300",
                    isActive && "bg-primary text-primary-foreground animate-pulse",
                    isCompleted && "bg-success/20 text-success",
                    isPending && "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={cn(
                    "text-xs font-medium text-center",
                    isActive && "text-primary",
                    isCompleted && "text-success",
                    isPending && "text-muted-foreground"
                  )}
                >
                  {stage.label}
                </span>
                {isCompleted && (
                  <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-success" />
                )}
                {index < stages.length - 1 && (
                  <div
                    className={cn(
                      "absolute top-1/2 -right-2 h-0.5 w-4 -translate-y-1/2",
                      isCompleted ? "bg-success/50" : "bg-border"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
