'use client';

import { useState, useMemo } from 'react';
import { PostCard } from './PostCard';
import { PostsFilter } from './PostsFilter';
import { LayoutList, Grid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface Post {
    id: string;
    caption: string;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    postUrl: string;
    mediaUrl: string | null;
    videoUrl: string | null;
    isVideo: boolean;
    timestamp: string;
    engagement: number;
    platform?: 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'linkedin' | 'twitter';
}

interface PostsGalleryProps {
    posts: Post[];
    platform?: 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'linkedin' | 'twitter';
    title?: string;
    emptyMessage?: string;
}

export function PostsGallery({
    posts,
    platform = 'instagram',
    title = "Post Gallery",
    emptyMessage = "No posts found"
}: PostsGalleryProps) {
    const [filterBy, setFilterBy] = useState<'all' | 'videos' | 'images'>('all');
    const [sortBy, setSortBy] = useState<'latest' | 'likes' | 'engagement'>('latest');

    // Filter and Sort Logic
    const filteredPosts = useMemo(() => {
        let result = [...posts];

        // Filter
        if (filterBy === 'videos') {
            result = result.filter(p => p.isVideo);
        } else if (filterBy === 'images') {
            result = result.filter(p => !p.isVideo);
        }

        // Sort
        result.sort((a, b) => {
            if (sortBy === 'latest') {
                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            }
            if (sortBy === 'likes') {
                return b.likes - a.likes;
            }
            if (sortBy === 'engagement') {
                return b.engagement - a.engagement;
            }
            return 0;
        });

        return result;
    }, [posts, filterBy, sortBy]);

    const isPink = platform === 'instagram';
    const accentColor = isPink ? 'text-pink-500' : 'text-blue-500';

    if (posts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/30 text-muted-foreground">
                <LayoutList className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header with Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-secondary/20 p-3 rounded-lg border border-border/50">
                <div className="flex items-center gap-2">
                    <Grid className={cn("h-4 w-4", accentColor)} />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {title}
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 ml-1">
                        {posts.length}
                    </Badge>
                </div>

                <PostsFilter
                    sortBy={sortBy}
                    filterBy={filterBy}
                    onSortChange={setSortBy}
                    onFilterChange={setFilterBy}
                    platform={platform === 'tiktok' ? 'tiktok' : 'instagram'}
                />
            </div>

            {/* Posts Grid */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar`}>
                {filteredPosts.length > 0 ? (
                    filteredPosts.map((post) => (
                        <PostCard
                            key={post.id}
                            post={post}
                            platform={(post.platform === 'tiktok' ? 'tiktok' : 'instagram')}
                        />
                    ))
                ) : (
                    <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                        Currently no posts match your filters.
                    </div>
                )}
            </div>
        </div>
    );
}
