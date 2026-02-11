import { Users, ExternalLink, Play, Loader2, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/ui/json-viewer';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';

interface Competitor {
    id: string;
    handle: string;
    platform: string;
    profileUrl?: string;
    relevanceScore?: number;
    status: string;
    discoveryReason?: string;
    selectionState?: string;
}

interface CompetitorsSectionProps {
    competitors: Competitor[];
    onRunScraper?: (scraperId: string) => void;
    runningScrapers?: Record<string, boolean>;
}

export function CompetitorsSection({ competitors, onRunScraper, runningScrapers = {} }: CompetitorsSectionProps) {
    const [scrapingCompetitors, setScrapingCompetitors] = useState<Record<string, boolean>>({});
    const [showFilteredCompetitors, setShowFilteredCompetitors] = useState(false);
    const isDiscoveryRunning = runningScrapers.competitors === true;
    const isFilteredSelectionState = (selectionState?: string) => {
        const normalized = String(selectionState || '').toUpperCase();
        return normalized === 'FILTERED_OUT' || normalized === 'REJECTED';
    };
    const hiddenCompetitorsCount = competitors.filter((competitor) =>
        isFilteredSelectionState(competitor.selectionState)
    ).length;
    const visibleCompetitors = showFilteredCompetitors
        ? competitors
        : competitors.filter((competitor) => !isFilteredSelectionState(competitor.selectionState));

    const handleScrape = async (competitor: Competitor) => {
        if (!competitor.id || !competitor.platform) return;
        const platform = competitor.platform.toLowerCase();
        if (platform !== 'instagram' && platform !== 'tiktok') {
            toast.error('Only Instagram and TikTok scraping are supported.');
            return;
        }

        setScrapingCompetitors((previous) => ({ ...previous, [competitor.id]: true }));
        toast.info(`Queueing @${competitor.handle} for scraping...`);
        try {
            const response = await apiClient.scrapeCompetitor(competitor.id);
            if (response?.success === false) {
                throw new Error(response?.error || 'Scraping failed');
            }
            toast.success(`Queued @${competitor.handle} successfully.`);
        } catch (error: any) {
            toast.error(error?.message || `Failed to queue @${competitor.handle}`);
        } finally {
            setScrapingCompetitors((previous) => ({ ...previous, [competitor.id]: false }));
        }
    };

    return (
        <div className="space-y-8">
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium flex items-center gap-2 text-cyan-400">
                        <Users className="h-4 w-4" />
                        Discovered Competitors ({visibleCompetitors.length})
                    </h4>
                    <div className="flex items-center gap-2">
                        {hiddenCompetitorsCount > 0 ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setShowFilteredCompetitors((previous) => !previous)}
                            >
                                {showFilteredCompetitors
                                    ? `Hide Filtered (${hiddenCompetitorsCount})`
                                    : `Show Filtered (${hiddenCompetitorsCount})`}
                            </Button>
                        ) : null}
                        {onRunScraper ? (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => onRunScraper('competitors')}
                                disabled={isDiscoveryRunning}
                            >
                                {isDiscoveryRunning ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Play className="h-3 w-3" />
                                )}
                                {isDiscoveryRunning ? 'Running...' : 'Continue Discovery'}
                            </Button>
                        ) : null}
                    </div>
                </div>

                {visibleCompetitors.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {visibleCompetitors.map((competitor) => {
                            const isFiltered = isFilteredSelectionState(competitor.selectionState);
                            const isQueueableStatus =
                                String(competitor.status || '').toUpperCase() === 'SUGGESTED' ||
                                String(competitor.status || '').toUpperCase() === 'FAILED';
                            const canContinueScrape = !isFiltered && isQueueableStatus;
                            return (
                            <div
                                key={competitor.id}
                                className="p-4 rounded-lg bg-muted/40 border border-border hover:bg-muted/60 transition-colors group relative flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                                            <a
                                                href={competitor.profileUrl || `https://instagram.com/${competitor.handle}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-semibold text-foreground hover:underline truncate"
                                            >
                                                @{competitor.handle}
                                            </a>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            {canContinueScrape ? (
                                                <button
                                                    onClick={() => handleScrape(competitor)}
                                                    disabled={scrapingCompetitors[competitor.id]}
                                                    className="text-xs flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                                                    title="Continue Scrape"
                                                >
                                                    {scrapingCompetitors[competitor.id] ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <Download className="h-3 w-3" />
                                                    )}
                                                </button>
                                            ) : (
                                                <span className="text-[10px] text-muted-foreground">
                                                    Not scrape-ready
                                                </span>
                                            )}
                                            <a
                                                href={competitor.profileUrl || `https://instagram.com/${competitor.handle}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground transition-colors" />
                                            </a>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                                        <Badge variant="secondary" className="text-[10px] h-5">
                                            {competitor.platform}
                                        </Badge>
                                        {typeof competitor.relevanceScore === 'number' ? (
                                            <span
                                                className={`text-[10px] font-mono ${competitor.relevanceScore > 0.8 ? 'text-green-500' : 'text-yellow-500'
                                                    }`}
                                            >
                                                {Math.round(competitor.relevanceScore * 100)}% match
                                            </span>
                                        ) : null}
                                        {competitor.selectionState ? (
                                            <Badge variant="outline" className="text-[10px] h-5 uppercase ml-auto">
                                                {competitor.selectionState.replaceAll('_', ' ')}
                                            </Badge>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="mt-2 pt-2 border-t border-border/30">
                                    <p className="text-[10px] text-muted-foreground truncate" title={competitor.discoveryReason}>
                                        src: {competitor.discoveryReason || 'unknown'}
                                    </p>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="p-4 border border-dashed border-border rounded-lg text-center text-xs text-muted-foreground bg-muted/10">
                        {hiddenCompetitorsCount > 0
                            ? 'All discovered competitors are currently filtered out. Use Continue Discovery or Show Filtered.'
                            : 'No competitors yet. Continue Discovery to generate an evidence-based shortlist.'}
                    </div>
                )}
            </div>

            <div className="pt-4 border-t border-border/50">
                <JsonViewer
                    data={competitors}
                    title="Raw Competitor Data (JSON)"
                    defaultExpanded={false}
                />
            </div>
        </div>
    );
}
