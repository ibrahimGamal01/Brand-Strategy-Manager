'use client';

import { useState } from 'react';
import { Download, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CompetitorRow } from './CompetitorRow';

interface Competitor {
    id: string;
    handle: string;
    platform: string;
    profileUrl?: string;
    relevanceScore?: number;
    status: 'SUGGESTED' | 'SCRAPING' | 'SCRAPED' | 'FAILED';
    discoveryReason?: string;
    postsScraped?: number;
    scrapedAt?: string;
}

interface ScrapingPipelineCardProps {
    competitors: Competitor[];
    onScrapeAll?: () => void;
    onScrapeOne?: (id: string) => void;
    onEditCompetitor?: (id: string, updates: Partial<Competitor>) => void;
    onDeleteCompetitor?: (id: string) => void;
    isScrapingAll?: boolean;
    className?: string;
}

/**
 * ScrapingPipelineCard - Card for managing scraping queue
 * Features:
 * - Show pending and scraped competitors
 * - Batch scrape all pending
 * - Individual scrape actions
 * - Progress indicators
 */
export function ScrapingPipelineCard({
    competitors,
    onScrapeAll,
    onScrapeOne,
    onEditCompetitor,
    onDeleteCompetitor,
    isScrapingAll = false,
    className = ''
}: ScrapingPipelineCardProps) {
    const [showPending, setShowPending] = useState(true);
    const [showScraped, setShowScraped] = useState(false);

    // Categorize competitors
    const pending = competitors.filter(c => c.status === 'SUGGESTED');
    const scraping = competitors.filter(c => c.status === 'SCRAPING');
    const scraped = competitors.filter(c => c.status === 'SCRAPED');
    const failed = competitors.filter(c => c.status === 'FAILED');

    const totalPosts = scraped.reduce((sum, c) => sum + (c.postsScraped || 0), 0);

    return (
        <div className={`space-y-3 ${className}`}>
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-2">
                <div className="p-2 rounded-lg bg-muted/30 border border-border">
                    <div className="text-xs text-muted-foreground">Pending</div>
                    <div className="text-lg font-bold">{pending.length}</div>
                </div>
                <div className="p-2 rounded-lg bg-muted/30 border border-border">
                    <div className="text-xs text-muted-foreground">Scraping</div>
                    <div className="text-lg font-bold flex items-center gap-1">
                        {scraping.length}
                        {scraping.length > 0 && <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />}
                    </div>
                </div>
                <div className="p-2 rounded-lg bg-muted/30 border border-border">
                    <div className="text-xs text-muted-foreground">Scraped</div>
                    <div className="text-lg font-bold text-green-500">{scraped.length}</div>
                </div>
                <div className="p-2 rounded-lg bg-muted/30 border border-border">
                    <div className="text-xs text-muted-foreground">Total Posts</div>
                    <div className="text-lg font-bold">{totalPosts}</div>
                </div>
            </div>

            {/* Pending Queue */}
            {pending.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowPending(!showPending)}
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                    >
                        {showPending ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronRight className="h-3 w-3" />
                        )}
                        <span className="font-medium">Pending Queue ({pending.length})</span>
                        <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                            Ready
                        </Badge>
                    </button>

                    {showPending && (
                        <div className="mt-2 space-y-2">
                            {pending.map((competitor) => (
                                <CompetitorRow
                                    key={competitor.id}
                                    competitor={competitor}
                                    onEdit={onEditCompetitor}
                                    onDelete={onDeleteCompetitor}
                                    onScrape={onScrapeOne}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Currently Scraping */}
            {scraping.length > 0 && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground w-full mb-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="font-medium">Currently Scraping ({scraping.length})</span>
                    </div>

                    <div className="space-y-2">
                        {scraping.map((competitor) => (
                            <CompetitorRow
                                key={competitor.id}
                                competitor={competitor}
                                onEdit={onEditCompetitor}
                                onDelete={onDeleteCompetitor}
                                isScraping={true}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Scraped Competitors */}
            {scraped.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowScraped(!showScraped)}
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                    >
                        {showScraped ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronRight className="h-3 w-3" />
                        )}
                        <span className="font-medium">Scraped ({scraped.length})</span>
                        <Badge variant="default" className="text-[10px] h-5 ml-auto bg-green-600">
                            Complete
                        </Badge>
                    </button>

                    {showScraped && (
                        <div className="mt-2 space-y-2">
                            {scraped.map((competitor) => (
                                <CompetitorRow
                                    key={competitor.id}
                                    competitor={competitor}
                                    onEdit={onEditCompetitor}
                                    onDelete={onDeleteCompetitor}
                                    onScrape={onScrapeOne}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Failed Scrapes */}
            {failed.length > 0 && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground w-full mb-2">
                        <span className="font-medium">Failed ({failed.length})</span>
                        <Badge variant="destructive" className="text-[10px] h-5 ml-auto">
                            Error
                        </Badge>
                    </div>

                    <div className="space-y-2">
                        {failed.map((competitor) => (
                            <CompetitorRow
                                key={competitor.id}
                                competitor={competitor}
                                onEdit={onEditCompetitor}
                                onDelete={onDeleteCompetitor}
                                onScrape={onScrapeOne}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Actions Section */}
            {onScrapeAll && pending.length > 0 && (
                <div className="flex justify-end pt-2 border-t border-border/30">
                    <Button
                        variant="default"
                        size="sm"
                        onClick={onScrapeAll}
                        disabled={isScrapingAll || scraping.length > 0}
                        className="text-xs gap-2"
                    >
                        <Download className="h-3 w-3" />
                        {isScrapingAll ? 'Scraping All...' : `Scrape All Pending (${pending.length})`}
                    </Button>
                </div>
            )}
        </div>
    );
}
