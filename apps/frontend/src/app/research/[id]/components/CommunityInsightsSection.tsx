import { MessageSquare, ThumbsUp, MessageCircle, ExternalLink, Quote, Search, FileText, Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { JsonViewToggle } from './JsonViewToggle';

interface Insight {
    id: string;
    source: string; // 'reddit', 'forum', etc.
    content: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    painPoints: string[];
    url?: string;
    likes?: number;
    comments?: number;
}

interface CommunityInsightsSectionProps {
    insights: Insight[];
}

// Helper to parse the raw text content
function parseContent(content: string) {
    const lines = content.split('\n');
    const getVal = (prefix: string) => lines.find(l => l.startsWith(prefix))?.replace(prefix, '').trim() || '';

    return {
        source: getVal('Source:'),
        title: getVal('Title:'),
        snippet: getVal('Snippet:'),
        query: getVal('Query Used:')
    };
}

export function CommunityInsightsSection({ insights }: CommunityInsightsSectionProps) {
    return (
        <JsonViewToggle data={insights}>
            <div className="grid gap-4 md:grid-cols-1">
                {insights.map((insight, i) => {
                    const parsed = parseContent(insight.content);
                    // Fallback if parsing fails (e.g. old data or different format)
                    const hasParsedData = parsed.title || parsed.snippet;

                    return (
                        <Card key={insight.id || i} className="group hover:border-primary/50 transition-colors bg-card/50">
                            <CardContent className="p-5 space-y-4">
                                {/* Header: Sentiment & Source */}
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge
                                            variant={
                                                insight.sentiment === 'positive' ? 'default' :
                                                    insight.sentiment === 'negative' ? 'destructive' : 'secondary'
                                            }
                                            className="capitalize px-2 py-0.5"
                                        >
                                            {insight.sentiment}
                                        </Badge>
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider font-medium bg-muted px-2 py-1 rounded">
                                            <Globe className="h-3 w-3" />
                                            {insight.source}
                                        </div>
                                    </div>
                                    {insight.url && (
                                        <a
                                            href={insight.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-muted-foreground hover:text-primary transition-colors p-1 hover:bg-muted rounded"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    )}
                                </div>

                                {hasParsedData ? (
                                    <div className="space-y-3">
                                        {/* Title */}
                                        {parsed.title && (
                                            <h4 className="font-semibold text-base leading-tight text-foreground flex gap-2">
                                                <span className="text-primary mt-1"><Quote className="h-3 w-3 rotate-180" /></span>
                                                {parsed.title}
                                            </h4>
                                        )}

                                        {/* Snippet */}
                                        {parsed.snippet && (
                                            <div className="flex gap-2 text-sm text-muted-foreground bg-muted/30 p-3 rounded-md border border-border/50">
                                                <FileText className="h-4 w-4 text-muted-foreground/70 shrink-0 mt-0.5" />
                                                <p className="leading-relaxed">{parsed.snippet}</p>
                                            </div>
                                        )}

                                        {/* Query Used */}
                                        {parsed.query && (
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground/60 pl-1">
                                                <Search className="h-3 w-3" />
                                                <span className="font-mono">Query:</span>
                                                <code className="bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono text-[10px]">
                                                    {parsed.query}
                                                </code>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm leading-relaxed text-muted-foreground">
                                        {insight.content}
                                    </p>
                                )}

                                {/* Validation Stats */}
                                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-3 border-t border-border/40">
                                    <div className="flex items-center gap-1.5" title="Likes/Upvotes">
                                        <ThumbsUp className="h-3 w-3" />
                                        <span>{insight.likes || 0}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5" title="Comments">
                                        <MessageCircle className="h-3 w-3" />
                                        <span>{insight.comments || 0}</span>
                                    </div>

                                    {insight.painPoints?.length > 0 && (
                                        <div className="flex flex-wrap gap-2 ml-auto">
                                            {insight.painPoints.map((p, j) => (
                                                <span key={j} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-500">
                                                    {p}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}

                {insights.length === 0 && (
                    <div className="text-center py-12 border-2 border-dashed border-border/50 rounded-xl bg-muted/20">
                        <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">No community insights discovered yet.</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Run the scraper to find discussions.</p>
                    </div>
                )}
            </div>
        </JsonViewToggle>
    );
}
