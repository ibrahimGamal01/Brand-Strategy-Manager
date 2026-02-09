'use client';

import {
    TrendingUp, MessageSquare
} from 'lucide-react';
import { TreeNodeCard, DataList } from './';

interface AnalyticsNodeProps {
    trends: any[];
    insights: any[];
}

export function AnalyticsNode({ trends, insights }: AnalyticsNodeProps) {
    return (
        <TreeNodeCard
            title="Analytics"
            icon={<TrendingUp className="h-4 w-4" />}
            count={trends.length + insights.length}
            defaultExpanded={false}
            level={1}
        >
            <TreeNodeCard
                title="Search Trends"
                icon={<TrendingUp className="h-3 w-3" />}
                count={trends.length}
                level={2}
                defaultExpanded={trends.length > 0}
            >
                <DataList
                    items={trends.slice(0, 10).map((trend: any, idx: number) => ({
                        id: idx.toString(),
                        title: trend.query || trend.keyword || 'Trend',
                        subtitle: trend.volume ? `Volume: ${trend.volume}` : undefined,
                        content: Array.isArray(trend.relatedQueries)
                            ? trend.relatedQueries.join(', ')
                            : (typeof trend.relatedQueries === 'object' && trend.relatedQueries !== null
                                ? JSON.stringify(trend.relatedQueries)
                                : (trend.relatedQueries || '').toString())
                    }))}
                    emptyMessage="No trends available"
                />
            </TreeNodeCard>
            <TreeNodeCard
                title="Community Insights"
                icon={<MessageSquare className="h-3 w-3" />}
                count={insights.length}
                level={2}
                defaultExpanded={insights.length > 0}
            >
                <DataList
                    items={insights.slice(0, 10).map((insight: any, idx: number) => ({
                        id: idx.toString(),
                        title: insight.title || insight.topic || 'Insight',
                        content: insight.summary || insight.content,
                        url: insight.url || insight.source
                    }))}
                    emptyMessage="No community insights available"
                />
            </TreeNodeCard>
        </TreeNodeCard>
    );
}
