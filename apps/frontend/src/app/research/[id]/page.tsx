'use client';

import { useState } from 'react';
import { useResearchJob } from '@/hooks/useResearchJob';
import { useParams, useRouter } from 'next/navigation';
import {
    ClientHeader,
    ResearchFooter,
    AllResearchSections
} from './components';
import { ResearchTreeView } from './components/ResearchTreeView';
import PhaseNavigation, { Phase } from './components/PhaseNavigation';
import StrategyWorkspace from './components/strategy/StrategyWorkspace';
import { Button } from '@/components/ui/button';
import { LayoutGrid, List } from 'lucide-react';

export default function ResearchPage() {
    const params = useParams();
    const router = useRouter();
    const [activePhase, setActivePhase] = useState<Phase>('intelligence');
    const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');
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

    // Get input data from research job for handle and niche
    const inputData = data.inputData || {};

    // Extract Instagram handle from clientAccounts or inputData
    const instagramAccount = client.clientAccounts?.find((acc: any) => acc.platform === 'instagram');
    const primaryHandle = instagramAccount?.handle || inputData.handle || inputData.handles?.instagram || '';

    // Add handle to client object for backward compatibility
    client.handle = primaryHandle;

    // Flatten nested data for easier consumption
    const clientPosts = client.clientAccounts?.flatMap((acc: any) => acc.clientPosts || []) || [];
    const rawSearchResults = data.rawSearchResults || [];
    const ddgImageResults = data.ddgImageResults || [];
    const ddgVideoResults = data.ddgVideoResults || [];
    const ddgNewsResults = data.ddgNewsResults || [];
    const searchTrends = data.searchTrends || [];
    // Map discoveredCompetitors to competitors format
    const competitors = (data.discoveredCompetitors || []).map((dc: any) => ({
        id: dc.id,
        handle: dc.handle,
        platform: dc.platform,
        status: dc.status,
        discoveryReason: dc.discoveryReason,
        relevanceScore: dc.relevanceScore,
        postsScraped: dc.postsScraped,
        profileUrl: dc.profileUrl,
        followers: dc.followers,
        engagement: dc.engagement
    }));
    const communityInsights = data.communityInsights || [];
    const mediaAssets = data.mediaAssets || [];
    const aiQuestions = data.aiQuestions || [];

    // Build specific allowlist of Client handles to prevent Competitor pollution
    const clientHandles = new Set<string>();

    // Add known client handles to allowlist
    (client.clientAccounts || []).forEach((acc: any) => {
        if (acc.handle) clientHandles.add(acc.handle.toLowerCase());
    });

    if (inputData.handle) clientHandles.add(inputData.handle.toLowerCase());
    if (inputData.handles) {
        Object.values(inputData.handles).forEach((h: any) => {
            if (typeof h === 'string' && h) clientHandles.add(h.toLowerCase());
        });
    }

    // Build set of competitor handles to exclude them provided they are indeed competitors
    const competitorHandles = new Set<string>();
    competitors.forEach((c: any) => {
        if (c.handle) competitorHandles.add(c.handle.toLowerCase());
    });

    // Filter API data to ONLY show profiles that match the client's known handles
    // This fixes the issue where competitor profiles (linked to the same Job ID) were appearing in the Client section
    const apiSocialProfiles = (data.socialProfiles || []).filter((p: any) => {
        if (!p.handle) return false;
        const handleLower = p.handle.toLowerCase();

        // 1. Check if it matches a known client handle
        const matchesClientHandle = clientHandles.has(handleLower);

        // 2. Special exception for TikTok: 
        // If it's TikTok and NOT a known competitor, assume it's the client (or at least valid to show)
        // This handles cases where the TikTok handle wasn't explicitly entered in the input form
        const isTikTok = p.platform?.toLowerCase() === 'tiktok';
        const isCompetitor = competitorHandles.has(handleLower);

        if (isTikTok && !isCompetitor) {
            console.log(`[ResearchPage] Allowing TikTok profile: ${p.handle} (Not a competitor)`);
            return true;
        }

        return matchesClientHandle;
    });

    console.log('[ResearchPage] Client Handles:', Array.from(clientHandles));
    console.log('[ResearchPage] All Social Profiles:', data.socialProfiles?.map((p: any) => `${p.platform}:${p.handle}`));
    console.log('[ResearchPage] Filtered API Profiles:', apiSocialProfiles.map((p: any) => `${p.platform}:${p.handle}`));

    // Use filtered data if available, otherwise fallback to constructing from accounts
    let socialProfiles = apiSocialProfiles.length > 0
        ? apiSocialProfiles
        : (client.clientAccounts || []).map((acc: any) => ({
            platform: acc.platform,
            handle: acc.handle,
            followers: acc.followerCount || 0,
            following: acc.followingCount || 0,
            bio: acc.bio || '',
            profileImageUrl: acc.profileImageUrl,
        }));

    // Sort profiles: Instagram > TikTok > Others
    socialProfiles = socialProfiles.sort((a: any, b: any) => {
        const priority = { instagram: 1, tiktok: 2 };
        const p1 = priority[a.platform?.toLowerCase() as keyof typeof priority] || 99;
        const p2 = priority[b.platform?.toLowerCase() as keyof typeof priority] || 99;
        return p1 - p2;
    });

    // Combine all data into one object
    const tiktokProfile = socialProfiles.find((p: any) => p.platform === 'tiktok');
    const tiktokPosts = tiktokProfile?.posts || [];

    const researchData = {
        clientPosts,
        tiktokPosts, // Pass explicit tiktokPosts
        rawSearchResults,
        ddgImageResults,
        ddgVideoResults,
        ddgNewsResults,
        searchTrends,
        competitors,
        communityInsights,
        mediaAssets,
        aiQuestions,
        socialProfiles,
        brandMentions: client.brandMentions || [],
        clientDocuments: client.clientDocuments || [],
    };

    return (
        <div className="min-h-screen bg-background">
            <ClientHeader client={client} job={data} />

            {/* Phase Navigation */}
            <PhaseNavigation
                activePhase={activePhase}
                onPhaseChange={setActivePhase}
                strategyStatus={{
                    generated: false, // TODO: Check if strategy document exists
                    sectionsComplete: 0,
                    totalSections: 9
                }}
            />

            {/* Conditional Content Based on Active Phase */}
            {activePhase === 'intelligence' ? (
                <div className="container mx-auto px-6 py-8">
                    <div className="flex items-center gap-2 mb-6">
                        <h2 className="text-xl font-semibold tracking-tight">Intelligence Gathering</h2>
                        <div className="h-px flex-1 bg-border" />

                        {/* View Toggle Buttons */}
                        <div className="flex gap-1 border rounded-lg p-1">
                            <Button
                                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setViewMode('cards')}
                                className="gap-2"
                            >
                                <LayoutGrid className="h-4 w-4" />
                                Cards
                            </Button>
                            <Button
                                variant={viewMode === 'list' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className="gap-2"
                            >
                                <List className="h-4 w-4" />
                                List
                            </Button>
                        </div>

                        <span className="text-xs font-mono text-muted-foreground">
                            {Object.values(researchData).reduce((acc, arr) => acc + (arr?.length || 0), 0)} total data points
                        </span>
                    </div>

                    {viewMode === 'cards' ? (
                        <ResearchTreeView
                            jobId={data.id}
                            client={client}
                            data={researchData}
                            onScrapeCompetitor={async (id) => {
                                console.log('Scrape competitor', id);
                            }}
                            onRefreshSection={async (section) => {
                                console.log('Refresh section:', section);
                                router.refresh();
                            }}
                        />
                    ) : (
                        <AllResearchSections
                            jobId={data.id}
                            status={data.status}
                            client={client}
                            data={researchData}
                        />
                    )}
                </div>
            ) : (
                <StrategyWorkspace jobId={data.id} />
            )}

            <ResearchFooter jobId={data.id} />
        </div>
    );
}
