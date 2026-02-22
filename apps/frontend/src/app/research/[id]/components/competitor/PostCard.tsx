'use client';

import { Heart, MessageCircle, Eye, ExternalLink, Play, Share2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PostCardProps {
    post: {
        id: string;
        caption: string;
        likes: number;
        comments: number;
        views?: number;
        shares?: number;
        saves?: number;
        mediaUrl?: string | null;
        videoUrl?: string | null;
        isVideo: boolean;
        postUrl: string;
        timestamp: string;
        engagement?: number;
    };
    platform: 'instagram' | 'tiktok';
}

export function PostCard({ post, platform }: PostCardProps) {
    const formatNumber = (num: number) => {
        if (!num) return '0';
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return num.toLocaleString();
    };

    const isPink = platform === 'instagram';
    const accentText = isPink ? 'text-pink-500' : 'text-blue-500';

    return (
        <Card className="group relative overflow-hidden border-0 bg-secondary/20 shadow-none hover:shadow-xl hover:shadow-black/5 transition-all duration-300 hover:-translate-y-1 rounded-xl">
            {/* Thumbnail Image */}
            <div className="relative aspect-[9/16] bg-black/40 overflow-hidden">
                {post.mediaUrl ? (
                    <img
                        src={post.mediaUrl}
                        alt="Post thumbnail"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/50 bg-secondary/50 p-4">
                        <Play className="h-10 w-10 mb-2 opacity-50" />
                        <span className="text-[10px] uppercase tracking-wider font-medium">No Preview</span>
                    </div>
                )}

                {/* Video Indicator */}
                {post.isVideo && (
                    <div className="absolute top-2 right-2">
                        <div className="bg-black/40 backdrop-blur-md rounded-full p-1.5 border border-white/10">
                            <Play className="h-3 w-3 text-white fill-white" />
                        </div>
                    </div>
                )}

                {/* Platform Indicator */}
                <div className="absolute top-2 left-2">
                    <Badge variant="secondary" className={cn("text-[10px] px-1.5 h-5 bg-black/40 backdrop-blur-md border border-white/10 text-white font-medium", accentText)}>
                        {platform === 'instagram' ? 'IG' : 'TikTok'}
                    </Badge>
                </div>

                {/* Overlay Gradient on Hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                    {/* Hover Stats */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="flex flex-col items-center gap-0.5 text-white">
                            <Heart className="h-4 w-4 mb-0.5" />
                            <span className="text-[10px] font-medium">{formatNumber(post.likes)}</span>
                        </div>
                        <div className="flex flex-col items-center gap-0.5 text-white">
                            <MessageCircle className="h-4 w-4 mb-0.5" />
                            <span className="text-[10px] font-medium">{formatNumber(post.comments)}</span>
                        </div>
                        <div className="flex flex-col items-center gap-0.5 text-white">
                            <Share2 className="h-4 w-4 mb-0.5" />
                            <span className="text-[10px] font-medium">{formatNumber(post.shares || 0)}</span>
                        </div>
                    </div>

                    <a
                        href={post.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full bg-white/10 backdrop-blur-md hover:bg-white/20 text-white text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors border border-white/10"
                    >
                        <ExternalLink className="h-3 w-3" />
                        View Post
                    </a>
                </div>
            </div>

            {/* Bottom Content Area */}
            <div className="p-3 bg-secondary/10 backdrop-blur-sm border-t border-white/5">
                {/* Caption */}
                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed h-8 mb-2">
                    {post.caption || "No caption available"}
                </p>

                {/* Primary Metric - Always Visible */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
                    <span className="text-muted-foreground text-[10px]">
                        {new Date(post.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    <div className={cn("flex items-center gap-1 font-medium", accentText)}>
                        {post.views ? (
                            <>
                                <Eye className="h-3 w-3" />
                                <span>{formatNumber(post.views)}</span>
                            </>
                        ) : (
                            <>
                                <Heart className="h-3 w-3" />
                                <span>{formatNumber(post.likes)}</span>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </Card>
    );
}
