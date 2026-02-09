'use client';

import { useState } from 'react';
import { ExternalLink, Search, ChevronDown, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SearchResult {
    id: string;
    title: string;
    snippet?: string | null; // Supports snippet, body, or description
    url: string;
    source?: string;
}

interface SearchResultsListProps {
    results: SearchResult[];
    emptyMessage?: string;
}

export function SearchResultsList({ results, emptyMessage = "No search results found" }: SearchResultsListProps) {
    const [displayCount, setDisplayCount] = useState(20);

    const displayedResults = results.slice(0, displayCount);
    const hasMore = results.length > displayCount;

    const getDomain = (url: string) => {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return 'Unknown';
        }
    };

    if (results.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/30 text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between bg-secondary/20 p-3 rounded-lg border border-border/50">
                <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-blue-500" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Web Results
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 ml-1">
                        {results.length}
                    </Badge>
                </div>
            </div>

            <div className="divide-y divide-border/40 border border-border/40 rounded-lg overflow-hidden bg-background/50">
                {displayedResults.map((result, idx) => (
                    <div
                        key={result.id || idx}
                        className="group p-4 hover:bg-muted/30 transition-colors relative"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
                                        <Globe className="h-3 w-3 opacity-60" />
                                        <span className="truncate max-w-[200px]">{getDomain(result.url)}</span>
                                    </div>
                                    {result.source && (
                                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-border/50 font-normal">
                                            {result.source}
                                        </Badge>
                                    )}
                                </div>

                                <a
                                    href={result.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block group-hover:text-blue-500 transition-colors"
                                >
                                    <span className="absolute inset-0" aria-hidden="true" />
                                    <h3 className="text-sm font-medium truncate mb-1 pr-8">
                                        {result.title || "Untitled Result"}
                                    </h3>
                                </a>

                                <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
                                    {result.snippet || "No description available."}
                                </p>
                            </div>

                            <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 top-4" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Load More Button */}
            {hasMore && (
                <div className="flex justify-center pt-2">
                    <Button
                        onClick={() => setDisplayCount(prev => prev + 20)}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-2"
                    >
                        <ChevronDown className="h-3 w-3" />
                        Load More ({results.length - displayCount} remaining)
                    </Button>
                </div>
            )}
        </div>
    );
}
