
'use client';

import { Instagram, Share2, RefreshCw, Users } from 'lucide-react';
import { DataSourceSection } from './DataSourceSection';
import { InstagramSection } from './InstagramSection';
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
        <div className="border border-border/50 rounded-lg p-4 bg-card/30">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/5 rounded-md text-primary">
                        <Icon className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-sm">{label}</h3>
                        <p className="text-xs text-muted-foreground">
                            {posts.length} scraped items • {profile?.follower_count ? `${(profile.follower_count / 1000).toFixed(1)}K` : '0'} followers
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => handleRun(platform)}
                    disabled={running[platform]}
                    className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
                        running[platform]
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-background hover:bg-muted text-primary border-border"
                    )}
                >
                    <RefreshCw className={cn("h-3.5 w-3.5", running[platform] && "animate-spin")} />
                    {running[platform] ? 'Scraping...' : 'Run Scraper'}
                </button>
            </div>

            <InstagramSection
                platform={platform as 'instagram' | 'tiktok'}
                profile={{
                    handle: profile?.handle || (platform === 'instagram' ? client.handle : client.platformHandles?.tiktok) || `${platform}_user`,
                    bio: profile?.bio || (platform === 'instagram' ? client.businessOverview : '') || '',
                    followerCount: profile?.followers || profile?.follower_count || 0,
                    followingCount: profile?.following || profile?.following_count || 0,
                    profileImageUrl: profile?.profileImageUrl
                }}
                posts={posts}
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
