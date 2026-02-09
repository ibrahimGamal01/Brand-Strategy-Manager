'use client';

import { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DataItemProps {
    title: string;
    subtitle?: string;
    content?: string;
    url?: string;
    className?: string;
}

/**
 * DataItem - Displays individual data items with expand/collapse for content
 */
export function DataItem({ title, subtitle, content, url, className = '' }: DataItemProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasContent = !!content;

    return (
        <div className={`border-b border-border/40 last:border-0 py-2 px-3 hover:bg-muted/30 transition-colors ${className}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        {hasContent && (
                            <button
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-3 w-3" />
                                ) : (
                                    <ChevronRight className="h-3 w-3" />
                                )}
                            </button>
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{title}</p>
                            {subtitle && (
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{subtitle}</p>
                            )}
                        </div>
                    </div>

                    {isExpanded && content && (
                        <div className="mt-2 ml-5 text-[11px] text-muted-foreground leading-relaxed max-h-40 overflow-y-auto pr-2">
                            {content}
                        </div>
                    )}
                </div>

                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <ExternalLink className="h-3 w-3" />
                    </a>
                )}
            </div>
        </div>
    );
}

interface DataListProps {
    items: Array<{
        id?: string;
        title: string;
        subtitle?: string;
        content?: string;
        url?: string;
    }>;
    emptyMessage?: string;
}

/**
 * DataList - Displays a list of data items
 */
export function DataList({ items, emptyMessage = 'No data available' }: DataListProps) {
    if (!items || items.length === 0) {
        return (
            <div className="text-xs text-muted-foreground text-center py-6 px-4">
                {emptyMessage}
            </div>
        );
    }

    return (
        <div className="divide-y divide-border/40">
            {items.map((item, index) => (
                <DataItem
                    key={item.id || index}
                    title={item.title}
                    subtitle={item.subtitle}
                    content={item.content}
                    url={item.url}
                />
            ))}
        </div>
    );
}
