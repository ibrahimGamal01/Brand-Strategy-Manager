'use client';

import { useState } from 'react';
import { useResearchJob } from '@/hooks/useResearchJob';
import { useResearchJobEvents } from '@/hooks/useResearchJobEvents';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
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
import { apiClient } from '@/lib/api-client';
import { LiveActivityFeed } from './components/LiveActivityFeed';
import { BrainWorkspacePanel } from './components/brain/BrainWorkspacePanel';

export default function ResearchPage() {
    const params = useParams();
    const router = useRouter();
    const { toast } = useToast();
    const jobId = params.id as string;
    const [activePhase, setActivePhase] = useState<Phase>('intelligence');
    const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');
    const [isContinuing, setIsContinuing] = useState(false);
    const [isSavingContinuity, setIsSavingContinuity] = useState(false);
    const { events, connectionState, isSseHealthy } = useResearchJobEvents(jobId);
    const { data: job, isLoading, error, refetch } = useResearchJob(jobId, { sseHealthy: isSseHealthy });

    async function handleContinueNow() {
        try {
            setIsContinuing(true);
            const payload = await apiClient.continueResearchJob(jobId);

            if (!payload || payload.error || !payload.success) {
                throw new Error(payload?.error || 'Failed to continue research job');
            }

            const result = payload?.result || {};
            const hadErrors = Array.isArray(result?.errors) && result.errors.length > 0;
            toast({
                title: hadErrors ? 'Continuity run finished with warnings' : 'Continuity run started',
                description: hadErrors
                    ? result.errors.slice(0, 2).join(' | ')
                    : `Client targets: ${result.clientProfilesAttempted || 0}, competitor targets: ${result.competitorProfilesAttempted || 0}.`
            });

            await refetch();
        } catch (error: any) {
            toast({
                title: 'Continue failed',
                description: error.message || 'Failed to run continuity cycle',
                variant: 'destructive'
            });
        } finally {
            setIsContinuing(false);
        }
    }

    async function handleSaveContinuity(config: { enabled: boolean; intervalHours: number }) {
        try {
            setIsSavingContinuity(true);
            const intervalHours = Math.max(2, Math.floor(config.intervalHours || 2));
            const payload = await apiClient.updateResearchContinuity(jobId, {
                enabled: config.enabled,
                intervalHours
            });
            if (!payload?.success) throw new Error(payload?.error || 'Failed to save continuity settings');

            toast({
                title: 'Continuity settings saved',
                description: config.enabled
                    ? `Auto-continue enabled every ${intervalHours}h`
                    : 'Auto-continue disabled'
            });

            await refetch();
        } catch (error: any) {
            toast({
                title: 'Save failed',
                description: error.message || 'Failed to save continuity settings',
                variant: 'destructive'
            });
        } finally {
            setIsSavingContinuity(false);
        }
    }

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
    // Deduplicate discovered competitors across stacked runs/jobs by platform+handle.
    // Keep the row with highest selection/status priority, falling back to newest discoveredAt.
    const selectionPriority: Record<string, number> = {
        TOP_PICK: 5,
        APPROVED: 4,
        SHORTLISTED: 3,
        FILTERED_OUT: 2,
        REJECTED: 1,
    };
    const statusPriority: Record<string, number> = {
        SCRAPED: 6,
        SCRAPING: 5,
        CONFIRMED: 4,
        SUGGESTED: 3,
        FAILED: 2,
        REJECTED: 1,
    };
    const dedupedCompetitorRows = new Map<string, any>();
    for (const row of data.discoveredCompetitors || []) {
        const platform = String(row?.platform || '').toLowerCase();
        const handle = String(row?.handle || '').toLowerCase();
        if (!platform || !handle) continue;

        const key = `${platform}:${handle}`;
        const existing = dedupedCompetitorRows.get(key);
        if (!existing) {
            dedupedCompetitorRows.set(key, row);
            continue;
        }

        const nextSelectionRank = selectionPriority[String(row?.selectionState || '').toUpperCase()] || 0;
        const existingSelectionRank = selectionPriority[String(existing?.selectionState || '').toUpperCase()] || 0;
        const nextStatusRank = statusPriority[String(row?.status || '').toUpperCase()] || 0;
        const existingStatusRank = statusPriority[String(existing?.status || '').toUpperCase()] || 0;
        const nextDiscoveredAt = new Date(row?.discoveredAt || 0).getTime();
        const existingDiscoveredAt = new Date(existing?.discoveredAt || 0).getTime();

        if (
            nextDiscoveredAt > existingDiscoveredAt ||
            (nextDiscoveredAt === existingDiscoveredAt && nextSelectionRank > existingSelectionRank) ||
            (nextDiscoveredAt === existingDiscoveredAt &&
                nextSelectionRank === existingSelectionRank &&
                nextStatusRank > existingStatusRank)
        ) {
            dedupedCompetitorRows.set(key, row);
        }
    }

    // Map discoveredCompetitors to competitors format
    const competitors = Array.from(dedupedCompetitorRows.values()).map((dc: any) => {
        const followerCount = dc.competitor?.followerCount ?? dc.followerCount ?? dc.followers;
        return {
            id: dc.id,
            handle: dc.handle,
            platform: dc.platform,
            status: dc.status,
            discoveryReason: dc.discoveryReason,
            relevanceScore: dc.relevanceScore,
            postsScraped: dc.postsScraped,
            profileUrl: dc.profileUrl,
            followerCount,
            followers: followerCount,
            engagement: dc.engagement,
            selectionState: dc.selectionState,
            selectionReason: dc.selectionReason,
            evidence: dc.evidence,
            scoreBreakdown: dc.scoreBreakdown,
            orchestrationRunId: dc.orchestrationRunId,
        };
    }).sort((a: any, b: any) => {
        const selectionRank = (state?: string) => {
            const normalized = String(state || '').toUpperCase();
            if (normalized === 'TOP_PICK') return 5;
            if (normalized === 'APPROVED') return 4;
            if (normalized === 'SHORTLISTED') return 3;
            if (normalized === 'FILTERED_OUT') return 2;
            if (normalized === 'REJECTED') return 1;
            return 0;
        };
        const statusRank = (status?: string) => {
            const normalized = String(status || '').toUpperCase();
            if (normalized === 'SCRAPED') return 5;
            if (normalized === 'SCRAPING') return 4;
            if (normalized === 'CONFIRMED') return 3;
            if (normalized === 'SUGGESTED') return 2;
            if (normalized === 'FAILED') return 1;
            return 0;
        };
        const bySelection = selectionRank(b.selectionState) - selectionRank(a.selectionState);
        if (bySelection !== 0) return bySelection;
        const byScore = (Number(b.relevanceScore) || 0) - (Number(a.relevanceScore) || 0);
        if (byScore !== 0) return byScore;
        return statusRank(b.status) - statusRank(a.status);
    });
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

        if (isTikTok && !isCompetitor) return true;

        return matchesClientHandle;
    });

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
        clientProfileSnapshots: data.clientProfileSnapshots || [],
        competitorProfileSnapshots: data.competitorProfileSnapshots || [],
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
        trendDebug: inputData.trendDebug || undefined,
    };

    return (
        <div className="min-h-screen bg-background">
            <ClientHeader
                client={client}
                job={data}
                onContinueNow={handleContinueNow}
                onSaveContinuity={handleSaveContinuity}
                isContinuing={isContinuing}
                isSavingContinuity={isSavingContinuity}
            />
            <LiveActivityFeed events={events} connectionState={connectionState} />
            <div className="container mx-auto px-6 pt-4">
                <BrainWorkspacePanel jobId={jobId} onRefresh={() => void refetch()} />
            </div>

            {/* Phase Navigation */}
            <PhaseNavigation
                activePhase={activePhase}
                onPhaseChange={setActivePhase}
                strategyStatus={{
                    generated: false,
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
                            onRefreshSection={async (section) => {
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
