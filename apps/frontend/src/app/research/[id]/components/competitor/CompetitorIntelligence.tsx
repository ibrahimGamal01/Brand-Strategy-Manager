'use client';

import { useState } from 'react';
import { TreeView } from './TreeView';
import { TreeNode } from './TreeNode';
import { DiscoveryCard } from './DiscoveryCard';
import { ScrapingPipelineCard } from './ScrapingPipelineCard';

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

interface CompetitorIntelligenceProps {
    jobId: string;
    competitors: Competitor[];
    onRunDiscovery?: (type: 'ai' | 'algorithmic') => void;
    onDiscoverTikTok?: () => void;
    isDiscoveringTikTok?: boolean;
    onUpdateSettings?: (type: 'ai' | 'algorithmic', key: string, value: string | number | string[]) => void;
    onEditCompetitor?: (id: string, updates: Partial<Competitor>) => void;
    onDeleteCompetitor?: (id: string) => void;
    onScrapeCompetitor?: (id: string) => void;
    onScrapeAll?: () => void;
    className?: string;
}

/**
 * CompetitorIntelligence - Main container for modular competitor UI
 * Features:
 * - Tree-based navigation
 * - Expandable discovery cards (AI, Algorithmic)
 * - Scraping pipeline management
 * - Full CRUD operations per competitor
 */
export function CompetitorIntelligence({
    jobId,
    competitors,
    onRunDiscovery,
    onDiscoverTikTok,
    isDiscoveringTikTok = false,
    onUpdateSettings,
    onEditCompetitor,
    onDeleteCompetitor,
    onScrapeCompetitor,
    onScrapeAll,
    className = ''
}: CompetitorIntelligenceProps) {
    const [runningDiscovery, setRunningDiscovery] = useState<Record<string, boolean>>({});

    // Categorize competitors by discovery reason
    const aiCompetitors = competitors.filter(c =>
        (c.discoveryReason || '').toLowerCase().includes('ai')
    );
    const algorithmicCompetitors = competitors.filter(c =>
        (c.discoveryReason || '').toLowerCase().includes('algorithmic') ||
        (c.discoveryReason || '').toLowerCase().includes('search')
    );
    const tiktokCompetitors = competitors.filter(c => c.platform === 'tiktok');

    // Get statuses for tree nodes
    const getDiscoveryStatus = (comps: Competitor[]) => {
        if (comps.some(c => c.status === 'SCRAPING')) return 'IN_PROGRESS' as const;
        if (comps.every(c => c.status === 'SCRAPED')) return 'SCRAPED' as const;
        if (comps.some(c => c.status === 'SCRAPED')) return 'IN_PROGRESS' as const;
        if (comps.some(c => c.status === 'FAILED')) return 'FAILED' as const;
        return 'SUGGESTED' as const;
    };

    const getPipelineStatus = () => {
        const scraping = competitors.filter(c => c.status === 'SCRAPING').length;
        const scraped = competitors.filter(c => c.status === 'SCRAPED').length;
        const pending = competitors.filter(c => c.status === 'SUGGESTED').length;

        if (scraping > 0) return 'IN_PROGRESS' as const;
        if (scraped > 0 && pending === 0) return 'SCRAPED' as const;
        if (scraped > 0) return 'IN_PROGRESS' as const;
        return 'SUGGESTED' as const;
    };

    const handleRunDiscovery = (type: 'ai' | 'algorithmic') => {
        setRunningDiscovery(prev => ({ ...prev, [type]: true }));
        onRunDiscovery?.(type);
        // Reset after 5 seconds (should be managed by actual API response)
        setTimeout(() => {
            setRunningDiscovery(prev => ({ ...prev, [type]: false }));
        }, 5000);
    };

    const scrapingCount = competitors.filter(c => c.status === 'SCRAPING').length;
    const scrapedCount = competitors.filter(c => c.status === 'SCRAPED').length;
    const pendingCount = competitors.filter(c => c.status === 'SUGGESTED').length;

    return (
        <div className={className}>
            <TreeView>
                {/* Root: Competitor Intelligence */}
                <TreeNode
                    level={0}
                    title="Competitor Intelligence"
                    count={competitors.length}
                    defaultExpanded={true}
                >
                    {/* AI Discovery */}
                    <TreeNode
                        level={1}
                        title="AI Discovery"
                        status={getDiscoveryStatus(aiCompetitors)}
                        count={aiCompetitors.length}
                        onRun={() => handleRunDiscovery('ai')}
                        isRunning={runningDiscovery.ai}
                        defaultExpanded={aiCompetitors.length > 0}
                    >
                        <DiscoveryCard
                            type="ai"
                            competitors={aiCompetitors}
                            settings={{
                                platforms: ['Instagram', 'TikTok'],
                                count: 10,
                                criteria: 'Similar audience'
                            }}
                            onRerun={() => handleRunDiscovery('ai')}
                            onUpdateSettings={(key, value) => onUpdateSettings?.('ai', key, value)}
                            onEditCompetitor={onEditCompetitor}
                            onDeleteCompetitor={onDeleteCompetitor}
                            onScrapeCompetitor={onScrapeCompetitor}
                            isRunning={runningDiscovery.ai}
                        />
                    </TreeNode>

                    {/* Algorithmic Search */}
                    <TreeNode
                        level={1}
                        title="Algorithmic Search"
                        status={getDiscoveryStatus(algorithmicCompetitors)}
                        count={algorithmicCompetitors.length}
                        onRun={() => handleRunDiscovery('algorithmic')}
                        isRunning={runningDiscovery.algorithmic}
                        defaultExpanded={algorithmicCompetitors.length > 0}
                    >
                        <DiscoveryCard
                            type="algorithmic"
                            competitors={algorithmicCompetitors}
                            settings={{
                                query: 'entrepreneur muslim',
                                maxResults: 20
                            }}
                            onRerun={() => handleRunDiscovery('algorithmic')}
                            onUpdateSettings={(key, value) => onUpdateSettings?.('algorithmic', key, value)}
                            onEditCompetitor={onEditCompetitor}
                            onDeleteCompetitor={onDeleteCompetitor}
                            onScrapeCompetitor={onScrapeCompetitor}
                            isRunning={runningDiscovery.algorithmic}
                        />
                    </TreeNode>

                    {/* TikTok Discovery */}
                    <TreeNode
                        level={1}
                        title="TikTok Discovery"
                        status={getDiscoveryStatus(tiktokCompetitors)}
                        count={tiktokCompetitors.length}
                        onRun={onDiscoverTikTok}
                        isRunning={isDiscoveringTikTok}
                        defaultExpanded={tiktokCompetitors.length > 0}
                    >
                        <DiscoveryCard
                            type="tiktok"
                            competitors={tiktokCompetitors}
                            settings={{
                                platforms: ['TikTok'],
                                count: 10,
                                criteria: 'Similar niche'
                            }}
                            onRerun={onDiscoverTikTok}
                            onUpdateSettings={() => { }}
                            onEditCompetitor={onEditCompetitor}
                            onDeleteCompetitor={onDeleteCompetitor}
                            onScrapeCompetitor={onScrapeCompetitor}
                            isRunning={isDiscoveringTikTok}
                        />
                    </TreeNode>

                    {/* Scraping Pipeline */}
                    <TreeNode
                        level={1}
                        title="Scraping Pipeline"
                        status={getPipelineStatus()}
                        count={scrapedCount + scrapingCount + pendingCount}
                        defaultExpanded={scrapingCount > 0 || pendingCount > 0}
                    >
                        <ScrapingPipelineCard
                            competitors={competitors}
                            onScrapeAll={onScrapeAll}
                            onScrapeOne={onScrapeCompetitor}
                            onEditCompetitor={onEditCompetitor}
                            onDeleteCompetitor={onDeleteCompetitor}
                        />
                    </TreeNode>
                </TreeNode>
            </TreeView>
        </div>
    );
}
