
'use client';

import { Instagram, Share2, RefreshCw, Users } from 'lucide-react';
import { DataSection } from './data/DataSection';
import { DataCard } from './data/DataCard';
import { socialProfileSchema } from './data/schemas/social-profiles.schema';
import { useDataCrud } from '../hooks/useDataCrud';
import { PostsGridWithRanking } from './PostsGridWithRanking';
import { useState } from 'react';
import { useParams } from 'next/navigation'; // To get jobId if not in props

interface SocialProfilesSectionProps {
    data: {
        clientPosts: any[];
        socialProfiles: any[];
    };
    onRerun: (scraper: string) => Promise<void>;
}

export function SocialProfilesSection({ data, onRerun }: SocialProfilesSectionProps) {
    const params = useParams();
    const jobId = params.id as string;
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

    const {
        updateItem: updateProfile,
        deleteItem: deleteProfile
    } = useDataCrud({ jobId, dataType: 'social-profiles' });

    const ProfileBlock = ({ platform, icon: Icon, profile, posts, label }: any) => {
        if (!profile) return null;

        return (
            <div className="border border-border/50 rounded-lg p-6 bg-card/30">
                <div className="mb-6">
                    <DataCard
                        data={profile}
                        schema={socialProfileSchema}
                        title={`${label} Profile`}
                        icon={Icon}
                        onEdit={updateProfile}
                        onDelete={deleteProfile}
                        actions={[
                            {
                                label: running[platform] ? 'Scraping...' : 'Run Scraper',
                                icon: RefreshCw,
                                onClick: () => handleRun(platform)
                            }
                        ]}
                        defaultExpanded={true}
                    />
                </div>

                {/* Enhanced Posts Grid with Ranking */}
                <div className="mt-4">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold text-muted-foreground">Recent Posts ({posts.length})</h4>
                    </div>
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
            </div>
        );
    };

    return (
        <DataSection // Using generic DataSection now
            title="Social Profiles"
            icon={Users}
            count={filteredInstaPosts.length + tiktokPosts.length}
            defaultExpanded={true}
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
        </DataSection>
    );
}
