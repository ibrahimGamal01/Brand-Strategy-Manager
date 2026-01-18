'use client';

import { Search, Image, Brain, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const statusToStage: Record<string, number> = {
    PENDING: 1,
    SCRAPING_CLIENT: 2,
    DISCOVERING_COMPETITORS: 2,
    ANALYZING: 3,
    COMPLETE: 4,
    FAILED: 4,
};

const stages = [
    { id: 1, label: 'Data Collection', icon: Search },
    { id: 2, label: 'Media Processing', icon: Image },
    { id: 3, label: 'AI Analysis', icon: Brain },
    { id: 4, label: 'Strategy Output', icon: CheckCircle2 },
];

interface PipelineProgressProps {
    status: string;
    onStop?: () => void;
}

export function PipelineProgress({ status, onStop }: PipelineProgressProps) {
    const currentStage = statusToStage[status] || 1;
    const progress = Math.min(currentStage * 25, 100);

    return (
        <div className="border-b border-border bg-background/50">
            <div className="container mx-auto px-6 py-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">Pipeline Progress</span>
                        <span className="text-xs text-muted-foreground font-mono">
                            Stage {currentStage}/4
                        </span>
                        {status !== 'COMPLETE' && status !== 'FAILED' && onStop && (
                            <button
                                onClick={onStop}
                                className="ml-4 px-2 py-0.5 text-xs text-red-500 border border-red-500/30 rounded hover:bg-red-500/10 transition-colors"
                            >
                                Stop
                            </button>
                        )}
                    </div>
                    <span className={cn(
                        "text-sm font-mono font-semibold",
                        status === 'FAILED' ? "text-red-500" : "text-primary"
                    )}>
                        {status === 'FAILED' ? 'CANCELLED' : `${progress}%`}
                    </span>
                </div>

                <Progress value={progress} className="h-1.5 mb-5" />

                <div className="grid grid-cols-4 gap-4">
                    {stages.map((stage) => {
                        const isActive = currentStage === stage.id;
                        const isCompleted = currentStage > stage.id;
                        const isPending = currentStage < stage.id;
                        const Icon = stage.icon;

                        return (
                            <div
                                key={stage.id}
                                className={cn(
                                    "relative flex flex-col items-center gap-2 p-3 rounded-lg transition-all duration-300",
                                    isActive && "bg-primary/10 border border-primary/30",
                                    isCompleted && "bg-green-500/5",
                                    isPending && "opacity-50"
                                )}
                            >
                                <div
                                    className={cn(
                                        "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300",
                                        isActive && "bg-primary text-primary-foreground animate-pulse",
                                        isCompleted && "bg-green-500/20 text-green-500",
                                        isPending && "bg-muted text-muted-foreground"
                                    )}
                                >
                                    <Icon className="h-5 w-5" />
                                </div>
                                <span
                                    className={cn(
                                        "text-xs font-medium text-center",
                                        isActive && "text-primary",
                                        isCompleted && "text-green-500",
                                        isPending && "text-muted-foreground"
                                    )}
                                >
                                    {stage.label}
                                </span>
                                {isCompleted && (
                                    <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-green-500" />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
