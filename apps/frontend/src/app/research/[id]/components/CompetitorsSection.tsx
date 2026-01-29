import { Users, ExternalLink, Bot, Code, Play, Loader2, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/ui/json-viewer';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { toast } from 'sonner';

interface Competitor {
    id: string;
    handle: string;
    platform: string;
    profileUrl?: string;
    relevanceScore?: number;
    status: string;
    discoveryReason?: string;
}

interface CompetitorsSectionProps {
    competitors: Competitor[];
    onRunScraper?: (scraperId: string) => void;
    runningScrapers?: Record<string, boolean>;
}

export function CompetitorsSection({ competitors, onRunScraper, runningScrapers = {} }: CompetitorsSectionProps) {
    const [scrapingCompetitors, setScrapingCompetitors] = useState<Record<string, boolean>>({});

    // Robust checks for discovery reason
    const getReason = (c: Competitor) => (c.discoveryReason || '').toLowerCase();
    const isAi = (c: Competitor) => getReason(c).includes('ai_suggestion');
    const isDirect = (c: Competitor) => getReason(c).includes('direct_query');

    // Categorize competitors - 'code' is the catch-all for algorithmic/other results
    const bySource = {
        ai: competitors.filter(isAi),
        direct: competitors.filter(isDirect),
        code: competitors.filter(c => !isAi(c) && !isDirect(c))
    };

    const handleScrape = async (competitor: Competitor) => {
        if (!competitor.id || !competitor.platform) return;

        const platform = competitor.platform.toUpperCase();
        if (platform !== 'INSTAGRAM' && platform !== 'TIKTOK') {
            toast.error('Only Instagram and TikTok scraping supported currently');
            return;
        }

        setScrapingCompetitors(prev => ({ ...prev, [competitor.id]: true }));
        toast.info(`Starting scrape for @${competitor.handle}...`);

        try {
            const response = await fetch(`/api/scrapers/${competitor.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform })
            });

            if (!response.ok) throw new Error('Scraping failed');

            const result = await response.json();
            if (result.success) {
                toast.success(`Scraped ${result.postsScraped} posts from @${competitor.handle}`);
            } else {
                toast.error(`Scraping failed: ${result.error}`);
            }
        } catch (error) {
            console.error(error);
            toast.error('Failed to start scraping');
        } finally {
            setScrapingCompetitors(prev => ({ ...prev, [competitor.id]: false }));
        }
    };

    const renderGroup = (title: string, icon: React.ReactNode, items: Competitor[], colorClass: string, scraperId: string) => {
        const isThisRunning = runningScrapers[scraperId];

        return (
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className={`text-sm font-medium flex items-center gap-2 ${colorClass}`}>
                        {icon}
                        {title} ({items.length})
                    </h4>
                    {onRunScraper && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => onRunScraper(scraperId)}
                            disabled={isThisRunning}
                        >
                            {isThisRunning ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <Play className="h-3 w-3" />
                            )}
                            {isThisRunning ? 'Running...' : 'Run Discovery'}
                        </Button>
                    )}
                </div>

                {items.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {items.map((comp) => (
                            <div
                                key={comp.id}
                                className="p-4 rounded-lg bg-muted/40 border border-border hover:bg-muted/60 transition-colors group relative flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                            <a
                                                href={comp.profileUrl || `https://instagram.com/${comp.handle}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-semibold text-foreground hover:underline"
                                            >
                                                @{comp.handle}
                                            </a>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleScrape(comp)}
                                                disabled={scrapingCompetitors[comp.id]}
                                                className="text-xs flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                                                title="Scrape Posts"
                                            >
                                                {scrapingCompetitors[comp.id] ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <Download className="h-3 w-3" />
                                                )}
                                            </button>
                                            <a
                                                href={comp.profileUrl || `https://instagram.com/${comp.handle}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground transition-colors" />
                                            </a>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                                        <Badge variant="secondary" className="text-[10px] h-5">{comp.platform}</Badge>
                                        {comp.relevanceScore !== undefined && (
                                            <span className={`text-[10px] font-mono ${comp.relevanceScore > 0.8 ? 'text-green-500' : 'text-yellow-500'}`}>
                                                {Math.round(comp.relevanceScore * 100)}% match
                                            </span>
                                        )}
                                        {comp.status === 'CONFIRMED' && (
                                            <Badge variant="default" className="text-[10px] h-5 bg-green-600 ml-auto">Confirmed</Badge>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-2 pt-2 border-t border-border/30">
                                    <p className="text-[10px] text-muted-foreground truncate" title={comp.discoveryReason}>
                                        src: {comp.discoveryReason || 'unknown'}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-4 border border-dashed border-border rounded-lg text-center text-xs text-muted-foreground bg-muted/10">
                        No results from {title} yet. Click "Run Discovery" to fetch.
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-8">
            <div className="grid gap-8">
                {/* 1. AI Suggestions */}
                {renderGroup(
                    "AI Suggestions",
                    <Bot className="h-4 w-4" />,
                    bySource.ai,
                    "text-purple-400",
                    "competitors_ai"
                )}

                {/* 3. Search Code (Algorithmic) */}
                {renderGroup(
                    "Algorithmic Search",
                    <Code className="h-4 w-4" />,
                    bySource.code,
                    "text-orange-400",
                    "competitors_code"
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
