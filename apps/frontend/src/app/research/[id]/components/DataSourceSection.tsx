'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DataSourceSectionProps {
    title: string;
    icon: React.ElementType;
    count: number;
    children: React.ReactNode;
    defaultOpen?: boolean;
    onRerun?: () => Promise<void>;
    lastRun?: string;
    status?: 'complete' | 'running' | 'pending' | 'failed';
}

export function DataSourceSection({
    title,
    icon: Icon,
    count,
    children,
    defaultOpen = false,
    onRerun,
    lastRun,
    status = 'complete'
}: DataSourceSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [isRerunning, setIsRerunning] = useState(false);

    const handleRerun = async () => {
        if (!onRerun || isRerunning) return;
        setIsRerunning(true);
        try {
            await onRerun();
        } finally {
            setIsRerunning(false);
        }
    };

    const statusColors = {
        complete: 'text-green-500',
        running: 'text-yellow-500',
        pending: 'text-muted-foreground',
        failed: 'text-red-500',
    };

    return (
        <div className="border border-border rounded-lg overflow-hidden bg-card/50">
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 w-full p-4 hover:bg-muted/30 transition-colors cursor-pointer select-none"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        setIsOpen(!isOpen);
                    }
                }}
            >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                    <Icon className="h-5 w-5 text-primary" />
                </div>

                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{title}</h3>
                        <span className="text-xs font-mono px-2 py-0.5 bg-muted rounded-full">
                            {count} items
                        </span>
                        {status === 'running' && (
                            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
                        )}
                    </div>
                    {lastRun && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Last run: {new Date(lastRun).toLocaleString()}
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {onRerun && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRerun();
                            }}
                            disabled={isRerunning}
                            className={cn(
                                "p-2 rounded-lg transition-colors border border-border/50",
                                isRerunning
                                    ? "bg-muted cursor-not-allowed"
                                    : "hover:bg-muted"
                            )}
                            title="Re-run this scraper"
                        >
                            <RefreshCw className={cn(
                                "h-4 w-4",
                                isRerunning && "animate-spin"
                            )} />
                        </button>
                    )}
                    {isOpen ? (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                </div>
            </div>

            {isOpen && (
                <div className="border-t border-border p-4 bg-background/50">
                    {children}
                </div>
            )}
        </div>
    );
}
