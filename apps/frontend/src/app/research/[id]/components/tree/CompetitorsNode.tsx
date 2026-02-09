'use client';

import { useState } from 'react';
import {
    Users, RefreshCw, Instagram, Video, ExternalLink, Loader2, Download
} from 'lucide-react';
import { TreeNodeCard } from './TreeNodeCard';
import { CompetitorPostsSection } from '../competitor/CompetitorPostsSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';

interface CompetitorsNodeProps {
    competitors: any[];
    socialProfiles: any[];
    onRefreshSection?: (section: string) => void;
}

export function CompetitorsNode({ competitors, socialProfiles, onRefreshSection }: CompetitorsNodeProps) {
    const { toast } = useToast();
    const [scrapingIds, setScrapingIds] = useState<Record<string, boolean>>({});

    // Categorize competitors
    const instagramCompetitors = competitors.filter((c: any) => c?.platform === 'instagram');
    const tiktokCompetitors = competitors.filter((c: any) => c?.platform === 'tiktok');

    // Helper: Find social profile ID for a competitor based on handle/platform match
    const getSocialProfileId = (competitorHandle: string, platform: string): string | undefined => {
        const profile = socialProfiles.find((p: any) =>
            p.platform === platform && p.handle === competitorHandle
        );
        return profile?.id;
    };

    const handleScrape = async (competitorId: string, handle: string) => {
        try {
            setScrapingIds(prev => ({ ...prev, [competitorId]: true }));
            await apiClient.scrapeCompetitor(competitorId);
            toast({
                title: "Scraping Started",
                description: `Started scraping posts for @${handle}. This may take a few moments.`,
            });
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
                    {instagramCompetitors.length > 0 && (
                        <TreeNodeCard
                            title="Instagram Competitors"
                            icon={<Instagram className="h-4 w-4 text-pink-500" />}
                            count={instagramCompetitors.length}
                            level={2}
                            defaultExpanded={true}
                        >
                            {instagramCompetitors.map((comp: any) => (
                                <CompetitorNodeItem
                                    key={comp.id}
                                    comp={comp}
                                    scrapingIds={scrapingIds}
                                    handleScrape={handleScrape}
                                    getSocialProfileId={getSocialProfileId}
                                    onRefreshSection={onRefreshSection}
                                    platform="instagram"
                                />
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
                                <CompetitorNodeItem
                                    key={comp.id}
                                    comp={comp}
                                    scrapingIds={scrapingIds}
                                    handleScrape={handleScrape}
                                    getSocialProfileId={getSocialProfileId}
                                    onRefreshSection={onRefreshSection}
                                    platform="tiktok"
                                />
                            ))}
                        </TreeNodeCard>
                    )}
                </>
            )}
        </TreeNodeCard>
    );
}

// Sub-component for individual competitor item to keep main file cleaner
function CompetitorNodeItem({ comp, scrapingIds, handleScrape, getSocialProfileId, onRefreshSection, platform }: any) {
    const isInstagram = platform === 'instagram';
    const profileUrl = isInstagram
        ? (comp.profileUrl || `https://instagram.com/${comp.handle}`)
        : (comp.profileUrl || `https://tiktok.com/@${comp.handle}`);

    return (
        <TreeNodeCard
            title={
                <div className="flex items-center gap-2 w-full">
                    <span className="font-semibold">@{comp.handle}</span>
                    {comp.relevanceScore && (
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">
                            {Math.round(comp.relevanceScore * 100)}% Match
                        </Badge>
                    )}
                    {comp.postsScraped > 0 && (
                        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${isInstagram ? 'border-pink-500/30 text-pink-500 bg-pink-500/5' : 'border-blue-500/30 text-blue-500 bg-blue-500/5'}`}>
                            {comp.postsScraped} posts
                        </Badge>
                    )}
                </div>
            }
            icon={<div className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] ${isInstagram ? 'bg-pink-400 shadow-pink-500/50' : 'bg-blue-400 shadow-blue-500/50'}`} />}
            level={3}
            defaultExpanded={false}
            actions={
                <div className="flex items-center gap-2">
                    <Badge variant={comp.status === 'SCRAPED' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 h-5">
                        {comp.status}
                    </Badge>
                    <a
                        href={profileUrl}
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
                        className={`w-full text-xs gap-2 h-9 text-white ${isInstagram ? 'bg-pink-600 hover:bg-pink-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {scrapingIds[comp.id] ? (
                            <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Scraping...
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
                        platform={platform}
                        postsCount={comp.postsScraped}
                        profileId={getSocialProfileId(comp.handle, platform)}
                        onRefresh={() => onRefreshSection?.('competitors')}
                    />
                )}
            </div>
        </TreeNodeCard>
    );
}
