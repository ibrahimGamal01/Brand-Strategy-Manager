'use client';

import { Instagram, Heart, MessageCircle, Users, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { toMediaUrl } from '@/lib/media-url';

interface Post {
    id: string;
    caption: string;
    likes: number;
    comments: number;
    postUrl?: string;
    url?: string;
    postedAt: string;
    thumbnailUrl?: string; // New field
    mediaAssets?: Array<{
        thumbnailPath?: string;
        blobStoragePath?: string;
        originalUrl?: string;
    }>;
}

interface InstagramSectionProps {
    profile: {
        handle: string;
        bio: string;
        followerCount: number;
        followingCount: number;
        profileImageUrl?: string;
    };
    posts: Post[];
    platform?: 'instagram' | 'tiktok';
    profileId?: string; // NEW: For API operations
    onDataReset?: () => void; // NEW: Callback after reset
    onRescrape?: () => void; // NEW: Callback after re-scrape
}

export function InstagramSection({ profile, posts, platform = 'instagram', profileId, onDataReset, onRescrape }: InstagramSectionProps) {
    const [isResetting, setIsResetting] = useState(false);
    const [isRescrapng, setIsRescrapng] = useState(false);
    const { toast } = useToast();


    const isInsta = platform === 'instagram';
    const profileUrl = isInsta
        ? `https://instagram.com/${profile.handle}`
        : `https://tiktok.com/@${profile.handle.replace('@', '')}`; // Ensure @ for URL if needed or not

    const gradientClass = isInsta
        ? "from-purple-500/10 to-pink-500/10 border-purple-500/20"
        : "from-black/10 to-teal-500/10 border-teal-500/20";

    const iconBgClass = isInsta
        ? "bg-gradient-to-br from-purple-500 to-pink-500"
        : "bg-black border border-gray-800";

    // Handler for reset section
    const handleReset = async () => {
        if (!profileId) return;
        if (!confirm(`Are you sure you want to delete all ${posts.length} posts for @${profile.handle}? This cannot be undone.`)) {
            return;
        }

        setIsResetting(true);
        try {
            const response = await fetch(`/api/instagram/profile/${profileId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete profile data');
            }

            const result = await response.json();
            toast({
                title: 'Section reset',
                description: `Deleted ${result.deletedCount || 0} posts for @${profile.handle}.`,
            });

            // Trigger parent callback to refresh data
            onDataReset?.();
        } catch (error: any) {
            toast({
                title: 'Failed to reset section',
                description: error?.message || 'Unable to delete profile data.',
                variant: 'destructive',
            });
        } finally {
            setIsResetting(false);
        }
    };

    // Handler for re-scrape
    const handleRescrape = async () => {
        if (!profileId) return;

        setIsRescrapng(true);
        try {
            const response = await fetch(`/api/instagram/scrape/${profileId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postsLimit: 30 })
            });

            if (!response.ok) {
                throw new Error('Failed to re-scrape profile');
            }

            const result = await response.json();
            toast({
                title: 'Re-scrape started',
                description: `Queued @${profile.handle} (${result.scraper || 'scraper'}).`,
            });

            // Trigger parent callback to refresh data
            onRescrape?.();
        } catch (error: any) {
            toast({
                title: 'Failed to re-scrape profile',
                description: error?.message || 'Unable to start re-scrape.',
                variant: 'destructive',
            });
        } finally {
            setIsRescrapng(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Profile Header */}
            <div className={`flex items-start gap-4 p-4 bg-gradient-to-r ${gradientClass} rounded-lg border`}>
                <div className={`w-16 h-16 rounded-full ${iconBgClass} flex items-center justify-center overflow-hidden shrink-0`}>
                    {profile.profileImageUrl ? (
                        <img src={profile.profileImageUrl} alt={profile.handle} className="w-full h-full object-cover" />
                    ) : (
                        <div className="text-white">
                            {isInsta ? <Instagram className="h-8 w-8" /> : (
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="h-8 w-8"
                                >
                                    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
                                </svg>
                            )}
                            {/* Standard Lucide Share2 is not TikTok logo. Using basic path or just generic icon if cleaner */}
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg truncate">@{profile.handle}</h3>
                        <a
                            href={profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline shrink-0"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line line-clamp-3">{profile.bio}</p>
                    <div className="flex items-center gap-4 mt-3">
                        <div className="flex items-center gap-1.5">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-semibold">{(profile.followerCount || 0).toLocaleString()}</span>
                            <span className="text-xs text-muted-foreground">followers</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {(profile.followingCount || 0).toLocaleString()} following
                        </div>
                    </div>

                    {/* Control Buttons */}
                    {profileId && (
                        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/40">
                            <Button
                                onClick={handleRescrape}
                                disabled={isRescrapng}
                                size="sm"
                                variant="default"
                                className="text-xs h-8 gap-1.5 flex-1"
                            >
                                <RefreshCw className={`h-3 w-3 ${isRescrapng ? 'animate-spin' : ''}`} />
                                {isRescrapng ? 'Re-scraping...' : 'Re-scrape Posts'}
                            </Button>
                            <Button
                                onClick={handleReset}
                                disabled={isResetting}
                                size="sm"
                                variant="destructive"
                                className="text-xs h-8 gap-1.5"
                            >
                                <Trash2 className="h-3 w-3" />
                                {isResetting ? 'Deleting...' : 'Reset'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Posts Grid */}
            <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Recent Posts ({posts.length})</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {posts.map((post) => {
                        // Priority: Local Video > Local Image > Thumbnail URL > Original URL
                        const localVideo = post.mediaAssets?.find(m => m.blobStoragePath?.endsWith('.mp4') || m.blobStoragePath?.endsWith('.webm'));
                        const localImage = post.mediaAssets?.find(m => !m.blobStoragePath?.endsWith('.mp4') && !m.blobStoragePath?.endsWith('.webm'));

                        let mediaSrc = post.thumbnailUrl || post.url;
                        let isVideo = false;

                        if (localVideo?.blobStoragePath) {
                            mediaSrc = toMediaUrl(localVideo.blobStoragePath);
                            isVideo = true;
                        } else if (localImage?.blobStoragePath) {
                            mediaSrc = toMediaUrl(localImage.blobStoragePath);
                        } else if (post.thumbnailUrl) {
                            mediaSrc = post.thumbnailUrl;
                        }

                        // Fallback logic for "isVideo" if no local asset but URL looks like video (unlikely for TikTok CDN usually)
                        if (!isVideo && (mediaSrc?.includes('.mp4') || mediaSrc?.includes('.webm'))) {
                            isVideo = true;
                        }

                        return (
                            <div key={post.id} className="group border rounded-lg bg-card overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-all">
                                {/* Media Section */}
                                <div className="aspect-[9/16] bg-black relative">
                                    {mediaSrc ? (
                                        isVideo ? (
                                            <video
                                                src={mediaSrc}
                                                className="w-full h-full object-cover"
                                                controls // User asked for the video, controls help
                                                preload="metadata"
                                                playsInline
                                            />
                                        ) : (
                                            <img
                                                src={mediaSrc}
                                                alt={post.caption?.slice(0, 50)}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        )
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center bg-muted text-muted-foreground gap-2">
                                            {isInsta ? <Instagram className="h-8 w-8" /> : <div className="font-bold">TIKTOK</div>}
                                            <span className="text-xs">No media</span>
                                        </div>
                                    )}
                                </div>

                                {/* Metadata & Content */}
                                <div className="p-3 flex flex-col gap-2 flex-1">
                                    {/* Stats Row */}
                                    <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
                                        <div className="flex items-center gap-3">
                                            <span className="flex items-center gap-1">
                                                <Heart className="h-3 w-3" /> {post.likes?.toLocaleString() || 0}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <MessageCircle className="h-3 w-3" /> {post.comments?.toLocaleString() || 0}
                                            </span>
                                        </div>
                                        <span className="text-[10px]">{new Date(post.postedAt).toLocaleDateString()}</span>
                                    </div>

                                    {/* Caption */}
                                    <p className="text-xs line-clamp-2 text-foreground/80 flex-1" title={post.caption}>
                                        {post.caption || 'No caption'}
                                    </p>

                                    {/* Action Button */}
                                    <a
                                        href={post.postUrl || post.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-auto flex items-center justify-center gap-2 w-full py-2 bg-secondary/50 hover:bg-secondary text-xs font-medium rounded-md transition-colors"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                        See Post
                                    </a>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {posts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No posts scraped yet</p>
            )}
        </div>
    );
}
