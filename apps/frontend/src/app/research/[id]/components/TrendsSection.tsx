'use client';

import { TrendingUp, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { JsonViewer } from '@/components/ui/json-viewer';

interface Trend {
    id: string;
    query: string;
    date: string; // or timestamp
    value: number;
}

interface SearchTrend {
    keyword: string;
    volume?: number;
    growth?: number;
    dataPoints?: Trend[];
}

interface TrendsSectionProps {
    trends: SearchTrend[];
    iframeEmbeds?: string[]; // Optional if we use Google Trends embeds
}

export function TrendsSection({ trends }: TrendsSectionProps) {
    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {trends.map((trend, i) => (
                    <Card key={i} className="overflow-hidden">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="h-5 w-5 text-blue-500" />
                                    <span className="font-semibold">{trend.keyword}</span>
                                </div>
                                <a
                                    href={`https://trends.google.com/trends/explore?q=${encodeURIComponent(trend.keyword)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-primary transition-colors"
                                >
                                    <ExternalLink className="h-4 w-4" />
                                </a>
                            </div>

                            {trend.dataPoints && trend.dataPoints.length > 0 ? (
                                <div className="h-24 w-full flex items-end gap-1 bg-muted/20 rounded p-2">
                                    {trend.dataPoints.map((point, j) => {
                                        // Simple bar chart visualization
                                        const maxVal = Math.max(...(trend.dataPoints?.map(p => p.value) || [100]));
                                        const height = (point.value / maxVal) * 100;
                                        return (
                                            <div
                                                key={j}
                                                className="flex-1 bg-blue-500/80 rounded-t hover:bg-blue-500 transition-colors relative group"
                                                style={{ height: `${height}%` }}
                                            >
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap z-10">
                                                    {point.value} ({new Date(point.date).toLocaleDateString()})
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="h-24 flex items-center justify-center text-sm text-muted-foreground bg-muted/10 rounded">
                                    No historical data
                                </div>
                            )}

                            <div className="flex items-center justify-between mt-4 text-sm">
                                <div className="text-muted-foreground">Interest over time</div>
                                {trend.growth !== undefined && (
                                    <span className={trend.growth >= 0 ? "text-green-500" : "text-red-500"}>
                                        {trend.growth > 0 ? '+' : ''}{trend.growth}%
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {trends.length === 0 && (
                <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No trends data collected yet.</p>
                </div>
            )}

            <div className="pt-4 border-t border-border/50">
                <JsonViewer
                    data={trends}
                    title="Raw Trends Data (JSON)"
                    defaultExpanded={false}
                />
            </div>
        </div>
    );
}
