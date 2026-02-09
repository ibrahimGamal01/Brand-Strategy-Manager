'use client';

import { User, Instagram, Video } from 'lucide-react';
import { DataCard } from './DataCard';
import { Badge } from '@/components/ui/badge';
import { PostsGridWithRanking } from '../PostsGridWithRanking';

interface SocialProfile {
    platform: string;
    handle: string;
    followers?: number;
    following?: number;
    bio?: string;
    profileImageUrl?: string;
}

interface ClientDataCardProps {
    client: any;
    socialProfiles: SocialProfile[];
    instagramPosts?: any[];
    tiktokPosts?: any[];
    className?: string;
}

/**
 * ClientDataCard - Card showing client's social profiles and posts
 */
export function ClientDataCard({
    client,
    socialProfiles,
    instagramPosts = [],
    tiktokPosts = [],
    className = ''
}: ClientDataCardProps) {
    const instagramProfile = socialProfiles.find(p => p.platform === 'instagram');
    const tiktokProfile = socialProfiles.find(p => p.platform === 'tiktok');

    return (
        <DataCard
            title="Client Data"
            icon={User}
            count={socialProfiles.length}
            defaultExpanded={true}
            className={className}
        >
            <div className="space-y-6">
                {/* Client Info */}
                <div className="pb-3 border-b">
                    <h4 className="font-semibold text-sm mb-1">{client.name}</h4>
                    {client.handle && (
                        <p className="text-xs text-muted-foreground">@{client.handle}</p>
                    )}
                </div>

                {/* Instagram Profile */}
                {instagramProfile && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Instagram className="h-4 w-4 text-pink-500" />
                            <span className="font-medium text-sm">Instagram</span>
                        </div>
                        <div className="ml-6 space-y-1 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Handle:</span>
                                <span className="font-medium">@{instagramProfile.handle}</span>
                            </div>
                            {instagramProfile.followers !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Followers:</span>
                                    <span className="font-medium">
                                        {instagramProfile.followers.toLocaleString()}
                                    </span>
                                </div>
                            )}
                            {instagramProfile.following !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Following:</span>
                                    <span className="font-medium">
                                        {instagramProfile.following.toLocaleString()}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Instagram Posts with Ranking */}
                        {instagramPosts.length > 0 && (
                            <div className="mt-4 pt-4 border-t">
                                <PostsGridWithRanking
                                    posts={instagramPosts.map((p: any) => ({
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
                                    followerCount={instagramProfile.followers || 0}
                                    platform="instagram"
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* TikTok Profile */}
                {tiktokProfile && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Video className="h-4 w-4 text-blue-500" />
                            <span className="font-medium text-sm">TikTok</span>
                        </div>
                        <div className="ml-6 space-y-1 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Handle:</span>
                                <span className="font-medium">@{tiktokProfile.handle}</span>
                            </div>
                            {tiktokProfile.followers !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Followers:</span>
                                    <span className="font-medium">
                                        {tiktokProfile.followers.toLocaleString()}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* TikTok Posts with Ranking */}
                        {tiktokPosts.length > 0 && (
                            <div className="mt-4 pt-4 border-t">
                                <PostsGridWithRanking
                                    posts={tiktokPosts.map((p: any) => ({
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
                                    followerCount={tiktokProfile.followers || 0}
                                    platform="tiktok"
                                />
                            </div>
                        )}
                    </div>
                )}

                {socialProfiles.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                        No social profiles found
                    </p>
                )}
            </div>
        </DataCard>
    );
}
