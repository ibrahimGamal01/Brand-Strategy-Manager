'use client';

import { useState } from 'react';
import { ExternalLink, Newspaper, ChevronDown, Calendar, Globe } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface NewsResult {
    id: string;
    title: string;
    body?: string | null;
    url: string;
    source?: string | null;
    imageUrl?: string | null;
    publishedAt?: string | null;
}

interface NewsGalleryProps {
    news: NewsResult[];
    emptyMessage?: string;
}

export function NewsGallery({ news, emptyMessage = "No news articles found" }: NewsGalleryProps) {
    const [displayCount, setDisplayCount] = useState(12);
    const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

    const handleImageError = (newsId: string) => {
        setImageErrors(prev => new Set([...prev, newsId]));
    };

    const displayedNews = news.slice(0, displayCount);
    const hasMore = news.length > displayCount;

    const formatDate = (dateString?: string | null) => {
        if (!dateString) return null;
        try {
            return formatDistanceToNow(new Date(dateString), { addSuffix: true });
        } catch {
            return dateString; // Fallback to raw string if parsing fails
        }
    };

    if (news.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/30 text-muted-foreground">
                <Newspaper className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between bg-secondary/20 p-3 rounded-lg border border-border/50">
                <div className="flex items-center gap-2">
                    <Newspaper className="h-4 w-4 text-orange-500" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        News Articles
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 ml-1">
                        {news.length}
                    </Badge>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {displayedNews.map((article, idx) => {
                    const hasError = article.id ? imageErrors.has(article.id) : false;
                    const hasImage = !!article.imageUrl && !hasError;

                    return (
                        <Card
                            key={article.id || idx}
                            className="group flex flex-col overflow-hidden border-0 bg-secondary/20 shadow-none hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 rounded-lg h-full"
                        >
                            {/* Article Image (if available) - 16:9 aspect ratio */}
                            {hasImage && (
                                <div className="relative w-full aspect-video bg-muted overflow-hidden">
                                    <img
                                        src={article.imageUrl!}
                                        alt={article.title}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        onError={() => article.id && handleImageError(article.id)}
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-60" />
                                </div>
                            )}

                            <div className="flex flex-col flex-1 p-4">
                                {/* Metadata Row */}
                                <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground">
                                    {article.source && (
                                        <Badge variant="outline" className="text-[9px] px-1.5 h-4 bg-background/50 border-border/50 text-muted-foreground font-normal">
                                            {article.source}
                                        </Badge>
                                    )}
                                    {article.publishedAt && (
                                        <div className="flex items-center gap-1 ml-auto">
                                            <Calendar className="h-3 w-3 opacity-70" />
                                            <span>{formatDate(article.publishedAt)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Title */}
                                <h3 className="text-sm font-medium leading-tight mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="focus:outline-none">
                                        <span className="absolute inset-0" aria-hidden="true" />
                                        {article.title}
                                    </a>
                                </h3>

                                {/* Snippet */}
                                {article.body && (
                                    <p className="text-xs text-muted-foreground line-clamp-3 mb-4 flex-1">
                                        {article.body}
                                    </p>
                                )}

                                {/* Footer Action */}
                                <div className="mt-auto pt-3 border-t border-border/40 flex items-center justify-between">
                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                        <Globe className="h-3 w-3 opacity-50" />
                                        <span className="truncate max-w-[150px]">
                                            {new URL(article.url).hostname.replace('www.', '')}
                                        </span>
                                    </div>
                                    <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* Load More Button */}
            {hasMore && (
                <div className="flex justify-center pt-2">
                    <Button
                        onClick={() => setDisplayCount(prev => prev + 12)}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-2"
                    >
                        <ChevronDown className="h-3 w-3" />
                        Load More ({news.length - displayCount} remaining)
                    </Button>
                </div>
            )}
        </div>
    );
}
