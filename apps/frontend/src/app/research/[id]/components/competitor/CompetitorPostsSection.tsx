'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { PostCard } from './PostCard';
import { PostsFilter } from './PostsFilter';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface CompetitorPostsSectionProps {
    competitorId: string;
    handle: string;
    platform: 'instagram' | 'tiktok';
    postsCount: number;
    defaultExpanded?: boolean;
    profileId?: string; // Social profile ID for API operations
    onRefresh?: () => void; // Callback to refresh parent data
}

type SortOption = 'latest' | 'likes' | 'engagement';
type FilterOption = 'all' | 'videos' | 'images';

export function CompetitorPostsSection({
    competitorId,
    handle,
    platform,
    postsCount,
    defaultExpanded = false,
    profileId,
    onRefresh
}: CompetitorPostsSectionProps) {
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [sortBy, setSortBy] = useState<SortOption>('latest');
    const [filterBy, setFilterBy] = useState<FilterOption>('all');
    const [isResetting, setIsResetting] = useState(false);
    const [isRescrapng, setIsRescrapng] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (postsCount > 0) {
            fetchPosts();
        }
    }, [competitorId, postsCount]);

    const fetchPosts = async () => {
        setLoading(true);
        try {
            const data = await apiClient.getCompetitorPosts(competitorId);
            setPosts(data.posts || []);
        } catch (error) {
            console.error('Failed to fetch competitor posts:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete all posts for this competitor?')) return;

        setIsResetting(true);
        try {
            await apiClient.deleteCompetitorPosts(competitorId);
            toast({
                title: "Reset Complete",
                description: "Competitor posts have been deleted.",
            });
            setPosts([]); // Clear local state immediately for better UX
            onRefresh?.();
        } catch (error) {
            console.error('Reset failed:', error);
            toast({
                title: "Reset Failed",
                description: "Could not delete competitor posts.",
                variant: "destructive"
            });
        } finally {
            setIsResetting(false);
        }
    };

    const handleRescrape = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsRescrapng(true);
        try {
            const res = await apiClient.scrapeCompetitor(competitorId);
            toast({
                title: "Scraping Started",
                description: res.message || "This may take a few minutes.",
            });
            // We don't refresh immediately as it's async background job
        } catch (error) {
            console.error('Rescrape failed:', error);
            toast({
                title: "Scraping Failed",
                description: "Could not start scraping.",
                variant: "destructive"
            });
        } finally {
            setIsRescrapng(false);
        }
    };

    const filteredPosts = posts
        .filter(post => {
            if (filterBy === 'videos') return post.isVideo;
            if (filterBy === 'images') return !post.isVideo;
            return true;
        })
        .sort((a, b) => {
            if (sortBy === 'latest') {
                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            }
            if (sortBy === 'likes') return b.likes - a.likes;
            if (sortBy === 'engagement') return (b.engagement || 0) - (a.engagement || 0);
            return 0;
        });

    // Determine what to show in the content area
    let content;

    if (loading) {
        content = (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
                <span className="text-xs text-muted-foreground animate-pulse">Loading gallery...</span>
            </div>
        );
    } else if (posts.length === 0) {
        // No posts loaded (either not scraped yet, or deleted)
        content = (
            <div className="flex flex-col items-center justify-center py-12 gap-3 border border-dashed border-border/50 rounded-lg bg-muted/5">
                <div className="p-3 bg-muted rounded-full">
                    <span className="text-2xl">📥</span>
                </div>
                <div className="text-center">
                    <p className="text-sm font-medium text-foreground">No posts available</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                        Click the refresh icon above to scrape posts for this competitor.
                    </p>
                </div>
            </div>
        );
    } else if (filteredPosts.length === 0) {
        // Posts exist but filtered out
        content = (
            <div className="flex flex-col items-center justify-center py-16 gap-3 border border-dashed border-border/50 rounded-lg bg-muted/5">
                <div className="p-3 bg-muted rounded-full">
                    <span className="text-2xl">📭</span>
                </div>
                <div className="text-center">
                    <p className="text-sm font-medium text-foreground">No posts match your filters</p>
                    <p className="text-xs text-muted-foreground mt-1">Try changing the filter settings</p>
                </div>
            </div>
        );
    } else {
        // Posts displayed
        content = (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredPosts.map(post => (
                    <PostCard key={post.id} post={post} platform={platform} />
                ))}
            </div>
        );
    }

    return (
        <div className="mt-4 border border-border/40 rounded-xl bg-card/50 overflow-hidden">
            {/* Section Header with Filters */}
            <div className="p-4 border-b border-border/40 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="h-6 px-2 text-xs font-normal bg-background/50 backdrop-blur-sm">
                        Total Posts: {postsCount}
                    </Badge>
                    {platform === 'tiktok' ? (
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                    ) : (
                        <div className="h-1.5 w-1.5 rounded-full bg-pink-500 animate-pulse shadow-[0_0_8px_rgba(236,72,153,0.6)]" />
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {(platform === 'instagram' || platform === 'tiktok') && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={handleRescrape}
                                disabled={isRescrapng}
                                title="Re-scrape Posts"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${isRescrapng ? 'animate-spin' : ''}`} />
                            </Button>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={handleReset}
                                disabled={isResetting || postsCount === 0}
                                title="Delete All Posts"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {!loading && posts.length > 0 && (
                <div className="px-4 py-2 border-b border-border/40 bg-muted/10">
                    <PostsFilter
                        sortBy={sortBy}
                        filterBy={filterBy}
                        onSortChange={setSortBy}
                        onFilterChange={setFilterBy}
                        platform={platform}
                    />
                </div>
            )}

            {/* Content Area */}
            <div className="p-4 bg-gradient-to-br from-background/50 to-muted/10">
                {content}
            </div>

            {/* Footer / Pagination hint */}
            {filteredPosts.length > 0 && !loading && (
                <div className="py-2 px-4 border-t border-border/40 bg-muted/20 text-[10px] text-center text-muted-foreground">
                    Showing {filteredPosts.length} posts
                </div>
            )}
        </div>
    );
}
