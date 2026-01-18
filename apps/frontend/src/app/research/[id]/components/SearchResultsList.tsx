'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Globe } from 'lucide-react';

interface SearchResult {
    id: string;
    query: string;
    title: string;
    body: string;
    href: string;
    source?: string;
}

interface SearchResultsListProps {
    results: SearchResult[];
    itemsPerPage?: number;
}

export function SearchResultsList({ results, itemsPerPage = 15 }: SearchResultsListProps) {
    const [page, setPage] = useState(0);

    const totalPages = Math.ceil(results.length / itemsPerPage);
    const currentResults = results.slice(page * itemsPerPage, (page + 1) * itemsPerPage);

    // Group by query
    const groupedByQuery: Record<string, SearchResult[]> = {};
    currentResults.forEach(r => {
        const q = r.query || 'General';
        if (!groupedByQuery[q]) groupedByQuery[q] = [];
        groupedByQuery[q].push(r);
    });

    return (
        <div>
            <div className="space-y-6">
                {Object.entries(groupedByQuery).map(([query, items]) => (
                    <div key={query}>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-xs font-mono px-2 py-1 bg-primary/10 text-primary rounded">
                                {query}
                            </span>
                            <span className="text-xs text-muted-foreground">({items.length} results)</span>
                        </div>
                        <div className="space-y-2">
                            {items.map((result, i) => (
                                <a
                                    key={result.id || i}
                                    href={result.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
                                >
                                    <div className="flex items-start gap-3">
                                        <Globe className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-sm font-medium text-primary group-hover:underline line-clamp-1">
                                                {result.title}
                                            </h4>
                                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                                {result.body}
                                            </p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className="text-xs text-muted-foreground/60 truncate">
                                                    {result.source || new URL(result.href).hostname}
                                                </span>
                                                <ExternalLink className="h-3 w-3 text-muted-foreground/60" />
                                            </div>
                                        </div>
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-6 pt-4 border-t border-border">
                    <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                    <span className="text-sm text-muted-foreground">
                        Page {page + 1} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page === totalPages - 1}
                        className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronRight className="h-5 w-5" />
                    </button>
                </div>
            )}

            {results.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No search results yet</p>
            )}
        </div>
    );
}
