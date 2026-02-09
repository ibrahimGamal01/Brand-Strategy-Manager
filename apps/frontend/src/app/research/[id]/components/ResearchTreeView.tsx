'use client';

import { useState } from 'react';
import {
    User, Instagram, Video, Users, Search, ImageIcon,
    Newspaper, TrendingUp, MessageSquare, Brain, PlayCircle,
    ExternalLink, Download, Loader2, RefreshCw, Database as DatabaseIcon, Trash2
} from 'lucide-react';
import { TreeLayout, TreeNodeCard, DataList } from './tree';
import { CompetitorPostsSection } from './competitor/CompetitorPostsSection';
import { PostsGallery } from './competitor/PostsGallery';
import { PostsGridWithRanking } from './PostsGridWithRanking';
import { ImageGallery } from './search/ImageGallery';
import { VideoGallery } from './search/VideoGallery';
import { NewsGallery } from './search/NewsGallery';
import { SearchResultsList } from './search/SearchResultsList';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ClientInfoNode } from './tree/ClientInfoNode';
import { CompetitorsNode } from './tree/CompetitorsNode';
import { SearchDataNode } from './tree/SearchDataNode';
import { AnalyticsNode } from './tree/AnalyticsNode';
import { AiAnalysisNode } from './tree/AiAnalysisNode';
import { BrandReputationNode } from './tree/BrandReputationNode';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

interface ResearchTreeViewProps {
    jobId: string;
    client: any;
    data: {
        clientPosts: any[];
        tiktokPosts?: any[]; // New prop in data interface
        rawSearchResults: any[];
        ddgImageResults: any[];
        ddgVideoResults: any[];
        ddgNewsResults: any[];
        searchTrends: any[];
        competitors: any[];
        communityInsights: any[];
        mediaAssets: any[];
        aiQuestions: any[];
        socialProfiles: any[];
        brandMentions: any[];
        clientDocuments: any[];
    };
    onScrapeCompetitor?: (id: string) => void;
    onRefreshSection?: (section: string) => void;
}

/**
 * ResearchTreeView - Tree-based hierarchical layout for research data
 * Data branches out vertically with visual connectors
 * Shows ALL actual data content, not just counts
 */
export function ResearchTreeView({
    jobId,
    client,
    data,
    onScrapeCompetitor,
    onRefreshSection
}: ResearchTreeViewProps) {
    const [scrapingIds, setScrapingIds] = useState<Record<string, boolean>>({});
    const { toast } = useToast();

    // Safely handle null/undefined arrays  
    const competitors = data.competitors || [];
    const socialProfiles = data.socialProfiles || [];
    const clientPosts = data.clientPosts || [];
    const tiktokPosts = data.tiktokPosts || []; // Extract tiktokPosts
    const searchResults = data.rawSearchResults || [];
    const images = data.ddgImageResults || [];
    const videos = data.ddgVideoResults || [];
    const news = data.ddgNewsResults || [];
    const trends = data.searchTrends || [];
    const insights = data.communityInsights || [];
    const aiQuestions = data.aiQuestions || [];
    const brandMentions = data.brandMentions || [];
    const clientDocuments = data.clientDocuments || [];

    // Helper: Find social profile ID for a competitor based on handle/platform match
    const getSocialProfileId = (competitorHandle: string, platform: string): string | undefined => {
        const profile = socialProfiles.find((p: any) =>
            p.platform === platform && p.handle === competitorHandle
        );
        return profile?.id;
    };

    // Category competitors properly - check ALL discovery sources
    const instagramCompetitors = competitors.filter((c: any) => c?.platform === 'instagram');
    const tiktokCompetitors = competitors.filter((c: any) => c?.platform === 'tiktok');

    const handleScrape = async (competitorId: string, handle: string) => {
        // ... existing handleScrape logic ...
        try {
            const result = await apiClient.scrapeCompetitor(competitorId);
            toast({
                title: "Scraping Started",
                description: `Started scraping posts for @${handle}. This may take a few moments.`,
            });

            // Auto-refresh after 5 seconds to show scraped data
            setTimeout(() => {
                onRefreshSection?.('competitors');
            }, 5000);
        } catch (error: any) {
            toast({
                title: "Scraping Failed",
                description: error.message || "Failed to start scraping",
                variant: "destructive"
            });
        } finally {
            setScrapingIds(prev => ({ ...prev, [competitorId]: false }));
        }
    };

    return (
        <TreeLayout className="max-w-6xl">
            {/* Root: Intelligence Gathering */}
            <TreeNodeCard
                title="Intelligence Gathering"
                icon={<Search className="h-5 w-5" />}
                defaultExpanded={true}
                level={0}
            >
                {/* Level 1: Client Profile */}
                <ClientInfoNode
                    client={client}
                    socialProfiles={socialProfiles}
                    clientDocuments={clientDocuments}
                    clientPosts={clientPosts}
                    tiktokPosts={tiktokPosts}
                    onRefreshSection={onRefreshSection}
                />

                {/* Level 1: Competitors */}
                <TreeNodeCard
                    title="Competitors"
                    icon={<Users className="h-4 w-4" />}
                    count={competitors.length}
                    defaultExpanded={competitors.length > 0}
                    level={1}
                    actions={
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onRefreshSection?.('competitors')}
                            className="h-7 text-xs px-2"
                        >
                            <RefreshCw className="h-3 w-3" />
                        </Button>
                    }
                >
                    {competitors.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-6 px-4">
                            No competitors discovered yet
                        </div>
                    ) : (
                        <>
                            {/* Level 2: Instagram Competitors */}
                            {competitors.some(c => c.platform?.toLowerCase() === 'instagram') && (
                                <TreeNodeCard
                                    title="Instagram Competitors"
                                    icon={<Instagram className="h-4 w-4 text-pink-500" />}
                                    count={instagramCompetitors.length}
                                    level={2}
                                    defaultExpanded={true}
                                >
                                    {instagramCompetitors.map((comp: any) => (
                                        <TreeNodeCard
                                            key={comp.id}
                                            title={
                                                <div className="flex items-center gap-2 w-full">
                                                    <span className="font-semibold">@{comp.handle}</span>
                                                    {comp.relevanceScore && (
                                                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">
                                                            {Math.round(comp.relevanceScore * 100)}% Match
                                                        </Badge>
                                                    )}
                                                    {comp.postsScraped > 0 && (
                                                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-pink-500/30 text-pink-500 bg-pink-500/5">
                                                            {comp.postsScraped} posts
                                                        </Badge>
                                                    )}
                                                </div>
                                            }
                                            icon={<div className="w-2 h-2 rounded-full bg-pink-400 shadow-[0_0_8px_rgba(236,72,153,0.6)]" />}
                                            level={3}
                                            defaultExpanded={false}
                                            actions={
                                                <div className="flex items-center gap-2">
                                                    <Badge variant={comp.status === 'SCRAPED' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 h-5">
                                                        {comp.status}
                                                    </Badge>
                                                    <a
                                                        href={comp.profileUrl || `https://instagram.com/${comp.handle}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-muted-foreground hover:text-foreground transition-colors p-1 hover:bg-muted rounded-md"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                </div>
                                            }
                                        >
                                            <div className="space-y-4 px-4 py-3">
                                                {/* Competitor Stats Grid */}
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Followers</span>
                                                        <span className="text-sm font-medium tabular-nums">{comp.followers ? comp.followers.toLocaleString() : 'N/A'}</span>
                                                    </div>
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Posts</span>
                                                        <span className="text-sm font-medium tabular-nums">{comp.postsScraped || 0}</span>
                                                    </div>
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Engagement</span>
                                                        <span className="text-sm font-medium tabular-nums">{comp.engagement || 'N/A'}</span>
                                                    </div>
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Relevance</span>
                                                        <span className="text-sm font-medium tabular-nums text-green-500">{comp.relevanceScore ? `${Math.round(comp.relevanceScore * 100)}%` : 'N/A'}</span>
                                                    </div>
                                                </div>

                                                {comp.discoveryReason && (
                                                    <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded-lg border border-border/40 leading-relaxed italic">
                                                        <span className="font-medium not-italic text-foreground mr-1">Why:</span>
                                                        {comp.discoveryReason}
                                                    </div>
                                                )}

                                                {(comp.status === 'SUGGESTED' || comp.postsScraped === 0) && (
                                                    <Button
                                                        onClick={() => handleScrape(comp.id, comp.handle)}
                                                        disabled={scrapingIds[comp.id]}
                                                        size="sm"
                                                        className="w-full text-xs gap-2 h-9 bg-pink-600 hover:bg-pink-700 text-white"
                                                    >
                                                        {scrapingIds[comp.id] ? (
                                                            <>
                                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                                Scraping Instagram...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Download className="h-3 w-3" />
                                                                Scrape Top Posts
                                                            </>
                                                        )}
                                                    </Button>
                                                )}

                                                {/* Scraped Posts Section */}
                                                {comp.postsScraped > 0 && (
                                                    <CompetitorPostsSection
                                                        competitorId={comp.id}
                                                        handle={comp.handle}
                                                        platform="instagram"
                                                        postsCount={comp.postsScraped}
                                                        profileId={getSocialProfileId(comp.handle, 'instagram')}
                                                        onRefresh={() => onRefreshSection?.('competitors')}
                                                    />
                                                )}
                                            </div>
                                        </TreeNodeCard>
                                    ))}
                                </TreeNodeCard>
                            )}

                            {/* Level 2: TikTok Competitors */}
                            {tiktokCompetitors.length > 0 && (
                                <TreeNodeCard
                                    title="TikTok Competitors"
                                    icon={<Video className="h-4 w-4 text-blue-500" />}
                                    count={tiktokCompetitors.length}
                                    level={2}
                                    defaultExpanded={true}
                                >
                                    {tiktokCompetitors.map((comp: any) => (
                                        <TreeNodeCard
                                            key={comp.id}
                                            title={
                                                <div className="flex items-center gap-2 w-full">
                                                    <span className="font-semibold">@{comp.handle}</span>
                                                    {comp.relevanceScore && (
                                                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">
                                                            {Math.round(comp.relevanceScore * 100)}% Match
                                                        </Badge>
                                                    )}
                                                    {comp.postsScraped > 0 && (
                                                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-blue-500/30 text-blue-500 bg-blue-500/5">
                                                            {comp.postsScraped} posts
                                                        </Badge>
                                                    )}
                                                </div>
                                            }
                                            icon={<div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />}
                                            level={3}
                                            defaultExpanded={false}
                                            actions={
                                                <div className="flex items-center gap-2">
                                                    <Badge variant={comp.status === 'SCRAPED' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 h-5">
                                                        {comp.status}
                                                    </Badge>
                                                    <a
                                                        href={comp.profileUrl || `https://tiktok.com/@${comp.handle}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-muted-foreground hover:text-foreground transition-colors p-1 hover:bg-muted rounded-md"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                </div>
                                            }
                                        >
                                            <div className="space-y-4 px-4 py-3">
                                                {/* Competitor Stats Grid */}
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Followers</span>
                                                        <span className="text-sm font-medium tabular-nums">{comp.followers ? comp.followers.toLocaleString() : 'N/A'}</span>
                                                    </div>
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Posts</span>
                                                        <span className="text-sm font-medium tabular-nums">{comp.postsScraped || 0}</span>
                                                    </div>
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Engagement</span>
                                                        <span className="text-sm font-medium tabular-nums">{comp.engagement || 'N/A'}</span>
                                                    </div>
                                                    <div className="bg-muted/30 rounded-lg p-2 border border-border/40">
                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Relevance</span>
                                                        <span className="text-sm font-medium tabular-nums text-green-500">{comp.relevanceScore ? `${Math.round(comp.relevanceScore * 100)}%` : 'N/A'}</span>
                                                    </div>
                                                </div>

                                                {comp.discoveryReason && (
                                                    <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded-lg border border-border/40 leading-relaxed italic">
                                                        <span className="font-medium not-italic text-foreground mr-1">Why:</span>
                                                        {comp.discoveryReason}
                                                    </div>
                                                )}

                                                {(comp.status === 'SUGGESTED' || comp.postsScraped === 0) && (
                                                    <Button
                                                        onClick={() => handleScrape(comp.id, comp.handle)}
                                                        disabled={scrapingIds[comp.id]}
                                                        size="sm"
                                                        className="w-full text-xs gap-2 h-9 bg-blue-600 hover:bg-blue-700 text-white"
                                                    >
                                                        {scrapingIds[comp.id] ? (
                                                            <>
                                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                                Scraping TikTok...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Download className="h-3 w-3" />
                                                                Scrape Top Posts
                                                            </>
                                                        )}
                                                    </Button>
                                                )}

                                                {/* Scraped Posts Section */}
                                                {comp.postsScraped > 0 && (
                                                    <CompetitorPostsSection
                                                        competitorId={comp.id}
                                                        handle={comp.handle}
                                                        platform="tiktok"
                                                        postsCount={comp.postsScraped}
                                                        profileId={getSocialProfileId(comp.handle, 'tiktok')}
                                                        onRefresh={() => onRefreshSection?.('competitors')}
                                                    />
                                                )}
                                            </div>
                                        </TreeNodeCard>
                                    ))}
                                </TreeNodeCard>
                            )}
                        </>
                    )
                    }
                </TreeNodeCard >

                {/* Level 1: Search Data */}
                < TreeNodeCard
                    title="Search Data"
                    icon={< Search className="h-4 w-4" />}
                    count={searchResults.length + images.length + videos.length + news.length}
                    defaultExpanded={false}
                    level={1}
                >
                    {/* Search Results */}
                    < TreeNodeCard
                        title="Search Results"
                        icon={< Search className="h-3 w-3" />}
                        count={searchResults.length}
                        level={2}
                        defaultExpanded={searchResults.length > 0}
                    >
                        <div className="px-4 py-3">
                            <SearchResultsList results={searchResults.map((result: any, idx: number) => ({
                                id: result.id || idx.toString(),
                                title: result.title || result.name || 'Untitled',
                                snippet: result.snippet || result.description || result.body,
                                url: result.url || result.link,
                                source: result.source
                            }))} />
                        </div>
                    </TreeNodeCard >

                    {/* Images */}
                    < TreeNodeCard
                        title="Images"
                        icon={< ImageIcon className="h-3 w-3" />}
                        count={images.length}
                        level={2}
                        defaultExpanded={images.length > 0 && images.length <= 30}
                    >
                        <div className="px-4 py-3">
                            <ImageGallery images={images} />
                        </div>
                    </TreeNodeCard >

                    {/* Videos  */}
                    < TreeNodeCard
                        title="Videos"
                        icon={< Video className="h-3 w-3" />}
                        count={videos.length}
                        level={2}
                        defaultExpanded={videos.length > 0 && videos.length <= 15}
                    >
                        <div className="px-4 py-3">
                            <VideoGallery videos={videos} />
                        </div>
                    </TreeNodeCard >

                    {/* News */}
                    < TreeNodeCard
                        title="News"
                        icon={< Newspaper className="h-3 w-3" />}
                        count={news.length}
                        level={2}
                        defaultExpanded={news.length > 0 && news.length <= 10}
                    >
                        <div className="px-4 py-3">
                            <NewsGallery news={news.map((article: any, idx: number) => ({
                                id: article.id || idx.toString(),
                                title: article.title || 'Untitled Article',
                                body: article.excerpt || article.description || article.body,
                                url: article.url || article.link,
                                source: article.source,
                                imageUrl: article.imageUrl,
                                publishedAt: article.publishedAt
                            }))} />
                        </div>
                    </TreeNodeCard >
                </TreeNodeCard >

                {/* Level 1: Brand Reputation (Mentions) */}
                < TreeNodeCard
                    title="Brand Reputation"
                    icon={< MessageSquare className="h-4 w-4" />}
                    count={brandMentions.length}
                    defaultExpanded={false}
                    level={1}
                >
                    <TreeNodeCard
                        title="Web Mentions"
                        icon={<DatabaseIcon className="h-3 w-3" />}
                        count={brandMentions.length}
                        level={2}
                        defaultExpanded={true}
                    >
                        <DataList
                            items={brandMentions.map((mention: any, idx: number) => ({
                                id: mention.id || idx.toString(),
                                title: mention.title || mention.sourceType || 'Mention',
                                subtitle: mention.sourceType,
                                content: mention.snippet || mention.fullText,
                                url: mention.url
                            }))}
                            emptyMessage="No brand mentions found"
                        />
                    </TreeNodeCard>
                </TreeNodeCard >

                {/* Level 1: Analytics */}
                < TreeNodeCard
                    title="Analytics"
                    icon={< TrendingUp className="h-4 w-4" />}
                    count={trends.length + insights.length}
                    defaultExpanded={false}
                    level={1}
                >
                    <TreeNodeCard
                        title="Search Trends"
                        icon={<TrendingUp className="h-3 w-3" />}
                        count={trends.length}
                        level={2}
                        defaultExpanded={trends.length > 0}
                    >
                        <DataList
                            items={trends.slice(0, 10).map((trend: any, idx: number) => ({
                                id: idx.toString(),
                                title: trend.query || trend.keyword || 'Trend',
                                subtitle: trend.volume ? `Volume: ${trend.volume}` : undefined,
                                content: Array.isArray(trend.relatedQueries)
                                    ? trend.relatedQueries.join(', ')
                                    : (typeof trend.relatedQueries === 'object' && trend.relatedQueries !== null
                                        ? JSON.stringify(trend.relatedQueries)
                                        : (trend.relatedQueries || '').toString())
                            }))}
                            emptyMessage="No trends available"
                        />
                    </TreeNodeCard>
                    <TreeNodeCard
                        title="Community Insights"
                        icon={<MessageSquare className="h-3 w-3" />}
                        count={insights.length}
                        level={2}
                        defaultExpanded={insights.length > 0}
                    >
                        <DataList
                            items={insights.slice(0, 10).map((insight: any, idx: number) => ({
                                id: idx.toString(),
                                title: insight.title || insight.topic || 'Insight',
                                content: insight.summary || insight.content,
                                url: insight.url || insight.source
                            }))}
                            emptyMessage="No community insights available"
                        />
                    </TreeNodeCard>
                </TreeNodeCard >

                {/* Level 1: AI Analysis */}
                < TreeNodeCard
                    title="AI Strategic Analysis"
                    icon={< Brain className="h-4 w-4" />}
                    count={aiQuestions.length}
                    defaultExpanded={aiQuestions.length > 0}
                    level={1}
                >
                    {
                        aiQuestions.length === 0 ? (
                            <div className="text-xs text-muted-foreground text-center py-6 px-4">
                                No AI analysis available yet
                            </div>
                        ) : (
                            <DataList
                                items={aiQuestions.map((qa: any) => ({
                                    id: qa.id || qa.question,
                                    title: qa.question,
                                    content: qa.answer
                                }))}
                            />
                        )
                    }
                </TreeNodeCard >
            </TreeNodeCard >
        </TreeLayout >
    );
}
