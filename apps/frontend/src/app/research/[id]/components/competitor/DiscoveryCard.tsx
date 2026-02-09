'use client';

import { useState } from 'react';
import { Bot, Code, Video, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsSection } from './SettingsSection';
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

interface DiscoveryCardProps {
    type: 'ai' | 'algorithmic' | 'tiktok';
    competitors: Competitor[];
    settings?: {
        platforms?: string[];
        count?: number;
        criteria?: string;
        query?: string;
        maxResults?: number;
    };
    onRerun?: () => void;
    onUpdateSettings?: (key: string, value: string | number | string[]) => void;
    onEditCompetitor?: (id: string, updates: Partial<Competitor>) => void;
    onDeleteCompetitor?: (id: string) => void;
    onScrapeCompetitor?: (id: string) => void;
    isRunning?: boolean;
    className?: string;
}

/**
 * DiscoveryCard - Card for AI, Algorithmic, or TikTok discovery
 * Features:
 * - Editable settings
 * - Expandable results list
 * - Re-run discovery action
 * - Individual competitor management
 */
export function DiscoveryCard({
    type,
    competitors,
    settings = {},
    onRerun,
    onUpdateSettings,
    onEditCompetitor,
    onDeleteCompetitor,
    onScrapeCompetitor,
    isRunning = false,
    className = ''
}: DiscoveryCardProps) {
    const [showResults, setShowResults] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const icon = type === 'ai' ? <Bot className="h-4 w-4" /> :
        type === 'tiktok' ? <Video className="h-4 w-4" /> :
            <Code className="h-4 w-4" />;
    const title = type === 'ai' ? 'AI Discovery' :
        type === 'tiktok' ? 'TikTok Discovery' :
            'Algorithmic Search';
    const colorClass = type === 'ai' ? 'text-purple-400' :
        type === 'tiktok' ? 'text-pink-400' :
            'text-orange-400';

    // Build settings config based on type
    const settingsConfig = type === 'ai'
        ? {
            platforms: {
                label: 'Platforms',
                value: settings.platforms || ['Instagram', 'TikTok'],
                type: 'array' as const,
                placeholder: 'Instagram, TikTok'
            },
            count: {
                label: 'Count',
                value: settings.count || 10,
                type: 'number' as const
            },
            criteria: {
                label: 'Criteria',
                value: settings.criteria || 'Similar audience',
                type: 'text' as const
            }
        }
        : type === 'tiktok'
            ? {
                count: {
                    label: 'Count',
                    value: settings.count || 10,
                    type: 'number' as const
                },
                criteria: {
                    label: 'Criteria',
                    value: settings.criteria || 'Similar niche',
                    type: 'text' as const
                }
            }
            : {
                query: {
                    label: 'Query',
                    value: settings.query || '',
                    type: 'text' as const,
                    placeholder: 'Search query'
                },
                maxResults: {
                    label: 'Max Results',
                    value: settings.maxResults || 20,
                    type: 'number' as const
                }
            };

    return (
        <div className={`space-y-3 ${className}`}>
            {/* Settings Section */}
            <div>
                <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                    {showSettings ? (
                        <ChevronDown className="h-3 w-3" />
                    ) : (
                        <ChevronRight className="h-3 w-3" />
                    )}
                    <span className="font-medium">Settings</span>
                </button>

                {showSettings && (
                    <div className="mt-2">
                        <SettingsSection
                            config={settingsConfig as any}
                            onSave={onUpdateSettings}
                        />
                    </div>
                )}
            </div>

            {/* Results Section */}
            <div>
                <button
                    onClick={() => setShowResults(!showResults)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                    {showResults ? (
                        <ChevronDown className="h-3 w-3" />
                    ) : (
                        <ChevronRight className="h-3 w-3" />
                    )}
                    <span className="font-medium">Results ({competitors.length})</span>
                </button>

                {showResults && (
                    <div className="mt-2 space-y-2">
                        {competitors.length > 0 ? (
                            competitors.map((competitor) => (
                                <CompetitorRow
                                    key={competitor.id}
                                    competitor={competitor}
                                    onEdit={onEditCompetitor}
                                    onDelete={onDeleteCompetitor}
                                    onScrape={onScrapeCompetitor}
                                />
                            ))
                        ) : (
                            <div className="p-4 border border-dashed border-border rounded-lg text-center text-xs text-muted-foreground bg-muted/10">
                                No competitors found yet. Click "Re-run Discovery" to fetch.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Actions Section */}
            {onRerun && (
                <div className="flex justify-end pt-2 border-t border-border/30">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRerun}
                        disabled={isRunning}
                        className="text-xs gap-2"
                    >
                        {icon}
                        {isRunning ? 'Running...' : 'Re-run Discovery'}
                    </Button>
                </div>
            )}
        </div>
    );
}
