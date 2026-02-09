'use client';

import { Clock, Heart, Activity, Grid, Video, ImageIcon, LayoutList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

interface PostsFilterProps {
    sortBy: 'latest' | 'likes' | 'engagement';
    filterBy: 'all' | 'videos' | 'images';
    onSortChange: (value: 'latest' | 'likes' | 'engagement') => void;
    onFilterChange: (value: 'all' | 'videos' | 'images') => void;
    platform: 'instagram' | 'tiktok';
}

export function PostsFilter({
    sortBy,
    filterBy,
    onSortChange,
    onFilterChange,
    platform,
}: PostsFilterProps) {
    const isPink = platform === 'instagram';
    const activeBg = isPink ? 'bg-pink-500/10 text-pink-500 hover:bg-pink-500/20' : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20';
    const activeBorder = isPink ? 'border-pink-500/20' : 'border-blue-500/20';

    return (
        <div className="flex items-center gap-3 bg-secondary/30 p-1 rounded-lg border border-border/40">
            {/* Filter Group */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onFilterChange('all')}
                    className={cn(
                        "h-7 px-2.5 text-[10px] gap-1.5 rounded-md transition-all",
                        filterBy === 'all'
                            ? cn("font-medium border", activeBg, activeBorder)
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Grid className="h-3 w-3" />
                    All
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onFilterChange('videos')}
                    className={cn(
                        "h-7 px-2.5 text-[10px] gap-1.5 rounded-md transition-all",
                        filterBy === 'videos'
                            ? cn("font-medium border", activeBg, activeBorder)
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Video className="h-3 w-3" />
                    Videos
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onFilterChange('images')}
                    className={cn(
                        "h-7 px-2.5 text-[10px] gap-1.5 rounded-md transition-all",
                        filterBy === 'images'
                            ? cn("font-medium border", activeBg, activeBorder)
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <ImageIcon className="h-3 w-3" />
                    Images
                </Button>
            </div>

            <Separator orientation="vertical" className="h-4 bg-border/50" />

            {/* Sort Group */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSortChange('latest')}
                    className={cn(
                        "h-7 w-7 p-0 rounded-md transition-all",
                        sortBy === 'latest'
                            ? cn(activeBg, activeBorder, "border")
                            : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Latest"
                >
                    <Clock className="h-3.5 w-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSortChange('likes')}
                    className={cn(
                        "h-7 w-7 p-0 rounded-md transition-all",
                        sortBy === 'likes'
                            ? cn(activeBg, activeBorder, "border")
                            : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Most Likes"
                >
                    <Heart className="h-3.5 w-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSortChange('engagement')}
                    className={cn(
                        "h-7 w-7 p-0 rounded-md transition-all",
                        sortBy === 'engagement'
                            ? cn(activeBg, activeBorder, "border")
                            : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Best Engagement"
                >
                    <Activity className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}
