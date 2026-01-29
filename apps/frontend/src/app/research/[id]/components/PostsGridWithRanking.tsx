'use client';

import { useState } from 'react';
import {
    Heart, MessageCircle, Eye, Share2, ExternalLink,
    TrendingUp, Users, Clock, Trophy, BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Post {
    id: string;
    caption: string;
    likesCount: number;
    commentsCount: number;
    sharesCount?: number;
    viewsCount?: number;
    playsCount?: number;
    postUrl?: string;
    url?: string;
    postedAt: string;
    thumbnailUrl?: string;
    mediaAssets?: Array<{
        thumbnailPath?: string;
        blobStoragePath?: string;
        originalUrl?: string;
    }>;
}

type RankingCriteria =
    | 'balanced'
    | 'engagement'
    | 'reach'
    | 'conversation'
    | 'virality'
    | 'recency';

interface RankedPost {
    post: Post;
    score: number;
    rank: number;
    breakdown: {
        engagementRate: number;
        totalEngagement: number;
        reach: number;
        virality: number;
        conversation: number;
        recency: number;
    };
}

interface PostsGridWithRankingProps {
    posts: Post[];
    followerCount: number;
    platform: 'instagram' | 'tiktok';
}

export function PostsGridWithRanking({ posts, followerCount, platform }: PostsGridWithRankingProps) {
    const [selectedCriteria, setSelectedCriteria] = useState<RankingCriteria>('balanced');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    // Rank posts
    const rankedPosts = rankPosts(posts, followerCount, selectedCriteria);
    const topPosts = rankedPosts.slice(0, 12);

    // Calculate aggregate stats
    const stats = calculateAggregateStats(rankedPosts);

    const tabs: Array<{ id: RankingCriteria; label: string; icon: any; desc: string }> = [
        { id: 'balanced', label: 'Balanced', icon: Trophy, desc: 'Multi-metric winners' },
        { id: 'engagement', label: 'Engagement', icon: Heart, desc: 'Most engaging' },
        { id: 'reach', label: 'Reach', icon: Eye, desc: 'Most viewed' },
        { id: 'conversation', label: 'Conversation', icon: MessageCircle, desc: 'Most discussed' },
        { id: 'virality', label: 'Virality', icon: Share2, desc: 'Most shared' },
        { id: 'recency', label: 'Recency', icon: Clock, desc: 'Recent performers' },
    ];

    return (
        <div className="space-y-6">
            {/* Performance Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatsCard
                    label="Avg Engagement Rate"
                    value={`${stats.avgEngagementRate.toFixed(2)}%`}
                    icon={TrendingUp}
                    trend="+12% vs baseline"
                />
                <StatsCard
                    label="Total Reach"
                    value={formatNumber(stats.totalReach)}
                    icon={Eye}
                    trend={`${stats.postsCount} posts`}
                />
                <StatsCard
                    label="Total Engagement"
                    value={formatNumber(stats.totalEngagement)}
                    icon={Heart}
                    trend={`${formatNumber(stats.totalComments)} comments`}
                />
                <StatsCard
                    label="Avg Share Rate"
                    value={`${stats.avgShareRate.toFixed(2)}%`}
                    icon={Share2}
                    trend="Virality score"
                />
            </div>

            {/* Ranking Tabs */}
            <div className="border-b border-border">
                <div className="flex items-center gap-2 overflow-x-auto pb-px -mb-px">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isSelected = selectedCriteria === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setSelectedCriteria(tab.id)}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-3 border-b-2 transition-all whitespace-nowrap text-sm font-medium",
                                    isSelected
                                        ? "border-primary text-primary bg-primary/5"
                                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                <div className="text-left">
                                    <div>{tab.label}</div>
                                    <div className="text-xs font-normal opacity-70">{tab.desc}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-muted-foreground">
                    Top {topPosts.length} Posts by {tabs.find(t => t.id === selectedCriteria)?.label}
                </h4>
                <div className="flex gap-1 border rounded-md p-1">
                    <button
                        onClick={() => setViewMode('grid')}
                        className={cn(
                            "px-3 py-1 text-xs rounded-sm transition-colors",
                            viewMode === 'grid' ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        )}
                    >
                        Grid
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        className={cn(
                            "px-3 py-1 text-xs rounded-sm transition-colors",
                            viewMode === 'list' ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        )}
                    >
                        List
                    </button>
                </div>
            </div>

            {/* Posts Display */}
            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {topPosts.map((rankedPost) => (
                        <PostCard
                            key={rankedPost.post.id}
                            rankedPost={rankedPost}
                            platform={platform}
                            criteria={selectedCriteria}
                        />
                    ))}
                </div>
            ) : (
                <div className="space-y-3">
                    {topPosts.map((rankedPost) => (
                        <PostRow
                            key={rankedPost.post.id}
                            rankedPost={rankedPost}
                            platform={platform}
                            criteria={selectedCriteria}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// Performance Overview Card
function StatsCard({ label, value, icon: Icon, trend }: any) {
    return (
        <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{trend}</div>
        </div>
    );
}

// Post Card (Grid View)
function PostCard({ rankedPost, platform, criteria }: { rankedPost: RankedPost; platform: string; criteria: RankingCriteria }) {
    const { post, rank, score, breakdown } = rankedPost;

    // Get media
    const localVideo = post.mediaAssets?.find(m => m.blobStoragePath?.endsWith('.mp4'));
    const localImage = post.mediaAssets?.find(m => !m.blobStoragePath?.endsWith('.mp4'));
    let mediaSrc = post.thumbnailUrl || post.url;
    let isVideo = false;

    if (localVideo?.blobStoragePath) {
        mediaSrc = `http://localhost:3001/storage${localVideo.blobStoragePath.split('/storage')[1]}`;
        isVideo = true;
    } else if (localImage?.blobStoragePath) {
        mediaSrc = `http://localhost:3001/storage${localImage.blobStoragePath.split('/storage')[1]}`;
    }

    return (
        <div className="group border rounded-lg bg-card overflow-hidden flex flex-col shadow-sm hover:shadow-lg transition-all relative">
            {/* Rank Badge */}
            <div className="absolute top-2 left-2 z-10 bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded-md shadow-lg">
                #{rank}
            </div>

            {/* Score Badge */}
            <div className="absolute top-2 right-2 z-10 bg-black/70 text-white text-xs font-medium px-2 py-1 rounded-md backdrop-blur-sm">
                {score.toFixed(1)}
            </div>

            {/* Media */}
            <div className="aspect-square bg-black relative overflow-hidden">
                {mediaSrc ? (
                    isVideo ? (
                        <video
                            src={mediaSrc}
                            className="w-full h-full object-cover"
                            preload="metadata"
                            playsInline
                        />
                    ) : (
                        <img
                            src={mediaSrc}
                            alt={post.caption?.slice(0, 50)}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                        />
                    )
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                        No media
                    </div>
                )}
            </div>

            {/* Metrics */}
            <div className="p-3 space-y-3">
                {/* Performance Breakdown */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <MetricPill
                        icon={Heart}
                        value={breakdown.engagementRate.toFixed(1) + '%'}
                        label="Engagement"
                        highlighted={criteria === 'engagement'}
                    />
                    <MetricPill
                        icon={Eye}
                        value={formatNumber(breakdown.reach)}
                        label="Reach"
                        highlighted={criteria === 'reach'}
                    />
                    <MetricPill
                        icon={MessageCircle}
                        value={breakdown.conversation.toFixed(1) + '%'}
                        label="Conversation"
                        highlighted={criteria === 'conversation'}
                    />
                    <MetricPill
                        icon={Share2}
                        value={breakdown.virality.toFixed(1) + '%'}
                        label="Virality"
                        highlighted={criteria === 'virality'}
                    />
                </div>

                {/* Caption */}
                <p className="text-xs line-clamp-2 text-foreground/70">
                    {post.caption || 'No caption'}
                </p>

                {/* Stats Row */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                            <Heart className="h-3 w-3" /> {formatNumber(post.likesCount || 0)}
                        </span>
                        <span className="flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" /> {formatNumber(post.commentsCount || 0)}
                        </span>
                    </div>
                    <span className="text-[10px]">{getTimeAgo(post.postedAt)}</span>
                </div>

                {/* Action Button */}
                <a
                    href={post.postUrl || post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2 bg-secondary hover:bg-secondary/80 text-xs font-medium rounded-md transition-colors"
                >
                    <ExternalLink className="h-3 w-3" />
                    View Post
                </a>
            </div>
        </div>
    );
}

// Post Row (List View)
function PostRow({ rankedPost, platform, criteria }: { rankedPost: RankedPost; platform: string; criteria: RankingCriteria }) {
    const { post, rank, score, breakdown } = rankedPost;

    const localImage = post.mediaAssets?.find(m => !m.blobStoragePath?.endsWith('.mp4'));
    const mediaSrc = localImage?.blobStoragePath
        ? `http://localhost:3001/storage${localImage.blobStoragePath.split('/storage')[1]}`
        : post.thumbnailUrl;

    return (
        <div className="border rounded-lg p-4 bg-card hover:shadow-md transition-shadow flex items-center gap-4">
            {/* Rank */}
            <div className="text-2xl font-bold text-muted-foreground/30 w-12 text-center">
                #{rank}
            </div>

            {/* Thumbnail */}
            <div className="w-16 h-16 rounded-md overflow-hidden bg-black shrink-0">
                {mediaSrc && (
                    <img src={mediaSrc} alt="" className="w-full h-full object-cover" loading="lazy" />
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-1 mb-1">
                    {post.caption || 'No caption'}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatNumber(post.likesCount || 0)} likes</span>
                    <span>{formatNumber(post.commentsCount || 0)} comments</span>
                    <span>{getTimeAgo(post.postedAt)}</span>
                </div>
            </div>

            {/* Metrics */}
            <div className="hidden md:flex items-center gap-3 text-xs">
                <div className="text-center">
                    <div className="font-semibold">{breakdown.engagementRate.toFixed(1)}%</div>
                    <div className="text-muted-foreground">Engagement</div>
                </div>
                <div className="text-center">
                    <div className="font-semibold">{formatNumber(breakdown.reach)}</div>
                    <div className="text-muted-foreground">Reach</div>
                </div>
                <div className="text-center">
                    <div className="font-semibold">{breakdown.conversation.toFixed(1)}%</div>
                    <div className="text-muted-foreground">Conversation</div>
                </div>
            </div>

            {/* Score */}
            <div className="text-right">
                <div className="text-lg font-bold text-primary">{score.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">Score</div>
            </div>

            {/* Action */}
            <a
                href={post.postUrl || post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 hover:bg-muted rounded-md transition-colors"
            >
                <ExternalLink className="h-4 w-4" />
            </a>
        </div>
    );
}

// Metric Pill Component
function MetricPill({ icon: Icon, value, label, highlighted }: any) {
    return (
        <div className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-colors",
            highlighted
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-muted/50 border-border/50"
        )}>
            <Icon className="h-3 w-3" />
            <div>
                <div className="font-semibold">{value}</div>
                <div className="text-[10px] opacity-70">{label}</div>
            </div>
        </div>
    );
}

// Helper Functions
function rankPosts(posts: Post[], followerCount: number, criteria: RankingCriteria): RankedPost[] {
    const rankedPosts = posts.map(post => {
        const breakdown = calculateBreakdown(post, followerCount);
        const score = calculateScore(breakdown, criteria);

        return {
            post,
            score,
            rank: 0,
            breakdown
        };
    });

    rankedPosts.sort((a, b) => b.score - a.score);
    rankedPosts.forEach((rp, index) => {
        rp.rank = index + 1;
    });

    return rankedPosts;
}

function calculateBreakdown(post: Post, followerCount: number) {
    const likes = post.likesCount || 0;
    const comments = post.commentsCount || 0;
    const shares = post.sharesCount || 0;
    const views = post.viewsCount || post.playsCount || 0;

    const totalEngagement = likes + comments + shares;
    const engagementRate = followerCount > 0 ? (totalEngagement / followerCount) * 100 : 0;
    const reach = views;
    const virality = views > 0 ? (shares / views) * 100 : 0;
    const conversation = likes > 0 ? (comments / likes) * 100 : 0;

    const daysSincePost = post.postedAt
        ? Math.floor((Date.now() - new Date(post.postedAt).getTime()) / (1000 * 60 * 60 * 24))
        : 999;
    const recency = Math.max(0, 100 - daysSincePost);

    return { engagementRate, totalEngagement, reach, virality, conversation, recency };
}

function calculateScore(breakdown: ReturnType<typeof calculateBreakdown>, criteria: RankingCriteria): number {
    switch (criteria) {
        case 'engagement': return breakdown.engagementRate;
        case 'reach': return breakdown.reach;
        case 'conversation': return breakdown.conversation;
        case 'virality': return breakdown.virality;
        case 'recency': return breakdown.recency;
        case 'balanced':
            const normalized = {
                engagement: Math.min(100, breakdown.engagementRate * 10),
                reach: Math.min(100, breakdown.reach / 1000),
                virality: breakdown.virality,
                conversation: breakdown.conversation,
                recency: breakdown.recency
            };
            return (
                normalized.engagement * 0.35 +
                normalized.reach * 0.25 +
                normalized.virality * 0.15 +
                normalized.conversation * 0.15 +
                normalized.recency * 0.10
            );
        default: return 0;
    }
}

function calculateAggregateStats(rankedPosts: RankedPost[]) {
    const postsCount = rankedPosts.length;
    const avgEngagementRate = rankedPosts.reduce((sum, rp) => sum + rp.breakdown.engagementRate, 0) / postsCount;
    const totalReach = rankedPosts.reduce((sum, rp) => sum + rp.breakdown.reach, 0);
    const totalEngagement = rankedPosts.reduce((sum, rp) => sum + rp.breakdown.totalEngagement, 0);
    const totalComments = rankedPosts.reduce((sum, rp) => sum + (rp.post.commentsCount || 0), 0);
    const avgShareRate = rankedPosts.reduce((sum, rp) => sum + rp.breakdown.virality, 0) / postsCount;

    return { avgEngagementRate, totalReach, totalEngagement, totalComments, avgShareRate, postsCount };
}

function formatNumber(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
}

function getTimeAgo(date: string): string {
    const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
}
