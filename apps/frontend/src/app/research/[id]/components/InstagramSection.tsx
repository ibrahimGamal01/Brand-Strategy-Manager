'use client';

import { Instagram, Heart, MessageCircle, Users, ExternalLink } from 'lucide-react';

interface Post {
    id: string;
    caption: string;
    likes: number;
    comments: number;
    postUrl: string;
    postedAt: string;
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
}

export function InstagramSection({ profile, posts }: InstagramSectionProps) {
    return (
        <div className="space-y-6">
            {/* Profile Header */}
            <div className="flex items-start gap-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/20">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center overflow-hidden">
                    {profile.profileImageUrl ? (
                        <img src={profile.profileImageUrl} alt={profile.handle} className="w-full h-full object-cover" />
                    ) : (
                        <Instagram className="h-8 w-8 text-white" />
                    )}
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg">@{profile.handle}</h3>
                        <a
                            href={`https://instagram.com/${profile.handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{profile.bio}</p>
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
                </div>
            </div>

            {/* Posts Grid */}
            <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Recent Posts ({posts.length})</h4>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {posts.slice(0, 18).map((post) => {
                        const thumbnail = post.mediaAssets?.[0]?.thumbnailPath ||
                            post.mediaAssets?.[0]?.blobStoragePath ||
                            post.mediaAssets?.[0]?.originalUrl;
                        return (
                            <a
                                key={post.id}
                                href={post.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="relative aspect-square rounded-lg overflow-hidden bg-muted group"
                            >
                                {thumbnail ? (
                                    <img
                                        src={thumbnail.startsWith('/') ? `http://localhost:3001/storage${thumbnail.split('/storage')[1]}` : thumbnail}
                                        alt=""
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-muted">
                                        <Instagram className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                                    <div className="flex items-center gap-1 text-white text-sm">
                                        <Heart className="h-4 w-4" fill="white" />
                                        {post.likes?.toLocaleString()}
                                    </div>
                                    <div className="flex items-center gap-1 text-white text-sm">
                                        <MessageCircle className="h-4 w-4" fill="white" />
                                        {post.comments?.toLocaleString()}
                                    </div>
                                </div>
                            </a>
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
