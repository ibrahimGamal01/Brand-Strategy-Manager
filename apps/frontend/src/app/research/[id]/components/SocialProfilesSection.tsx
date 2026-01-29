
'use client';

import { Instagram, Share2, RefreshCw, Users } from 'lucide-react';
import { DataSourceSection } from './DataSourceSection';
import { PostsGridWithRanking } from './PostsGridWithRanking';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface SocialProfilesSectionProps {
    client: any;
    data: {
        clientPosts: any[];
        socialProfiles: any[];
    };
    onRerun: (scraper: string) => Promise<void>;
}

export function SocialProfilesSection({ client, data, onRerun }: SocialProfilesSectionProps) {
    const [running, setRunning] = useState<Record<string, boolean>>({});

    const handleRun = async (platform: string) => {
        setRunning(prev => ({ ...prev, [platform]: true }));
        try {
            await onRerun(platform);
        } finally {
            setRunning(prev => ({ ...prev, [platform]: false }));
        }
    };

    // Helper to find profile data
    const getProfile = (platform: string) => {
        return data.socialProfiles?.find((p: any) => p.platform === platform) ||
            (platform === 'instagram' ?
                data.socialProfiles?.find((p: any) => p.platform === 'instagram') : undefined);
    };

    const instagramProfile = getProfile('instagram');
    const tiktokProfile = getProfile('tiktok');

    // Posts filtering
    // Actually, clientPosts is a mix. We should filter by platform if possible.
    // In our case, backend might not be setting 'platform' field on ClientPost explicitly?
    // Looking at schema, ClientPost relates to ClientAccount.
    // But here we are using a flat `clientPosts` array in the props.
    // Let's rely on the URL checks or 'GraphImage'/'GraphVideo' typename which is Instagram specific.

    const isInstagramPost = (p: any) => {
        return p.postUrl?.includes('instagram.com') || p.typename?.startsWith('Graph') || (!p.url?.includes('tiktok') && !p.postUrl?.includes('tiktok'));
    };

    const isTikTokPost = (p: any) => {
        return p.url?.includes('tiktok.com') || p.postUrl?.includes('tiktok.com');
    };

    const filteredInstaPosts = data.clientPosts.filter(isInstagramPost);

    // Fix: Read from socialProfile.posts first for Scraped Data, fallback to clientPosts
    // This ensures the 30 scraped items show up even if not in clientPosts flat list
    const tiktokPosts = (tiktokProfile?.posts && tiktokProfile.posts.length > 0)
        ? tiktokProfile.posts
        : data.clientPosts.filter(isTikTokPost);

    const ProfileBlock = ({ platform, icon: Icon, profile, posts, label }: any) => (
        <div className="border border-border/50 rounded-lg p-6 bg-card/30">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-primary/10 rounded-lg text-primary">
                        <Icon className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-lg">{label}</h3>
                        <p className="text-sm text-muted-foreground">
                            @{profile?.handle || `${platform}_user`} • {(profile?.followers || profile?.follower_count || 0).toLocaleString()} followers
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => handleRun(platform)}
                    disabled={running[platform]}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border transition-colors",
                        running[platform]
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-background hover:bg-muted text-primary border-border"
                    )}
                >
                    <RefreshCw className={cn("h-4 w-4", running[platform] && "animate-spin")} />
                    {running[platform] ? 'Scraping...' : 'Run Scraper'}
                </button>
            </div>

            {/* Profile Info Bar */}
            {profile && (
                <div className="flex items-center gap-4 mb-6 p-4 bg-muted/30 rounded-lg border">
                    <div className="flex-1">
                        <p className="text-sm text-muted-foreground line-clamp-2">
                            {profile.bio || 'No bio available'}
                        </p>
                    </div>
                    <div className="flex gap-4 text-sm">
                        <div className="text-center">
                            <div className="font-bold">{(profile.followers || 0).toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">Followers</div>
                        </div>
                        <div className="text-center">
                            <div className="font-bold">{(profile.following || 0).toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">Following</div>
                        </div>
                        <div className="text-center">
                            <div className="font-bold">{posts.length}</div>
                            <div className="text-xs text-muted-foreground">Posts</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Enhanced Posts Grid with Ranking */}
            <PostsGridWithRanking
                posts={posts.map((p: any) => ({
                    id: p.id,
                    caption: p.caption,
                    likesCount: p.likes || p.likesCount || 0,
                    commentsCount: p.comments || p.commentsCount || 0,
                    sharesCount: p.sharesCount || 0,
                    viewsCount: p.viewsCount || p.playsCount || 0,
                    playsCount: p.playsCount || 0,
                    postUrl: p.postUrl || p.url,
                    url: p.url,
                    postedAt: p.postedAt,
                    thumbnailUrl: p.thumbnailUrl,
                    mediaAssets: p.mediaAssets
                }))}
                followerCount={profile?.followers || profile?.follower_count || 0}
                platform={platform as 'instagram' | 'tiktok'}
            />
        </div>
    );

    return (
        <DataSourceSection
            title="Social Profiles"
            icon={Users}
            count={filteredInstaPosts.length + tiktokPosts.length}
            defaultOpen={true}
            rawData={{ instagram: { profile: instagramProfile, posts: filteredInstaPosts }, tiktok: { profile: tiktokProfile, posts: tiktokPosts } }}
        >
            <div className="space-y-6">
                <ProfileBlock
                    platform="instagram"
                    icon={Instagram}
                    profile={instagramProfile}
                    posts={filteredInstaPosts}
                    label="Instagram"
                />

                <ProfileBlock
                    platform="tiktok"
                    icon={Share2}
                    profile={tiktokProfile}
                    posts={tiktokPosts}
                    label="TikTok"
                />
            </div>
        </DataSourceSection>
    );
}
