'use client';

import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronRight, LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface DataCardProps {
    title: string;
    icon: LucideIcon;
    count?: number;
    status?: 'idle' | 'loading' | 'success' | 'error';
    defaultExpanded?: boolean;
    children?: ReactNode;
    onRefresh?: () => void;
    className?: string;
}

/**
 * DataCard - Expandable card for research data sections
 * Features:
 * - Collapsible header with icon and count
 * - Status badge
 * - Refresh action
 * - 2-column grid layout support
 */
export function DataCard({
    title,
    icon: Icon,
    count,
    status = 'idle',
    defaultExpanded = false,
    children,
    onRefresh,
    className = ''
}: DataCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    const statusColors = {
        idle: 'bg-gray-500',
        loading: 'bg-blue-500 animate-pulse',
        success: 'bg-green-500',
        error: 'bg-red-500'
    };

    return (
        <Card className={`transition-all hover:shadow-md ${className}`}>
            <CardHeader
                className="cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                        <Icon className="h-5 w-5 text-primary" />
                        <div>
                            <h3 className="text-lg font-semibold">{title}</h3>
                            {count !== undefined && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {count} {count === 1 ? 'item' : 'items'}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {status !== 'idle' && (
                            <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
                        )}
                        {count !== undefined && (
                            <Badge variant="secondary" className="font-mono">
                                {count}
                            </Badge>
                        )}
                    </div>
                </div>
            </CardHeader>

            {isExpanded && children && (
                <CardContent className="pt-0">
                    {children}
                </CardContent>
            )}
        </Card>
    );
}
