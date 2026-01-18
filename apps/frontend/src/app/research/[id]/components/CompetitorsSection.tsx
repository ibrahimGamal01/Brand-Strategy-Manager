'use client';

import { Users, ExternalLink, MessageSquare, Bot, Search, Code, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/ui/json-viewer';
import { Button } from '@/components/ui/button';

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
    isRunning?: boolean;
}

export function CompetitorsSection({ competitors, onRunScraper, isRunning }: CompetitorsSectionProps) {
    // Group by source using discoveryReason
    // discoveryReason values: 'search_code', 'direct_query', 'ai_suggestion'
    // Fallback to 'search_code' if reason is missing or unknown

    const bySource = {
        ai: competitors.filter(c => c.discoveryReason === 'ai_suggestion'),
        direct: competitors.filter(c => c.discoveryReason === 'direct_query'),
        code: competitors.filter(c => c.discoveryReason === 'search_code' || (!c.discoveryReason || c.discoveryReason === 'ddg_rerun'))
    };

    const renderGroup = (title: string, icon: React.ReactNode, items: Competitor[], colorClass: string, scraperId: string) => {
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
                            disabled={isRunning}
                        >
                            <Play className="h-3 w-3" />
                            Run Source
                        </Button>
                    )}
                </div>

                {items.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {items.map((comp) => (
                            <a
                                key={comp.id}
                                href={comp.profileUrl || `https://instagram.com/${comp.handle}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-4 rounded-lg bg-muted/40 border border-border hover:bg-muted/60 transition-colors group relative"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4 text-muted-foreground" />
                                        <span className="font-semibold text-foreground">@{comp.handle}</span>
                                    </div>
                                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>

                                <div className="flex items-center gap-2 mt-3">
                                    <Badge variant="secondary" className="text-[10px] h-5">{comp.platform}</Badge>
                                    {comp.relevanceScore && (
                                        <span className={`text-[10px] font-mono ${comp.relevanceScore > 0.8 ? 'text-green-500' : 'text-yellow-500'}`}>
                                            {Math.round(comp.relevanceScore * 100)}% match
                                        </span>
                                    )}
                                    {comp.status === 'CONFIRMED' && (
                                        <Badge variant="default" className="text-[10px] h-5 bg-green-600 ml-auto">Confirmed</Badge>
                                    )}
                                </div>
                            </a>
                        ))}
                    </div>
                ) : (
                    <div className="p-4 border border-dashed border-border rounded-lg text-center text-xs text-muted-foreground bg-muted/10">
                        No results from {title} yet. Click "Run Source" to fetch.
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

                {/* 2. Direct Query */}
                {renderGroup(
                    "Direct Search Query",
                    <Search className="h-4 w-4" />,
                    bySource.direct,
                    "text-blue-400",
                    "competitors_direct"
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
