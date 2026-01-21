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
    rawData?: any; // New prop for raw JSON data
}

export function DataSourceSection({
    title,
    icon: Icon,
    count,
    children,
    defaultOpen = false,
    onRerun,
    lastRun,
    status = 'complete',
    rawData
}: DataSourceSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [isRerunning, setIsRerunning] = useState(false);
    const [showJson, setShowJson] = useState(false); // Toggle for JSON view

    const handleRerun = async () => {
        if (!onRerun || isRerunning) return;
        setIsRerunning(true);
        try {
            await onRerun();
        } finally {
            setIsRerunning(false);
        }
    };

    return (
        <div className="border border-border rounded-lg overflow-hidden bg-card/50">
            <div
                className="flex items-center gap-3 w-full p-4 hover:bg-muted/30 transition-colors select-none"
            >
                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 cursor-pointer"
                >
                    <Icon className="h-5 w-5 text-primary" />
                </div>

                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex-1 cursor-pointer"
                >
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
                    {rawData && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowJson(!showJson);
                            }}
                            className={cn(
                                "text-xs px-2 py-1 rounded border border-border/50 hover:bg-muted mr-2",
                                showJson && "bg-muted font-medium"
                            )}
                            title="Toggle Raw Data View"
                        >
                            {showJson ? '{ Hide JSON }' : '{ JSON }'}
                        </button>
                    )}

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
                    <div
                        onClick={() => setIsOpen(!isOpen)}
                        className="cursor-pointer p-1"
                    >
                        {isOpen ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                    </div>
                </div>
            </div>

            {isOpen && (
                <div className="border-t border-border p-4 bg-background/50">
                    {showJson ? (
                        <div className="bg-slate-950 p-4 rounded-lg overflow-x-auto mb-4 border border-slate-800">
                            <pre className="text-xs font-mono text-slate-300">
                                {JSON.stringify(rawData, null, 2)}
                            </pre>
                        </div>
                    ) : null}
                    {children}
                </div>
            )}
        </div>
    );
}
