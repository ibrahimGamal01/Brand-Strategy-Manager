'use client';

import { useEffect, useState } from 'react';
import { Loader2, PlayCircle, ExternalLink, Calendar, Heart, MessageCircle, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface CompetitorContentViewerProps {
    discoveredCompetitorId: string;
    handle: string;
    platform: string;
    className?: string;
}

interface Post {
    id: string;
    caption: string | null;
    thumbnailUrl: string | null;
    postUrl: string | null;
    likesCount: number | null;
    commentsCount: number | null;
    viewsCount: number | null;
    postedAt: Date | null;
    createdAt: Date;
}

export function CompetitorContentViewer({
    discoveredCompetitorId,
    handle,
    platform,
    className,
}: CompetitorContentViewerProps) {
    const { toast } = useToast();
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(false);
    const [scraping, setScraping] = useState(false);

    async function loadPosts() {
        try {
            setLoading(true);
            const response = await apiClient.getCompetitorPosts(discoveredCompetitorId);

            if (!response?.success) {
                throw new Error('Failed to load posts');
            }

            setPosts(response.posts || []);
        } catch (error: any) {
            toast({
                title: 'Failed to load posts',
                description: error?.message || 'Unable to fetch competitor posts',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadPosts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [discoveredCompetitorId]);

    async function handleScrapeNow() {
        try {
            setScraping(true);
            const response = await apiClient.scrapeCompetitor(discoveredCompetitorId);

            if (!response?.success) {
                throw new Error(response?.error || 'Scrape failed');
            }

            toast({
                title: 'Scraping started',
                description: `Queued @${handle} for scraping. Use Refresh to see new content when ready.`,
            });

            // Poll for new content (scrape may take 30-60s)
            const delays = [3000, 8000, 15000];
            delays.forEach((ms) => {
                setTimeout(() => void loadPosts(), ms);
            });
        } catch (error: any) {
            toast({
                title: 'Scrape failed',
                description: error?.message || `Unable to scrape @${handle}`,
                variant: 'destructive',
            });
        } finally {
            setScraping(false);
        }
    }

    function formatDate(date: Date | null): string {
        if (!date) return 'Unknown';
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatNumber(num: number | null): string {
        if (num === null) return '-';
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return num.toString();
    }

    if (loading) {
        return (
            <div className={cn('flex items-center justify-center py-12', className)}>
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (posts.length === 0) {
        return (
            <div className={cn('space-y-4 py-8 text-center', className)}>
                <div className="text-sm text-muted-foreground">
                    No posts found for <span className="font-medium">@{handle}</span>
                </div>
                <Button onClick={handleScrapeNow} disabled={scraping} size="sm">
                    {scraping ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Scraping...
                        </>
                    ) : (
                        <>
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Scrape Now
                        </>
                    )}
                </Button>
            </div>
        );
    }

    return (
        <div className={cn('space-y-4', className)}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="uppercase">
                        {platform}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                        {posts.length} post{posts.length === 1 ? '' : 's'}
                    </span>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => void loadPosts()} disabled={loading} size="sm" variant="ghost" title="Refresh content">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    </Button>
                    <Button onClick={handleScrapeNow} disabled={scraping} size="sm" variant="outline">
                    {scraping ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Scraping...
                        </>
                    ) : (
                        <>
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Scrape More
                        </>
                    )}
                </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {posts.map((post) => (
                    <div
                        key={post.id}
                        className="group relative overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md"
                    >
                        {post.thumbnailUrl ? (
                            <div className="relative aspect-square overflow-hidden bg-muted">
                                <img
                                    src={post.thumbnailUrl}
                                    alt={post.caption || 'Post thumbnail'}
                                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                />
                            </div>
                        ) : (
                            <div className="flex aspect-square items-center justify-center bg-muted">
                                <span className="text-xs text-muted-foreground">No image</span>
                            </div>
                        )}

                        <div className="space-y-2 p-3">
                            {post.caption ? (
                                <p className="line-clamp-2 text-xs text-foreground">
                                    {post.caption}
                                </p>
                            ) : (
                                <p className="text-xs italic text-muted-foreground">No caption</p>
                            )}

                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                {post.likesCount !== null && (
                                    <div className="flex items-center gap-1">
                                        <Heart className="h-3 w-3" />
                                        {formatNumber(post.likesCount)}
                                    </div>
                                )}
                                {post.commentsCount !== null && (
                                    <div className="flex items-center gap-1">
                                        <MessageCircle className="h-3 w-3" />
                                        {formatNumber(post.commentsCount)}
                                    </div>
                                )}
                                {post.postedAt && (
                                    <div className="flex items-center gap-1">
                                        <Calendar className="h-3 w-3" />
                                        {formatDate(post.postedAt)}
                                    </div>
                                )}
                            </div>

                            {post.postUrl && (
                                <a
                                    href={post.postUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                    View on {platform}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
