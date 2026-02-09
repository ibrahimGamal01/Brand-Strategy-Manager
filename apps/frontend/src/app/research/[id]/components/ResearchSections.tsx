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
    Share2
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
import { useDataCrud } from '../hooks/useDataCrud';

// Legacy components (kept for reference or specific use cases)
import { DataSourceSection } from './DataSourceSection';
import { SocialProfilesSection } from './SocialProfilesSection';
import { CompetitorIntelligence } from './competitor/CompetitorIntelligence';
import { VisualComparisonSection } from './VisualComparisonSection';
import { ClientDataCard } from './cards/ClientDataCard';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// API helper
async function callRerunApi(jobId: string, scraperType: string) {
    const response = await fetch(`http://localhost:3001/api/research-jobs/${jobId}/rerun/${scraperType}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to re-run scraper');
    }
}

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
        communityInsights: any[];
        mediaAssets: any[];
        aiQuestions: any[];
        socialProfiles: any[];
    }
}

export function AllResearchSections({ jobId, status, client, data }: AllResearchSectionsProps) {
    const router = useRouter();
    const [runningScrapers, setRunningScrapers] = useState<Record<string, boolean>>({});

    // Wrapper for rerun actions
    async function rerunScraper(jobId: string, scraperType: string) {
        try {
            setRunningScrapers(prev => ({ ...prev, [scraperType]: true }));
            await callRerunApi(jobId, scraperType);
            router.refresh();
        } catch (error) {
            console.error(`Failed to rerun ${scraperType}:`, error);
            alert(`Failed to start ${scraperType}: ${(error as Error).message}`);
        } finally {
            setRunningScrapers(prev => ({ ...prev, [scraperType]: false }));
        }
    }

    // TikTok discovery handler
    async function discoverTikTok() {
        try {
            setRunningScrapers(prev => ({ ...prev, 'tiktok_discovery': true }));

            const response = await fetch(`http://localhost:3001/api/research-jobs/${jobId}/discover-tiktok`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) throw new Error('TikTok discovery failed');

            const result = await response.json();
            alert(`Discovered ${result.discovered} TikTok competitors! ${result.message}`);

            // Poll for updates every 3 seconds
            const pollInterval = setInterval(() => {
                router.refresh();
            }, 3000);

            // Stop polling after 30 seconds
            setTimeout(() => clearInterval(pollInterval), 30000);

        } catch (error) {
            console.error('TikTok discovery failed:', error);
            alert(`Failed to discover TikTok competitors: ${(error as Error).message}`);
        } finally {
            setRunningScrapers(prev => ({ ...prev, 'tiktok_discovery': false }));
        }
    }

    // Handlers for re-run buttons
    function makeRerunHandler(scraper: string) {
        return async () => await rerunScraper(jobId, scraper);
    }

    async function handleStop() {
        if (!confirm('Are you sure you want to stop this research job?')) return;

        try {
            const response = await fetch(`http://localhost:3001/api/research-jobs/${jobId}/stop`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error('Failed to stop job');

            // Reload to show cancelled status
            router.refresh();
        } catch (error) {
            console.error('Failed to stop job:', error);
            alert('Failed to stop job');
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

    return (
        <div className="space-y-12 pb-20">
            {/* Client Data Section */}
            <section id="client-data">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Client Overview</h2>
                    <Badge variant="outline">{socialProfiles.length} Profiles</Badge>
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
            >
                <DataGrid
                    data={data.searchTrends}
                    config={(item) => ({
                        schema: trendsSchema,
                        title: item.name,
                        icon: TrendingUp,
                        onEdit: updateTrend,
                        onDelete: deleteTrend
                    })}
                />
            </DataSection>

            {/* 7. Competitors - New Modular UI */}
            <DataSourceSection
                title="Competitor Intelligence"
                icon={Users}
                count={data.competitors.length}
                onRerun={makeRerunHandler('competitors')}
            >
                <CompetitorIntelligence
                    jobId={jobId}
                    competitors={data.competitors}
                    onRunDiscovery={(type) => {
                        const scraperType = type === 'ai' ? 'competitors_ai' : 'competitors_code';
                        rerunScraper(jobId, scraperType);
                    }}
                    onDiscoverTikTok={discoverTikTok}
                    isDiscoveringTikTok={runningScrapers['tiktok_discovery'] || false}
                    onEditCompetitor={async (id, updates) => {
                        // TODO: Use hook here too?
                        // For now keeping custom component as it's specialized
                    }}
                    onDeleteCompetitor={async (id) => {
                        // TODO: Use hook here too
                    }}
                    onScrapeCompetitor={async (id) => {
                        console.log('Scrape competitor', id);
                    }}
                    onScrapeAll={async () => {
                        console.log('Scrape all competitors');
                    }}
                />
            </DataSourceSection>

            {/* 8. Community Insights (VoC) */}
            <DataSection
                title="Community Insights (VoC)"
                icon={MessageSquare}
                count={data.communityInsights.length}
                onRefresh={makeRerunHandler('community_insights')}
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
                title="Strategic Analysis (12 Questions)"
                icon={Brain}
                count={data.aiQuestions.length}
                onRefresh={makeRerunHandler('ai_analysis')}
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
