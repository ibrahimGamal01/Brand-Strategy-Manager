'use client';

import {
    Search,
    Image as ImageIcon,
    Video,
    Newspaper,
    TrendingUp,
    MessageSquare,
    Brain
} from 'lucide-react';
import { ResearchCardsGrid, DataCard, CompetitorsCard, ClientDataCard } from './cards';

interface ResearchCardsViewProps {
    jobId: string;
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
    };
    onScrapeCompetitor?: (id: string) => void;
}

/**
 * ResearchCardsView - Card-based layout for research data
 * 2-column grid with expandable cards showing hierarchical data
 */
export function ResearchCardsView({
    jobId,
    client,
    data,
    onScrapeCompetitor
}: ResearchCardsViewProps) {
    return (
        <div className="space-y-6">
            <ResearchCardsGrid>
                {/* Row 1 */}
                <ClientDataCard
                    client={client}
                    socialProfiles={data.socialProfiles}
                    instagramPosts={data.clientPosts.filter((p: any) =>
                        p.postUrl?.includes('instagram.com') ||
                        p.typename?.startsWith('Graph') ||
                        (!p.url?.includes('tiktok') && !p.postUrl?.includes('tiktok'))
                    )}
                    tiktokPosts={data.clientPosts.filter((p: any) =>
                        p.url?.includes('tiktok.com') || p.postUrl?.includes('tiktok.com')
                    )}
                />
                <DataCard
                    title="Search Results"
                    icon={Search}
                    count={data.rawSearchResults.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.rawSearchResults.length} search results found
                    </div>
                </DataCard>

                {/* Row 2 */}
                <CompetitorsCard
                    competitors={data.competitors}
                    onScrapeCompetitor={onScrapeCompetitor}
                />
                <DataCard
                    title="Social Posts"
                    icon={Video}
                    count={data.clientPosts.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.clientPosts.length} posts collected
                    </div>
                </DataCard>

                {/* Row 3 */}
                <DataCard
                    title="Images"
                    icon={ImageIcon}
                    count={data.ddgImageResults.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.ddgImageResults.length} images found
                    </div>
                </DataCard>
                <DataCard
                    title="Videos"
                    icon={Video}
                    count={data.ddgVideoResults.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.ddgVideoResults.length} videos found
                    </div>
                </DataCard>

                {/* Row 4 */}
                <DataCard
                    title="News Articles"
                    icon={Newspaper}
                    count={data.ddgNewsResults.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.ddgNewsResults.length} news articles found
                    </div>
                </DataCard>
                <DataCard
                    title="Search Trends"
                    icon={TrendingUp}
                    count={data.searchTrends.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.searchTrends.length} trends analyzed
                    </div>
                </DataCard>

                {/* Row 5 */}
                <DataCard
                    title="Community Insights"
                    icon={MessageSquare}
                    count={data.communityInsights.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.communityInsights.length} insights collected
                    </div>
                </DataCard>
                <DataCard
                    title="AI Analysis"
                    icon={Brain}
                    count={data.aiQuestions.length}
                    defaultExpanded={false}
                >
                    <div className="text-xs text-muted-foreground">
                        {data.aiQuestions.length} strategic questions answered
                    </div>
                </DataCard>
            </ResearchCardsGrid>
        </div>
    );
}
