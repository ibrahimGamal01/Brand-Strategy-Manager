'use client';

import {
    Video, Users, Search, ImageIcon,
    Newspaper, TrendingUp, MessageSquare, Brain,
    RefreshCw, Database as DatabaseIcon
} from 'lucide-react';
import { TreeLayout, TreeNodeCard, DataList } from './tree';
import { ContentAndAiAnalysisView, getDeduplicatedMediaCount } from './ContentAndAiAnalysisView';
import { ImageGallery } from './search/ImageGallery';
import { VideoGallery } from './search/VideoGallery';
import { NewsGallery } from './search/NewsGallery';
import { SearchResultsList } from './search/SearchResultsList';
import { Button } from '@/components/ui/button';
import { ClientInfoNode } from './tree/ClientInfoNode';
import { CompetitorOrchestrationPanel } from './competitor/CompetitorOrchestrationPanel';
import { useModuleActions } from '../hooks/useModuleActions';
import { ModuleActionButtons } from './ModuleActionButtons';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface ResearchTreeViewProps {
    jobId: string;
    client: any;
    data: {
        clientPosts: any[];
        clientProfileSnapshots?: any[];
        competitorProfileSnapshots?: any[];
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
        analysisScope?: any;
        trendDebug?: {
            attemptedKeywords?: string[];
            insertedCount?: number;
            totalCount?: number;
        };
    };
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
    onRefreshSection
}: ResearchTreeViewProps) {
    const router = useRouter();
    const { toast } = useToast();
    const { runModuleAction, isRunning, getLastResult } = useModuleActions(jobId);
    const [brandIntelRunning, setBrandIntelRunning] = useState(false);
    const [brandIntelSummary, setBrandIntelSummary] = useState<any | null>(null);

    // Safely handle null/undefined arrays  
    const competitors = data.competitors || [];
    const socialProfiles = data.socialProfiles || [];
    const clientPosts = data.clientPosts || [];
    const tiktokPosts = data.tiktokPosts || []; // Extract tiktokPosts
    const clientProfileSnapshots = data.clientProfileSnapshots || [];
    const competitorProfileSnapshots = data.competitorProfileSnapshots || [];
    const searchResults = data.rawSearchResults || [];
    const images = data.ddgImageResults || [];
    const videos = data.ddgVideoResults || [];
    const news = data.ddgNewsResults || [];
    const trends = data.searchTrends || [];
    const insights = data.communityInsights || [];
    const aiQuestions = data.aiQuestions || [];
    const brandMentions = data.brandMentions || [];
    const clientDocuments = data.clientDocuments || [];
    const trendActionResult = getLastResult('search_trends');
    const attemptedTrendKeywords =
        trendActionResult?.attemptedKeywords?.length
            ? trendActionResult.attemptedKeywords
            : Array.isArray(data.trendDebug?.attemptedKeywords)
                ? data.trendDebug?.attemptedKeywords
                : [];
    const trendsEmptyMessage = attemptedTrendKeywords.length > 0
        ? `No trends available. Attempted: ${attemptedTrendKeywords.slice(0, 6).join(', ')}. Try Run from Start.`
        : 'No trends available yet. Use Continue to collect missing trends.';

    const isFilteredSelectionState = (selectionState?: string) => {
        const normalized = String(selectionState || '').toUpperCase();
        return normalized === 'FILTERED_OUT' || normalized === 'REJECTED';
    };

    const hiddenCompetitorsCount = competitors.filter((c: any) =>
        isFilteredSelectionState(c?.selectionState)
    ).length;

    const visibleCompetitors = competitors.filter((c: any) => !isFilteredSelectionState(c?.selectionState));

    async function loadBrandIntelligenceSummary() {
        try {
            const response = await apiClient.getBrandIntelligenceSummary(jobId);
            if (response?.success) {
                setBrandIntelSummary(response);
            }
        } catch {
            // no-op: we keep the UI functional even if summary endpoint fails
        }
    }

    useEffect(() => {
        void loadBrandIntelligenceSummary();
    }, [jobId]);

    async function runBrandIntelligence(modules?: Array<'brand_mentions' | 'community_insights'>) {
        try {
            setBrandIntelRunning(true);
            const response = await apiClient.orchestrateBrandIntelligence(jobId, {
                mode: 'append',
                modules,
                runReason: 'manual',
            });
            if (!response?.success) {
                throw new Error(response?.error || 'Brand intelligence orchestration failed');
            }

            toast({
                title: 'Brand intelligence started',
                description: modules?.length
                    ? `Running ${modules.join(' + ')}`
                    : 'Running brand mentions + community insights',
            });
            router.refresh();
            void loadBrandIntelligenceSummary();
        } catch (error: any) {
            toast({
                title: 'Brand intelligence failed',
                description: error?.message || 'Unable to run brand intelligence',
                variant: 'destructive',
            });
        } finally {
            setBrandIntelRunning(false);
        }
    }

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
                    jobId={jobId}
                    client={client}
                    socialProfiles={socialProfiles}
                    clientDocuments={clientDocuments}
                    clientPosts={clientPosts}
                    clientProfileSnapshots={clientProfileSnapshots}
                    tiktokPosts={tiktokPosts}
                    onRefreshSection={onRefreshSection}
                    actions={
                        <ModuleActionButtons
                            module="client_profiles"
                            runModuleAction={runModuleAction}
                            isRunning={isRunning}
                            compact
                            hideLabels
                        />
                    }
                />

                {/* Level 1: Competitors */}
                <TreeNodeCard
                    title="Competitors"
                    icon={<Users className="h-4 w-4" />}
                    count={visibleCompetitors.length}
                    defaultExpanded={visibleCompetitors.length > 0}
                    level={1}
                    actions={
                        <div className="flex items-center gap-1">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onRefreshSection?.('competitors')}
                                className="h-7 text-xs px-2"
                            >
                                <RefreshCw className="h-3 w-3" />
                            </Button>
                            <ModuleActionButtons
                                module="competitors"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                                hiddenActions={['continue']}
                            />
                        </div>
                    }
                >
                    <CompetitorOrchestrationPanel
                        jobId={jobId}
                        className="mb-4"
                        onRefresh={() => onRefreshSection?.('competitors')}
                    />

                    {visibleCompetitors.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-6 px-4">
                            {hiddenCompetitorsCount > 0
                                ? 'All discovered competitors are currently filtered/rejected. Use Continue Discovery to refresh the shortlist.'
                                : 'No competitors discovered yet. Use Continue Discovery to generate cross-surface candidates.'}
                        </div>
                    ) : (
                        <div className="rounded-md border border-border/50 bg-muted/10 p-3 text-xs text-muted-foreground">
                            Orchestration shortlist is the primary competitor source. Legacy per-platform lists are disabled to prevent noisy or unavailable profiles from overriding reviewed picks.
                        </div>
                    )}
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
                        actions={
                            <ModuleActionButtons
                                module="search_results"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        }
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
                        actions={
                            <ModuleActionButtons
                                module="images"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        }
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
                        actions={
                            <ModuleActionButtons
                                module="videos"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        }
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
                        actions={
                            <ModuleActionButtons
                                module="news"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        }
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
                    actions={
                        <div className="flex items-center gap-1">
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => runBrandIntelligence()}
                                disabled={brandIntelRunning}
                            >
                                {brandIntelRunning ? 'Running...' : 'Run Both'}
                            </Button>
                            <ModuleActionButtons
                                module="brand_mentions"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        </div>
                    }
                >
                    {brandIntelSummary?.summary ? (
                        <div className="mb-3 rounded-md border border-border/60 bg-background/40 p-2 text-xs">
                            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                                <span>Status: {brandIntelSummary.status || 'unknown'}</span>
                                <span>Collected: {brandIntelSummary.summary?.totals?.collected ?? 0}</span>
                                <span>Persisted: {brandIntelSummary.summary?.totals?.persisted ?? 0}</span>
                                <span>Failed: {brandIntelSummary.summary?.totals?.failed ?? 0}</span>
                            </div>
                        </div>
                    ) : null}
                    <TreeNodeCard
                        title="Web Mentions"
                        icon={<DatabaseIcon className="h-3 w-3" />}
                        count={brandMentions.length}
                        level={2}
                        defaultExpanded={true}
                        actions={
                            <ModuleActionButtons
                                module="brand_mentions"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        }
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

                {/* Level 1: Downloaded content & AI analysis (deduplicated by media id) */}
                {(() => {
                    const fallbackMediaCount = getDeduplicatedMediaCount(
                        socialProfiles,
                        clientProfileSnapshots,
                        competitorProfileSnapshots,
                        competitors
                    );
                    const scopedWindowCount = Number(data.analysisScope?.analysisWindow || 0);
                    const mediaCount = scopedWindowCount > 0 ? scopedWindowCount : fallbackMediaCount;
                    return (
                        <TreeNodeCard
                            title="Downloaded content & AI analysis"
                            icon={<ImageIcon className="h-4 w-4" />}
                            count={mediaCount}
                            defaultExpanded={mediaCount > 0}
                            level={1}
                        >
                            <div className="px-4 py-3">
                                <ContentAndAiAnalysisView
                                    jobId={jobId}
                                    socialProfiles={socialProfiles}
                                    clientProfileSnapshots={clientProfileSnapshots}
                                    competitorProfileSnapshots={competitorProfileSnapshots}
                                    discoveredCompetitors={competitors}
                                    analysisScope={data.analysisScope || null}
                                    onRefresh={() => onRefreshSection?.('content')}
                                />
                            </div>
                        </TreeNodeCard>
                    );
                })()}

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
                        actions={
                            <ModuleActionButtons
                                module="search_trends"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        }
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
                            emptyMessage={trendsEmptyMessage}
                        />
                    </TreeNodeCard>
                    <TreeNodeCard
                        title="Community Insights"
                        icon={<MessageSquare className="h-3 w-3" />}
                        count={insights.length}
                        level={2}
                        defaultExpanded={insights.length > 0}
                        actions={
                            <ModuleActionButtons
                                module="community_insights"
                                runModuleAction={runModuleAction}
                                isRunning={isRunning}
                                compact
                                hideLabels
                            />
                        }
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
                    actions={
                        <ModuleActionButtons
                            module="ai_questions"
                            runModuleAction={runModuleAction}
                            isRunning={isRunning}
                            compact
                            hideLabels
                        />
                    }
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
