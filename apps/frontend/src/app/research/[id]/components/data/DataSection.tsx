'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface DataSectionProps {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
    children: React.ReactNode;
    actions?: React.ReactNode;
    onRefresh?: () => void;
    onAdd?: () => void;
    defaultExpanded?: boolean;
    loading?: boolean;
    className?: string;
}

export function DataSection({
    title,
    icon: Icon,
    count,
    children,
    actions,
    onRefresh,
    onAdd,
    defaultExpanded = false,
    loading = false,
    className = ''
}: DataSectionProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    return (
        <div className={`space-y-4 ${className}`}>
            <div className="flex items-center justify-between">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-2 group"
                >
                    {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    )}
                    <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-lg hover:underline decoration-dotted text-left">
                            {title}
                        </h3>
                        {count !== undefined && (
                            <Badge variant="secondary" className="text-xs">
                                {count}
                            </Badge>
                        )}
                    </div>
                </button>

                <div className="flex items-center gap-2">
                    {actions}
                    {onRefresh && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRefresh();
                            }}
                            disabled={loading}
                            title="Refresh"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    )}
                    {onAdd && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                onAdd();
                            }}
                            className="gap-1"
                        >
                            <Plus className="h-4 w-4" />
                            <span className="hidden sm:inline">Add</span>
                        </Button>
                    )}
                </div>
            </div>

            {isExpanded && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    {children}
                </div>
            )}
        </div>
    );
}
