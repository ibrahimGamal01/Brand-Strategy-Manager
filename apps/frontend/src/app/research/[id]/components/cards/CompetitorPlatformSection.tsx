'use client';

import { useState } from 'react';
import { Instagram, Video, ChevronDown, ChevronRight, ExternalLink, Download, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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

interface CompetitorPlatformSectionProps {
    platform: 'instagram' | 'tiktok';
    competitors: Competitor[];
    onScrapeCompetitor?: (id: string) => void;
    className?: string;
}

/**
 * CompetitorPlatformSection - Shows competitors per platform with expandable details
 */
export function CompetitorPlatformSection({
    platform,
    competitors,
    onScrapeCompetitor,
    className = ''
}: CompetitorPlatformSectionProps) {
    const [isExpanded, setIsExpanded] = useState(competitors.length > 0);
    const [expandedCompetitors, setExpandedCompetitors] = useState<Record<string, boolean>>({});
    const [scrapingIds, setScrapingIds] = useState<Record<string, boolean>>({});

    const Icon = platform === 'instagram' ? Instagram : Video;
    const platformName = platform === 'instagram' ? 'Instagram' : 'TikTok';
    const colorClass = platform === 'instagram' ? 'text-pink-500' : 'text-blue-500';

    const toggleCompetitor = (id: string) => {
        setExpandedCompetitors(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const handleScrape = async (competitor: Competitor) => {
        if (!onScrapeCompetitor) return;

        setScrapingIds(prev => ({ ...prev, [competitor.id]: true }));
        try {
            await onScrapeCompetitor(competitor.id);
        } finally {
            setScrapingIds(prev => ({ ...prev, [competitor.id]: false }));
        }
    };

    if (competitors.length === 0) {
        return (
            <div className={`p-4 border border-dashed rounded-lg text-center ${className}`}>
                <Icon className={`h-8 w-8 mx-auto mb-2 ${colorClass} opacity-50`} />
                <p className="text-sm text-muted-foreground">
                    No {platformName} competitors discovered yet
                </p>
            </div>
        );
    }

    return (
        <div className={`space-y-2 ${className}`}>
            {/* Platform Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 w-full hover:bg-muted/50 p-2 rounded-lg transition-colors"
            >
                {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                ) : (
                    <ChevronRight className="h-4 w-4" />
                )}
                <Icon className={`h-4 w-4 ${colorClass}`} />
                <span className="font-medium text-sm">
                    {platformName} Competitors ({competitors.length})
                </span>
            </button>

            {/* Competitors List */}
            {isExpanded && (
                <div className="space-y-2 pl-6">
                    {competitors.map((competitor) => (
                        <div
                            key={competitor.id}
                            className="border rounded-lg overflow-hidden hover:border-primary/50 transition-colors"
                        >
                            {/* Competitor Header */}
                            <div
                                onClick={() => toggleCompetitor(competitor.id)}
                                className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                            >
                                <div className="flex items-center gap-3 flex-1">
                                    {expandedCompetitors[competitor.id] ? (
                                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                    )}
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm">@{competitor.handle}</span>
                                            {competitor.relevanceScore && (
                                                <span className="text-xs text-muted-foreground font-mono">
                                                    {Math.round(competitor.relevanceScore * 100)}%
                                                </span>
                                            )}
                                        </div>
                                        {competitor.followers && (
                                            <p className="text-xs text-muted-foreground">
                                                {competitor.followers.toLocaleString()} followers
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-[10px]">
                                        {competitor.status}
                                    </Badge>
                                    <a
                                        href={competitor.profileUrl || `https://${platform}.com/${competitor.handle}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                            </div>

                            {/* Competitor Details (Expanded) */}
                            {expandedCompetitors[competitor.id] && (
                                <div className="p-4 bg-muted/20 border-t space-y-3">
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div>
                                            <span className="text-muted-foreground">Followers:</span>
                                            <span className="ml-2 font-medium">
                                                {competitor.followers?.toLocaleString() || 'N/A'}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">Engagement:</span>
                                            <span className="ml-2 font-medium">
                                                {competitor.engagement || 'N/A'}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">Posts Scraped:</span>
                                            <span className="ml-2 font-medium">
                                                {competitor.postsScraped || 0}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">Status:</span>
                                            <span className="ml-2 font-medium">
                                                {competitor.status}
                                            </span>
                                        </div>
                                    </div>

                                    {onScrapeCompetitor && competitor.status === 'SUGGESTED' && (
                                        <Button
                                            onClick={() => handleScrape(competitor)}
                                            disabled={scrapingIds[competitor.id]}
                                            size="sm"
                                            variant="outline"
                                            className="w-full text-xs gap-2"
                                        >
                                            {scrapingIds[competitor.id] ? (
                                                <>
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                    Scraping...
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="h-3 w-3" />
                                                    Scrape Posts
                                                </>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
