'use client';

import { useState } from 'react';
import {
    Instagram, Video, Users, MessageSquare, PlayCircle, ExternalLink, RefreshCw, Trash2, Brain
} from 'lucide-react';
import { TreeNodeCard } from './TreeNodeCard';
import { PostsGridWithRanking } from '../PostsGridWithRanking';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';

interface SocialProfileNodeProps {
    jobId?: string;
    profile: any;
    index: number;
    onRefreshSection?: (section: string) => void;
}

function displayHandle(handle: string | undefined, platform: string): string {
    if (!handle) return '';
    const h = handle.trim();
    const ig = h.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
    if (ig) return ig[1];
    const tt = h.match(/tiktok\.com\/@?([a-z0-9._]{2,30})/i);
    if (tt) return tt[1];
    return h.replace(/^@+/, '').trim();
}

export function SocialProfileNode({ jobId, profile, index, onRefreshSection }: SocialProfileNodeProps) {
    const { toast } = useToast();
    const [analyzing, setAnalyzing] = useState(false);
    const handleDisplay = displayHandle(profile.handle, profile.platform || '') || profile.handle || '';

    // Determine Icon and Color based on platform
    let ProfileIcon = ExternalLink;
    let iconColor = "text-muted-foreground";
    let platformName = profile.platform || 'Unknown';
    const platformKey = profile.platform?.toLowerCase();

    switch (platformKey) {
        case 'instagram':
            ProfileIcon = Instagram;
            iconColor = "text-pink-500";
            break;
        case 'tiktok':
            ProfileIcon = Video;
            iconColor = "text-pink-500"; // Matching the pink accent used in ClientInfoNode for TikTok posts
            platformName = 'TikTok'; // Force proper capitalization
            break;
        case 'youtube':
            ProfileIcon = PlayCircle;
            iconColor = "text-red-500";
            break;
        case 'linkedin':
            ProfileIcon = Users;
            iconColor = "text-blue-700";
            break;
        case 'facebook':
            ProfileIcon = Users;
            iconColor = "text-blue-600";
            break;
        case 'twitter':
        case 'x':
            ProfileIcon = MessageSquare;
            iconColor = "text-sky-500";
            break;
        default:
            break;
    }

    const followers = profile.followers ?? profile.followerCount ?? 0;
    const followersLabel = followers > 0 ? `${followers.toLocaleString()} followers` : '— followers';

    // Prepare title with badges
    const richTitle = (
        <div className="flex items-center gap-2 w-full">
            <span className="font-semibold capitalize">{platformName === 'TikTok' ? 'TikTok' : platformName} Profile</span>
            <span className="text-muted-foreground font-normal text-xs invisible group-hover:visible ml-auto mr-2 md:visible md:ml-0 md:mr-0 md:inline-block">
                @{handleDisplay}
            </span>
            <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 bg-background", iconColor)}>
                {followersLabel}
            </Badge>
        </div>
    );

    const posts = profile.posts || [];

    // Action handlers
    const isPlaceholder = typeof profile.id === 'string' && profile.id.startsWith('placeholder-');
    const handleScrape = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!['instagram', 'tiktok'].includes(platformKey)) return;

        try {
            if (isPlaceholder && jobId && profile.handle) {
                await apiClient.scrapeClientProfile(jobId, platformKey, profile.handle);
                toast({ title: "Re-scraping started", description: `Refreshing ${platformName} posts...` });
                setTimeout(() => onRefreshSection?.('social-profiles'), 3000);
                return;
            }

            const endpoint = platformKey === 'instagram'
                ? `/api/instagram/scrape/${profile.id}`
                : `/api/tiktok/scrape/${profile.id}`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postsLimit: 30 }),
            });

            if (response.ok) {
                toast({ title: "Re-scraping started", description: `Refreshing ${platformName} posts...` });
                setTimeout(() => onRefreshSection?.('social-profiles'), 3000);
            } else {
                const errorText = await response.text();
                if (response.status === 501) {
                    toast({ title: "Feature Pending", description: "TikTok re-scraping is coming soon.", variant: "default" });
                } else {
                    toast({ title: "Re-scrape failed", description: errorText, variant: "destructive" });
                }
            }
        } catch (error: any) {
            toast({ title: "Re-scrape failed", description: error.message, variant: "destructive" });
        }
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const confirmed = confirm(`Delete all posts for @${profile.handle}? This cannot be undone.`);
        if (!confirmed) return;

        try {
            const endpoint = platformKey === 'instagram'
                ? `/api/instagram/profile/${profile.id}`
                : `/api/tiktok/profile/${profile.id}`;

            const response = await fetch(endpoint, {
                method: 'DELETE'
            });

            if (response.ok) {
                toast({ title: "Profile reset", description: "All posts deleted" });
                setTimeout(() => onRefreshSection?.('social-profiles'), 1000);
            } else {
                toast({ title: "Delete failed", description: await response.text(), variant: "destructive" });
            }
        } catch (error: any) {
            toast({ title: "Delete failed", description: error.message, variant: "destructive" });
        }
    };

    return (
        <TreeNodeCard
            key={`${profile.platform}-${index}`}
            title={richTitle}
            icon={<ProfileIcon className={cn("h-4 w-4", iconColor)} />}
            level={2}
            defaultExpanded={false}
            actions={
                <div className="flex items-center gap-1">
                    <a
                        href={profile.url || `https://${profile.platform}.com/${profile.handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors p-1 hover:bg-muted rounded-md"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <ExternalLink className="h-3 w-3" />
                    </a>

                    {/* Only show actions for supported platforms */}
                    {['instagram', 'tiktok'].includes(platformKey) && (
                        <>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleScrape}
                                className="h-7 text-xs px-2"
                                title="Re-scrape Profile"
                            >
                                <RefreshCw className="h-3 w-3" />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleDelete}
                                className="h-7 text-xs px-2 text-destructive hover:text-destructive"
                                title="Delete All Data"
                            >
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </>
                    )}
                </div>
            }
        >
            <div className="space-y-4 px-4 py-3">
                {/* Profile Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Handle</span>
                        <span className="text-sm font-medium select-all">@{profile.handle}</span>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Following</span>
                        <span className="text-sm font-medium tabular-nums">{profile.following?.toLocaleString() || 'N/A'}</span>
                    </div>
                </div>

                {profile.bio && (
                    <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded-lg border border-border/40 leading-relaxed">
                        <span className="font-semibold text-foreground mr-1">Bio:</span>
                        {profile.bio}
                    </div>
                )}

                {/* Posts Grid with Ranking and Metrics */}
                {posts.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border/40">
                        {jobId && (
                            <div className="flex justify-end mb-3">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    disabled={analyzing}
                                    onClick={async () => {
                                        setAnalyzing(true);
                                        try {
                                            const res = await apiClient.analyzeJobMedia(jobId, { skipAlreadyAnalyzed: true });
                                            toast({
                                                title: 'Analysis complete',
                                                description: `Analyzed ${res.succeeded} media asset(s).${res.failed ? ` ${res.failed} failed.` : ''}`,
                                            });
                                            onRefreshSection?.('social-profiles');
                                        } catch (e: any) {
                                            toast({
                                                title: 'Analysis failed',
                                                description: e?.message || 'Could not run AI analysis.',
                                                variant: 'destructive',
                                            });
                                        } finally {
                                            setAnalyzing(false);
                                        }
                                    }}
                                >
                                    <Brain className="h-3.5 w-3.5" />
                                    {analyzing ? 'Analyzing…' : 'Analyze with AI'}
                                </Button>
                            </div>
                        )}
                        <PostsGridWithRanking
                            posts={posts.map((p: any) => ({
                                id: p.id,
                                caption: p.caption,
                                likesCount: p.likes || p.likesCount || 0,
                                commentsCount: p.comments || p.commentsCount || 0,
                                sharesCount: p.shares || p.sharesCount || 0,
                                viewsCount: p.views || p.viewsCount || p.playsCount || 0,
                                playsCount: p.plays || p.playsCount || 0,
                                postUrl: p.postUrl || p.url,
                                url: p.postUrl || p.url,
                                postedAt: p.postedAt || p.timestamp || new Date().toISOString(),
                                thumbnailUrl: p.thumbnailUrl,
                                mediaAssets: p.mediaAssets
                            }))}
                            followerCount={profile.followers || 0}
                            platform={profile.platform?.toLowerCase() || 'instagram'}
                        />
                    </div>
                )}
            </div>
        </TreeNodeCard>
    );
}
