'use client';

import { MessageSquare, ThumbsUp, MessageCircle, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

export function CommunityInsightsSection({ insights }: CommunityInsightsSectionProps) {
    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
                {insights.map((insight, i) => (
                    <Card key={insight.id || i} className="group hover:border-primary/50 transition-colors">
                        <CardContent className="p-5">
                            <div className="flex items-start justify-between gap-4 mb-3">
                                <div className="flex items-center gap-2">
                                    <Badge
                                        variant={
                                            insight.sentiment === 'positive' ? 'default' :
                                                insight.sentiment === 'negative' ? 'destructive' : 'secondary'
                                        }
                                        className="capitalize"
                                    >
                                        {insight.sentiment}
                                    </Badge>
                                    <span className="text-xs font-mono text-muted-foreground uppercase">{insight.source}</span>
                                </div>
                                {insight.url && (
                                    <a
                                        href={insight.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                    </a>
                                )}
                            </div>

                            <p className="text-sm leading-relaxed mb-4 line-clamp-4 group-hover:line-clamp-none transition-all">
                                {insight.content}
                            </p>

                            <div className="space-y-3">
                                {insight.painPoints?.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {insight.painPoints.map((p, j) => (
                                            <Badge
                                                key={j}
                                                variant="outline"
                                                className="text-[10px] text-orange-500 border-orange-500/30 bg-orange-500/5"
                                            >
                                                {p}
                                            </Badge>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border/50">
                                    <div className="flex items-center gap-1">
                                        <ThumbsUp className="h-3 w-3" />
                                        {insight.likes || 0}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <MessageCircle className="h-3 w-3" />
                                        {insight.comments || 0}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {insights.length === 0 && (
                <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No community insights discovered yet.</p>
                </div>
            )}
        </div>
    );
}
