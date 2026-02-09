'use client';

import { Users } from 'lucide-react';
import { DataCard } from './DataCard';
import { CompetitorPlatformSection } from './CompetitorPlatformSection';

interface Competitor {
    id: string;
    handle: string;
    platform: string;
    profileUrl?: string;
    relevanceScore?: number;
    status: string;
    discoveryReason?: string;
    followers?: number;
    engagement?: string;
    postsScraped?: number;
}

interface CompetitorsCardProps {
    competitors: Competitor[];
    onScrapeCompetitor?: (id: string) => void;
    className?: string;
}

/**
 * CompetitorsCard - Card showing competitors grouped by platform
 * Expandable tree structure: Competitors → Instagram/TikTok → Individual competitors
 */
export function CompetitorsCard({
    competitors,
    onScrapeCompetitor,
    className = ''
}: CompetitorsCardProps) {
    // Separate competitors by platform
    const instagramCompetitors = competitors.filter(c => c.platform === 'instagram');
    const tiktokCompetitors = competitors.filter(c => c.platform === 'tiktok');

    return (
        <DataCard
            title="Competitors"
            icon={Users}
            count={competitors.length}
            defaultExpanded={competitors.length > 0}
            className={className}
        >
            <div className="space-y-4">
                {/* Instagram Competitors Section */}
                <CompetitorPlatformSection
                    platform="instagram"
                    competitors={instagramCompetitors}
                    onScrapeCompetitor={onScrapeCompetitor}
                />

                {/* TikTok Competitors Section */}
                <CompetitorPlatformSection
                    platform="tiktok"
                    competitors={tiktokCompetitors}
                    onScrapeCompetitor={onScrapeCompetitor}
                />

                {competitors.length === 0 && (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                        <Users className="h-12 w-12 mx-auto mb-3 opacity-20" />
                        <p>No competitors discovered yet.</p>
                        <p className="text-xs mt-1">Use the discovery tools to find competitors.</p>
                    </div>
                )}
            </div>
        </DataCard>
    );
}
