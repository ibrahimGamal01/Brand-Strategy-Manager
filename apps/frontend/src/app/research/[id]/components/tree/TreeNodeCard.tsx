'use client';

import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface TreeNodeCardProps {
    title: ReactNode;
    icon: ReactNode;
    count?: number;
    level?: number;
    defaultExpanded?: boolean;
    children?: ReactNode;
    actions?: ReactNode;
    className?: string;
}

/**
 * TreeNodeCard - Hierarchical card that shows tree structure with visual branches
 * Designed to nest and create a vertical tree layout
 */
export function TreeNodeCard({
    title,
    icon,
    count,
    level = 0,
    defaultExpanded = false,
    children,
    actions,
    className = ''
}: TreeNodeCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    const indentPx = level * 24; // 24px per level
    const hasChildren = !!children;

    return (
        <div
            className={`relative ${className}`}
            style={{ marginLeft: `${indentPx}px` }}
        >
            {/* Vertical connector line for nested items */}
            {level > 0 && (
                <div
                    className="absolute left-[-12px] top-0 bottom-0 w-[2px] bg-border"
                    style={{ left: `-${indentPx / 2}px` }}
                />
            )}

            {/* Horizontal connector */}
            {level > 0 && (
                <div
                    className="absolute top-[24px] w-[12px] h-[2px] bg-border"
                    style={{ left: `-${indentPx / 2}px` }}
                />
            )}

            <Card className="mb-3 transition-all hover:shadow-md">
                <CardHeader
                    className={`${hasChildren ? 'cursor-pointer' : ''} hover:bg-muted/30 transition-colors`}
                    onClick={() => hasChildren && setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {hasChildren && (
                                isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                )
                            )}
                            {!hasChildren && <div className="w-4" />}

                            <div className="text-primary flex-shrink-0">{icon}</div>

                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-sm truncate">{title}</h3>
                                {count !== undefined && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {count} {count === 1 ? 'item' : 'items'}
                                    </p>
                                )}
                            </div>
                        </div>

                        {actions && (
                            <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                {actions}
                            </div>
                        )}
                    </div>
                </CardHeader>

                {isExpanded && children && (
                    <CardContent className="pt-0">
                        {children}
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
