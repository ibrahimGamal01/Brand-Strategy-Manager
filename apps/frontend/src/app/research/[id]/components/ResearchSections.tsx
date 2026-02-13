'use client';

import {
    Instagram,
    Search,
    Image as ImageIcon,
    Video,
    Newspaper,
    TrendingUp,
    Users,
    MessageSquare,
    Brain,
    Database,
    XCircle,
    Share2,
    Loader2
} from 'lucide-react';
import { PipelineProgress } from './PipelineProgress';
// New Generic Data Components
import { DataSection } from './data/DataSection';
import { DataGrid } from './data/DataGrid';
import { searchResultSchema } from './data/schemas/search-results.schema';
import { imageSchema } from './data/schemas/images.schema';
import { videoSchema } from './data/schemas/videos.schema';
import { newsSchema } from './data/schemas/news.schema';
import { trendsSchema } from './data/schemas/trends.schema';
import { communityInsightsSchema } from './data/schemas/community-insights.schema';
import { aiQuestionsSchema } from './data/schemas/ai-questions.schema';
import { brandMentionsSchema } from './data/schemas/brand-mentions.schema';
import { useDataCrud } from '../hooks/useDataCrud';

// Legacy components (kept for reference or specific use cases)
import { DataSourceSection } from './DataSourceSection';
import { SocialProfilesSection } from './SocialProfilesSection';
import { CompetitorOrchestrationPanel } from './competitor/CompetitorOrchestrationPanel';
import { VisualComparisonSection } from './VisualComparisonSection';
import { ClientDataCard } from './cards/ClientDataCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useModuleActions } from '../hooks/useModuleActions';
import { ModuleActionButtons } from './ModuleActionButtons';

interface AllResearchSectionsProps {
    jobId: string;
    status: string;
    client: any;
    data: {
        clientPosts: any[];
        rawSearchResults: any[];
        ddgImageResults: any[];
        ddgVideoResults: any[];
        ddgNewsResults: any[];
        searchTrends: any[];
        competitors: any[];
        brandMentions: any[];
        communityInsights: any[];
        mediaAssets: any[];
        aiQuestions: any[];
        socialProfiles: any[];
        trendDebug?: {
            attemptedKeywords?: string[];
            insertedCount?: number;
            totalCount?: number;
        };
    }
}

export function AllResearchSections({ jobId, status, client, data }: AllResearchSectionsProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [runningScrapers, setRunningScrapers] = useState<Record<string, boolean>>({});
    const [brandIntelRunning, setBrandIntelRunning] = useState(false);
    const { runModuleAction, isRunning, getLastResult } = useModuleActions(jobId);

    // Wrapper for rerun actions
    async function rerunScraper(jobId: string, scraperType: string) {
        try {
            setRunningScrapers(prev => ({ ...prev, [scraperType]: true }));
            const response = await apiClient.rerunScraper(jobId, scraperType);
            if (response?.error) {
                throw new Error(response.error);
            }
            router.refresh();
            toast({
                title: 'Module rerun started',
                description: `${scraperType} rerun has started.`,
            });
        } catch (error) {
            toast({
                title: 'Failed to rerun module',
                description: `Unable to start ${scraperType}: ${(error as Error).message}`,
                variant: 'destructive',
            });
        } finally {
            setRunningScrapers(prev => ({ ...prev, [scraperType]: false }));
        }
    }

    // Handlers for re-run buttons
    function makeRerunHandler(scraper: string) {
        return async () => await rerunScraper(jobId, scraper);
    }

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
        } catch (error: any) {
            toast({
                title: 'Brand intelligence failed',
                description: error?.message || 'Unable to start brand intelligence orchestration',
                variant: 'destructive',
            });
        } finally {
            setBrandIntelRunning(false);
        }
    }

    // Existing declarations (kept for reference, but we will redefine strictly what we need or check for conflicts)
    // const instagramProfile = ... (This conflicts with later declaration)
    // Let's remove the first declaration since we define it better later for the card.
    // OR easier: just use the first one and only define tiktokProfile.

    // Changing the first declaration to be more robust and allowing reuse
    const instagramProfile = data.socialProfiles?.find((p: any) =>
        p.platform === 'instagram' &&
        p.handle?.toLowerCase() === client.handle?.toLowerCase()
    ) || data.socialProfiles?.find((p: any) => p.platform === 'instagram');


    const {
        updateItem: updateSearch,
        deleteItem: deleteSearch
    } = useDataCrud({ jobId, dataType: 'search-results' });

    const {
        updateItem: updateImage,
        deleteItem: deleteImage
    } = useDataCrud({ jobId, dataType: 'images' });

    const {
        updateItem: updateVideo,
        deleteItem: deleteVideo
    } = useDataCrud({ jobId, dataType: 'videos' });

    const {
        updateItem: updateNews,
        deleteItem: deleteNews
    } = useDataCrud({ jobId, dataType: 'news' });

    const {
        updateItem: updateTrend,
        deleteItem: deleteTrend
    } = useDataCrud({ jobId, dataType: 'trends' });

    const {
        updateItem: updateInsight,
        deleteItem: deleteInsight
    } = useDataCrud({ jobId, dataType: 'community-insights' });

    const {
        updateItem: updateQuestion,
        deleteItem: deleteQuestion
    } = useDataCrud({ jobId, dataType: 'ai-questions' });

    // Filter posts for ClientDataCard
    const { socialProfiles, clientPosts } = data;
    // instagramProfile is already defined above
    const tiktokProfile = socialProfiles?.find((p: any) => p.platform === 'tiktok');

    const instagramPosts = instagramProfile?.posts || clientPosts || [];
    const tiktokPosts = tiktokProfile?.posts || [];

    const trendActionResult = getLastResult('search_trends');
    const attemptedTrendKeywords =
        trendActionResult?.attemptedKeywords?.length
            ? trendActionResult.attemptedKeywords
            : Array.isArray(data.trendDebug?.attemptedKeywords)
                ? data.trendDebug?.attemptedKeywords
                : [];
    const trendsEmptyMessage = attemptedTrendKeywords.length > 0
        ? `No trends found. Attempted: ${attemptedTrendKeywords.slice(0, 6).join(', ')}. Next: use "Run from Start" or broaden handle/brand keywords.`
        : 'No trends collected yet. Use Continue or Run from Start for this module.';

    return (
        <div className="space-y-12 pb-20">
            {/* Client Data Section */}
            <section id="client-data">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Client Overview</h2>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline">{socialProfiles.length} Profiles</Badge>
                        <ModuleActionButtons
                            module="client_profiles"
                            runModuleAction={runModuleAction}
                            isRunning={isRunning}
                            compact
                        />
                    </div>
                </div>
                <ClientDataCard
                    client={client}
                    socialProfiles={socialProfiles || []}
                    instagramPosts={instagramPosts}
                    tiktokPosts={tiktokPosts}
                    className="w-full"
                />
            </section>

            {/* 2. Search Results */}
            <DataSection
                title="Search Results"
                icon={Search}
                count={data.rawSearchResults.length}
                onRefresh={makeRerunHandler('ddg_search')}
                actions={
                    <ModuleActionButtons
                        module="search_results"
                        runModuleAction={runModuleAction}
                        isRunning={isRunning}
                        compact
                    />
                }
            >
                <DataGrid
                    data={data.rawSearchResults}
                    config={(item) => ({
                        schema: searchResultSchema,
                        title: item.title,
                        icon: Search,
                        onEdit: updateSearch,
                        onDelete: deleteSearch
                    })}
                />
            </DataSection>

            {/* 3. Images */}
            <DataSection
                title="Images"
                icon={ImageIcon}
                count={data.ddgImageResults.length}
                onRefresh={makeRerunHandler('ddg_images')}
                actions={
                    <ModuleActionButtons
                        module="images"
                        runModuleAction={runModuleAction}
                        isRunning={isRunning}
                        compact
                    />
                }
            >
                <DataGrid
                    data={data.ddgImageResults}
                    config={(item) => ({
                        schema: imageSchema,
                        title: item.title,
                        icon: ImageIcon,
                        onEdit: updateImage,
                        onDelete: deleteImage
                    })}
                    columns={{ sm: 2, md: 3, lg: 4, xl: 5 }}
                />
            </DataSection>

            {/* 4. Videos */}
            <DataSection
                title="Videos"
                icon={Video}
                count={data.ddgVideoResults.length}
                onRefresh={makeRerunHandler('ddg_videos')}
                actions={
                    <ModuleActionButtons
                        module="videos"
                        runModuleAction={runModuleAction}
                        isRunning={isRunning}
                        compact
                    />
                }
            >
                <DataGrid
                    data={data.ddgVideoResults}
                    config={(item) => ({
                        schema: videoSchema,
                        title: item.title,
                        icon: Video,
                        onEdit: updateVideo,
                        onDelete: deleteVideo
                    })}
                />
            </DataSection>

            {/* 4.5. Visual Comparison Strategy */}
            <VisualComparisonSection jobId={jobId} />

            {/* 5. News Articles */}
            <DataSection
                title="News Articles"
                icon={Newspaper}
                count={data.ddgNewsResults.length}
                onRefresh={makeRerunHandler('ddg_news')}
                actions={
                    <ModuleActionButtons
                        module="news"
                        runModuleAction={runModuleAction}
                        isRunning={isRunning}
                        compact
                    />
                }
            >
                <DataGrid
                    data={data.ddgNewsResults}
                    config={(item) => ({
                        schema: newsSchema,
                        title: item.title,
                        icon: Newspaper,
                        onEdit: updateNews,
                        onDelete: deleteNews
                    })}
                />
            </DataSection>

            {/* 6. Google Trends */}
            <DataSection
                title="Search Trends"
                icon={TrendingUp}
                count={data.searchTrends.length}
                onRefresh={makeRerunHandler('trends')}
                actions={
                    <ModuleActionButtons
                        module="search_trends"
                        runModuleAction={runModuleAction}
                        isRunning={isRunning}
                        compact
                    />
                }
            >
                <DataGrid
                    data={data.searchTrends}
                    config={(item) => ({
                        schema: trendsSchema,
                        title: item.keyword,
                        icon: TrendingUp,
                        onEdit: updateTrend,
                        onDelete: deleteTrend
                    })}
                    emptyMessage={trendsEmptyMessage}
                />
            </DataSection>

            {/* 7. Competitors - New Modular UI */}
            <DataSourceSection
                title="Competitor Intelligence"
                icon={Users}
                count={data.competitors.length}
                actions={
                    <div className="flex items-center gap-1">
                        <ModuleActionButtons
                            module="competitors"
                            runModuleAction={runModuleAction}
                            isRunning={isRunning}
                            compact
                            hiddenActions={['continue']}
                        />
                    </div>
                }
            >
                <CompetitorOrchestrationPanel
                    jobId={jobId}
                    className="mb-4"
                    onRefresh={() => router.refresh()}
                />
            </DataSourceSection>

            {/* 8. Brand Mentions */}
            <DataSection
                title="Brand Mentions"
                icon={Database}
                count={data.brandMentions.length}
                onRefresh={() => runBrandIntelligence(['brand_mentions'])}
                actions={
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => runBrandIntelligence()}
                            disabled={brandIntelRunning}
                        >
                            {brandIntelRunning ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Run Both
                        </Button>
                        <ModuleActionButtons
                            module="brand_mentions"
                            runModuleAction={runModuleAction}
                            isRunning={isRunning}
                            compact
                        />
                    </div>
                }
            >
                <DataGrid
                    data={data.brandMentions}
                    config={(item) => ({
                        schema: brandMentionsSchema,
                        title: item.title || item.url || 'Brand Mention',
                        icon: Database,
                    })}
                    columns={{ sm: 1, md: 1, lg: 2, xl: 2 }}
                    emptyMessage="No brand mentions available yet"
                />
            </DataSection>

            {/* 8. Community Insights (VoC) */}
            <DataSection
                title="Community Insights (VoC)"
                icon={MessageSquare}
                count={data.communityInsights.length}
                onRefresh={() => runBrandIntelligence(['community_insights'])}
                actions={
                    <ModuleActionButtons
                        module="community_insights"
                        runModuleAction={runModuleAction}
                        isRunning={isRunning}
                        compact
                    />
                }
            >
                <DataGrid
                    data={data.communityInsights}
                    config={(item) => ({
                        schema: communityInsightsSchema,
                        title: item.content ? item.content.substring(0, 50) + '...' : 'Insight',
                        icon: MessageSquare,
                        onEdit: updateInsight,
                        onDelete: deleteInsight
                    })}
                />
            </DataSection>

            {/* 10. AI Questions */}
            <DataSection
                title="Strategic Analysis (13 Questions)"
                icon={Brain}
                count={data.aiQuestions.length}
                onRefresh={makeRerunHandler('ai_analysis')}
                actions={
                    <ModuleActionButtons
                        module="ai_questions"
                        runModuleAction={runModuleAction}
                        isRunning={isRunning}
                        compact
                    />
                }
            >
                <DataGrid
                    data={data.aiQuestions}
                    config={(item) => ({
                        schema: aiQuestionsSchema,
                        title: item.question,
                        icon: Brain,
                        onEdit: updateQuestion,
                        onDelete: deleteQuestion,
                        defaultExpanded: true
                    })}
                    columns={{ sm: 1, md: 1, lg: 1, xl: 1 }}
                />
            </DataSection>

        </div >
    );
}
