'use client';

import { useState } from 'react';
import { ExternalLink, Video as VideoIcon, Play, Eye, Clock, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface VideoResult {
    id: string;
    title: string;
    description?: string | null;
    url: string;
    embedUrl?: string | null;
    duration?: string | null;
    publisher?: string | null;
    uploader?: string | null;
    viewCount?: number | null;
    thumbnailUrl?: string | null;
    publishedAt?: string | null;
    isDownloaded?: boolean;
}

interface VideoGalleryProps {
    videos: VideoResult[];
    emptyMessage?: string;
}

export function VideoGallery({ videos, emptyMessage = "No videos found" }: VideoGalleryProps) {
    const [displayCount, setDisplayCount] = useState(12);
    const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(new Set());

    const handleThumbnailError = (videoId: string) => {
        setThumbnailErrors(prev => new Set([...prev, videoId]));
    };

    const formatNumber = (num: number) => {
        if (!num) return '0';
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return num.toLocaleString();
    };

    const formatRelativeTime = (dateString?: string | null) => {
        if (!dateString) return null;
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffInMs = now.getTime() - date.getTime();
            const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

            if (diffInDays === 0) return 'Today';
            if (diffInDays === 1) return 'Yesterday';
            if (diffInDays < 7) return `${diffInDays} days ago`;
            if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
            if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months ago`;
            return `${Math.floor(diffInDays / 365)} years ago`;
        } catch {
            return null;
        }
    };

    const displayedVideos = videos.slice(0, displayCount);
    const hasMore = videos.length > displayCount;

    if (videos.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/30 text-muted-foreground">
                <VideoIcon className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between bg-secondary/20 p-3 rounded-lg border border-border/50">
                <div className="flex items-center gap-2">
                    <VideoIcon className="h-4 w-4 text-blue-500" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Video Results
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 ml-1">
                        {videos.length}
                    </Badge>
                </div>
            </div>

            {/* Videos Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {displayedVideos.map((video) => {
                    const hasThumbnailError = thumbnailErrors.has(video.id);
                    const relativeTime = formatRelativeTime(video.publishedAt);

                    return (
                        <Card
                            key={video.id}
                            className="group relative overflow-hidden border-0 bg-secondary/20 shadow-none hover:shadow-xl hover:shadow-black/5 transition-all duration-300 hover:-translate-y-1 rounded-xl"
                        >
                            {/* Video Thumbnail */}
                            <div className="relative aspect-video bg-black/40 overflow-hidden">
                                {!hasThumbnailError && video.thumbnailUrl ? (
                                    <img
                                        src={video.thumbnailUrl}
                                        alt={video.title}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        onError={() => handleThumbnailError(video.id)}
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/50 bg-secondary/50 p-4">
                                        <VideoIcon className="h-10 w-10 mb-2 opacity-50" />
                                        <span className="text-[10px] uppercase tracking-wider font-medium">No Preview</span>
                                    </div>
                                )}

                                {/* Play Icon Overlay */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="bg-black/60 backdrop-blur-sm rounded-full p-4 border border-white/20 group-hover:scale-110 group-hover:bg-black/80 transition-all duration-300">
                                        <Play className="h-6 w-6 text-white fill-white" />
                                    </div>
                                </div>

                                {/* Duration Badge */}
                                {video.duration && (
                                    <div className="absolute bottom-2 right-2">
                                        <Badge variant="secondary" className="text-[9px] px-1.5 h-4 bg-black/60 backdrop-blur-md border border-white/10 text-white font-medium flex items-center gap-1">
                                            <Clock className="h-2.5 w-2.5" />
                                            {video.duration}
                                        </Badge>
                                    </div>
                                )}

                                {/* Publisher Badge */}
                                {video.publisher && (
                                    <div className="absolute top-2 left-2">
                                        <Badge
                                            variant="secondary"
                                            className={cn(
                                                "text-[10px] px-1.5 h-5 backdrop-blur-md border border-white/10 text-white font-medium",
                                                video.publisher.toLowerCase().includes('youtube')
                                                    ? "bg-red-500/80"
                                                    : "bg-blue-500/80"
                                            )}
                                        >
                                            {video.publisher}
                                        </Badge>
                                    </div>
                                )}

                                {/* Hover Overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                                    <a
                                        href={video.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full bg-white/10 backdrop-blur-md hover:bg-white/20 text-white text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors border border-white/10"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                        Watch Video
                                    </a>
                                </div>
                            </div>

                            {/* Bottom Content */}
                            <div className="p-3 bg-secondary/10 backdrop-blur-sm border-t border-white/5">
                                {/* Title */}
                                <p className="text-[11px] font-medium text-foreground line-clamp-2 leading-relaxed h-9 mb-2">
                                    {video.title || "Untitled Video"}
                                </p>

                                {/* Uploader */}
                                {video.uploader && (
                                    <p className="text-[10px] text-muted-foreground truncate mb-2">
                                        {video.uploader}
                                    </p>
                                )}

                                {/* Stats Row */}
                                <div className="flex items-center justify-between pt-1.5 border-t border-white/5">
                                    {relativeTime && (
                                        <span className="text-muted-foreground text-[9px]">
                                            {relativeTime}
                                        </span>
                                    )}
                                    {video.viewCount !== null && video.viewCount !== undefined && (
                                        <div className="flex items-center gap-1 text-blue-500 font-medium text-[10px]">
                                            <Eye className="h-3 w-3" />
                                            <span>{formatNumber(video.viewCount)}</span>
                                        </div>
                                    )}
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
                        Load More ({videos.length - displayCount} remaining)
                    </Button>
                </div>
            )}
        </div>
    );
}
