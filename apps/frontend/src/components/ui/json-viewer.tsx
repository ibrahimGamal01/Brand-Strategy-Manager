import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils'; // Keep absolute path

interface JsonViewerProps {
    data: any;
    title?: string;
    defaultExpanded?: boolean;
    className?: string;
}

export function JsonViewer({ data, title = "Raw Data", defaultExpanded = false, className }: JsonViewerProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!data) return null;

    return (
        <div className={cn("border rounded-md overflow-hidden bg-background", className)}>
            <div
                className="flex items-center justify-between px-3 py-1.5 bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {title}
                </div>

                {isExpanded && (
                    <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-background/50" onClick={handleCopy}>
                        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                    </Button>
                )}
            </div>

            {isExpanded && (
                <div className="p-3 overflow-x-auto bg-[#09090b] border-t border-border/50 text-[10px] sm:text-xs font-mono text-blue-100/90 leading-relaxed shadow-inner">
                    <pre>{JSON.stringify(data, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}
