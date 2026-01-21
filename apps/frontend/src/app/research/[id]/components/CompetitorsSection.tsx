'use client';

import { Users, ExternalLink, MessageSquare, Bot, Search, Code, Play, Loader2 } from 'lucide-react';
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
    runningScrapers?: Record<string, boolean>;
}

export function CompetitorsSection({ competitors, onRunScraper, runningScrapers = {} }: CompetitorsSectionProps) {
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
                            {isThisRunning ? 'Running...' : 'Run Source'}
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
                                className="p-4 rounded-lg bg-muted/40 border border-border hover:bg-muted/60 transition-colors group relative flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                            <span className="font-semibold text-foreground">@{comp.handle}</span>
                                        </div>
                                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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
            {/* DIAGNOSTIC DATA - REMOVE AFTER DEBUGGING */}
            <div className="p-4 bg-slate-950 border border-red-900/50 rounded-md text-xs font-mono mb-6 shadow-sm">
                <h5 className="font-bold text-red-400 mb-2 uppercase tracking-wider">Diagnostic Data (Temporary)</h5>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <span className="text-slate-500 block mb-1">Total Items:</span>
                        <span className="text-white font-bold">{competitors.length}</span>
                    </div>
                    <div>
                        <span className="text-slate-500 block mb-1">Data Keys (First Item):</span>
                        <div className="text-slate-300 break-words">
                            {competitors.length > 0 ? Object.keys(competitors[0]).join(', ') : 'No data'}
                        </div>
                    </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800">
                    <span className="text-slate-500 block mb-2">First 5 Discovery Reasons:</span>
                    <ul className="space-y-1">
                        {competitors.slice(0, 5).map((c, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="text-slate-600">#{i + 1}</span>
                                <span className="text-yellow-500">
                                    {c.discoveryReason ? `"${c.discoveryReason}"` : <span className="text-red-500">UNDEFINED/NULL</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800">
                    <span className="text-slate-500 block mb-2">Debug Console:</span>
                    <p className="text-slate-400">Check your browser console for full 'Competitors Data' log.</p>
                    {/* Console Log Side Effect */}
                    {console.log('--- DEBUG: Competitors Data ---', competitors)}
                </div>
            </div>

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
