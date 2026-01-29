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
import { DataSourceSection } from './DataSourceSection';
import { SocialProfilesSection } from './SocialProfilesSection';
import { SearchResultsList } from './SearchResultsList';
import { ImageGallery } from './ImageGallery';
import { VideoGallery } from './VideoGallery';
import { TrendsSection } from './TrendsSection';
import { CompetitorsSection } from './CompetitorsSection';
import { CommunityInsightsSection } from './CommunityInsightsSection';
import { AIQuestionsSection } from './AIQuestionsSection';
import { VisualComparisonSection } from './VisualComparisonSection';
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

    const instagramProfile = data.socialProfiles?.find((p: any) =>
        p.platform === 'instagram' &&
        p.handle?.toLowerCase() === client.handle?.toLowerCase()
    ) || data.socialProfiles?.find((p: any) => p.platform === 'instagram'); // Fallback to first if no match

    return (
        <div className="space-y-4 pb-20">
            {/* Global Pipeline Progress with Stop Button */}
            <div className="mb-6">
                <PipelineProgress
                    status={status}
                    onStop={handleStop}
                />
            </div>

            {/* 1. Social Profiles (Consolidated) */}
            <SocialProfilesSection
                client={client}
                data={data}
                onRerun={(id) => rerunScraper(jobId, id)} // Fix: bind was tricky, using arrow function
            />

            {/* 2. Search Results */}
            <DataSourceSection
                title="Search Results"
                icon={Search}
                count={data.rawSearchResults.length}
                onRerun={makeRerunHandler('ddg_search')}
            >
                <SearchResultsList results={data.rawSearchResults} />
            </DataSourceSection>

            {/* 3. Images */}
            <DataSourceSection
                title="Images"
                icon={ImageIcon}
                count={data.ddgImageResults.length}
                onRerun={makeRerunHandler('ddg_images')}
            >
                <ImageGallery images={data.ddgImageResults} />
            </DataSourceSection>

            {/* 4. Videos */}
            <DataSourceSection
                title="Videos"
                icon={Video}
                count={data.ddgVideoResults.length}
                onRerun={makeRerunHandler('ddg_videos')}
            >
                <VideoGallery videos={data.ddgVideoResults} />
            </DataSourceSection>

            {/* 4.5. Visual Comparison Strategy */}
            <VisualComparisonSection jobId={jobId} />

            {/* 5. News Articles */}
            <DataSourceSection
                title="News Articles"
                icon={Newspaper}
                count={data.ddgNewsResults.length}
                onRerun={makeRerunHandler('ddg_news')}
            >
                <SearchResultsList results={data.ddgNewsResults} />
            </DataSourceSection>

            {/* 6. Google Trends */}
            <DataSourceSection
                title="Search Trends"
                icon={TrendingUp}
                count={data.searchTrends.length}
                onRerun={makeRerunHandler('trends')}
            >
                <TrendsSection trends={data.searchTrends} />
            </DataSourceSection>

            {/* 7. Competitors */}
            <DataSourceSection
                title="Competitors"
                icon={Users}
                count={data.competitors.length}
                onRerun={makeRerunHandler('competitors')}
            >
                <CompetitorsSection
                    competitors={data.competitors}
                    onRunScraper={(scraper) => rerunScraper(jobId, scraper)}
                    runningScrapers={runningScrapers}
                />
            </DataSourceSection>

            {/* 8. Community Insights (VoC) */}
            <DataSourceSection
                title="Community Insights (VoC)"
                icon={MessageSquare}
                count={data.communityInsights.length}
                onRerun={makeRerunHandler('community_insights')}
            >
                <CommunityInsightsSection insights={data.communityInsights} />
            </DataSourceSection>

            {/* 10. AI Questions */}
            <DataSourceSection
                title="Strategic Analysis (12 Questions)"
                icon={Brain}
                count={data.aiQuestions.length}
                onRerun={makeRerunHandler('ai_analysis')}
                defaultOpen={data.aiQuestions.length > 0}
            >
                <AIQuestionsSection questions={data.aiQuestions} />
            </DataSourceSection>

        </div >
    );
}
