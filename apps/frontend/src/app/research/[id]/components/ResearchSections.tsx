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
    XCircle
} from 'lucide-react';
import { PipelineProgress } from './PipelineProgress';
import { DataSourceSection } from './DataSourceSection';
import { InstagramSection } from './InstagramSection';
import { SearchResultsList } from './SearchResultsList';
import { ImageGallery } from './ImageGallery';
import { VideoGallery } from './VideoGallery';
import { TrendsSection } from './TrendsSection';
import { CompetitorsSection } from './CompetitorsSection';
import { CommunityInsightsSection } from './CommunityInsightsSection';
import { AIQuestionsSection } from './AIQuestionsSection';
import { useState } from 'react';

// API helper
// API helper
async function rerunScraper(jobId: string, scraperType: string) {
    try {
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

        // Reload page to show new data (or invalidate query if using react-query)
        window.location.reload();

    } catch (error) {
        console.error(`Failed to rerun ${scraperType}:`, error);
        alert(`Failed to start ${scraperType}: ${(error as Error).message}`);
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
    }
}

export function AllResearchSections({ jobId, status, client, data }: AllResearchSectionsProps) {

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
            window.location.reload();
        } catch (error) {
            console.error('Failed to stop job:', error);
            alert('Failed to stop job');
        }
    }

    return (
        <div className="space-y-4 pb-20">
            {/* Global Pipeline Progress with Stop Button */}
            <div className="mb-6">
                <PipelineProgress
                    status={status}
                    onStop={handleStop}
                />
            </div>

            {/* 1. Instagram Profile & Posts */}
            <DataSourceSection
                title="Instagram Profile & Posts"
                icon={Instagram}
                count={data.clientPosts.length}
                defaultOpen={true}
                onRerun={makeRerunHandler('instagram')}
            >
                <InstagramSection
                    profile={{
                        handle: client.handle || '',
                        bio: client.businessOverview || '', // fallback if bio stored here
                        followerCount: 0, // Should be passed from client data if available
                        followingCount: 0,
                        profileImageUrl: undefined // add if available
                    }}
                    posts={data.clientPosts}
                />
            </DataSourceSection>

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
                />
            </DataSourceSection>

            {/* 8. Community Insights */}
            <DataSourceSection
                title="Community Insights (VoC)"
                icon={MessageSquare}
                count={data.communityInsights.length}
                onRerun={makeRerunHandler('community_insights')}
            >
                <CommunityInsightsSection insights={data.communityInsights} />
            </DataSourceSection>

            {/* 9. Media Assets (Downloaded) */}
            <DataSourceSection
                title="Downloaded Media Assets"
                icon={Database}
                count={data.mediaAssets.length}
            >
                <div className="p-4 text-center text-muted-foreground">
                    {data.mediaAssets.length} assets downloaded to storage.
                    (Visualized in Images section where matches occur)
                </div>
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

        </div>
    );
}
