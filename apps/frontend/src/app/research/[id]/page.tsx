'use client';

import { useResearchJob } from '@/hooks/useResearchJob';
import { useParams } from 'next/navigation';
import {
    ClientHeader,
    ResearchFooter,
    AllResearchSections
} from './components';

export default function ResearchPage() {
    const params = useParams();
    const { data: job, isLoading, error } = useResearchJob(params.id as string);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
                    <p className="text-muted-foreground font-mono text-sm">Loading research data...</p>
                </div>
            </div>
        );
    }

    if (error || !job) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center text-destructive">
                    <p>Failed to load research data</p>
                    <p className="text-sm text-muted-foreground mt-2">{(error as Error)?.message}</p>
                </div>
            </div>
        );
    }

    const data = job as any;
    const client = data.client || {};

    // Flatten nested data for easier consumption
    const clientPosts = client.clientAccounts?.flatMap((acc: any) => acc.clientPosts || []) || [];
    const rawSearchResults = data.rawSearchResults || [];
    const ddgImageResults = data.ddgImageResults || [];
    const ddgVideoResults = data.ddgVideoResults || [];
    const ddgNewsResults = data.ddgNewsResults || [];
    const searchTrends = data.searchTrends || [];
    const competitors = data.discoveredCompetitors || [];
    const communityInsights = data.communityInsights || [];
    const mediaAssets = data.mediaAssets || []; // Backend might validly optionally return this top-level or derived
    const aiQuestions = data.aiQuestions || [];

    // Combine all data into one object
    const researchData = {
        clientPosts,
        rawSearchResults,
        ddgImageResults,
        ddgVideoResults,
        ddgNewsResults,
        searchTrends,
        competitors,
        communityInsights,
        mediaAssets,
        aiQuestions
    };

    return (
        <div className="min-h-screen bg-background">
            <ClientHeader client={client} job={data} />

            {/* Unified Info Gathering Dashboard */}
            <div className="container mx-auto px-6 py-8">
                <div className="flex items-center gap-2 mb-6">
                    <h2 className="text-xl font-semibold tracking-tight">Intelligence Gathering</h2>
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-mono text-muted-foreground">
                        {Object.values(researchData).reduce((acc, arr) => acc + (arr?.length || 0), 0)} total data points
                    </span>
                </div>

                <AllResearchSections
                    jobId={data.id}
                    status={data.status}
                    client={client}
                    data={researchData}
                />
            </div>

            <ResearchFooter jobId={data.id} />
        </div>
    );
}
