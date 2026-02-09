'use client';

import { useState, ReactNode } from 'react';
import { ChevronRight, ChevronDown, Play, Edit2, Trash2, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Status = 'SUGGESTED' | 'SCRAPING' | 'SCRAPED' | 'FAILED' | 'IN_PROGRESS';

interface TreeNodeProps {
    level: number;
    title: string;
    status?: Status;
    count?: number;
    children?: ReactNode;
    onRun?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    defaultExpanded?: boolean;
    isRunning?: boolean;
    className?: string;
}

/**
 * TreeNode - Individual expandable/collapsible tree node
 * Features:
 * - Expand/collapse with animation
 * - Status badges with icons
 * - Action buttons (Run, Edit, Delete)
 * - Indentation based on level
 */
export function TreeNode({
    level,
    title,
    status,
    count,
    children,
    onRun,
    onEdit,
    onDelete,
    defaultExpanded = false,
    isRunning = false,
    className = ''
}: TreeNodeProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    const indentClass = level === 0 ? '' : `ml-${Math.min(level * 4, 12)}`;
    const hasChildren = !!children;

    // Status badge styling
    const getStatusConfig = (status?: Status) => {
        switch (status) {
            case 'SUGGESTED':
                return { variant: 'secondary' as const, icon: AlertCircle, color: 'text-blue-500' };
            case 'SCRAPING':
            case 'IN_PROGRESS':
                return { variant: 'default' as const, icon: Loader2, color: 'text-yellow-500', animate: true };
            case 'SCRAPED':
                return { variant: 'default' as const, icon: CheckCircle, color: 'text-green-500' };
            case 'FAILED':
                return { variant: 'destructive' as const, icon: XCircle, color: 'text-red-500' };
            default:
                return null;
        }
    };

    const statusConfig = status ? getStatusConfig(status) : null;
    const StatusIcon = statusConfig?.icon;

    return (
        <div className={`${indentClass} ${className}`} role="treeitem" aria-expanded={isExpanded}>
            {/* Node Header */}
            <div className="group flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                {/* Expand/Collapse Icon */}
                {hasChildren && (
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-0.5 hover:bg-muted rounded transition-colors"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                    </button>
                )}

                {/* Title */}
                <button
                    onClick={() => hasChildren && setIsExpanded(!isExpanded)}
                    className="flex-1 text-left font-medium text-sm flex items-center gap-2"
                >
                    {title}
                    {count !== undefined && (
                        <span className="text-xs text-muted-foreground font-normal">({count})</span>
                    )}
                </button>

                {/* Status Badge */}
                {statusConfig && (
                    <Badge variant={statusConfig.variant} className="text-xs h-6 gap-1">
                        {StatusIcon && (
                            <StatusIcon className={`h-3 w-3 ${statusConfig.color} ${statusConfig.animate ? 'animate-spin' : ''}`} />
                        )}
                        {status}
                    </Badge>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onRun && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRun();
                            }}
                            disabled={isRunning}
                            title="Run"
                        >
                            {isRunning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Play className="h-3.5 w-3.5" />
                            )}
                        </Button>
                    )}

                    {onEdit && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit();
                            }}
                            title="Edit"
                        >
                            <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                    )}

                    {onDelete && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            title="Delete"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Children (Expandable Content) */}
            {hasChildren && isExpanded && (
                <div className="mt-1 pl-6 border-l-2 border-border/50 ml-2">
                    {children}
                </div>
            )}
        </div>
    );
}
