
'use client';

import { useEffect, useState } from 'react';
import { Layers, ThumbsUp, MessageCircle, Share2, Eye } from 'lucide-react';
import { DataSourceSection } from './DataSourceSection';
import { toMediaUrl } from '@/lib/media-url';
import { apiFetch } from '@/lib/api/http';

interface VisualAsset {
    id: string;
    postId: string;
    url: string;
    thumbnailUrl: string | null;
    postUrl: string | null;
    platform: string;
    handle: string;
    type: 'image' | 'video';
    likes: number;
    comments: number;
    shares: number;
    views: number;
    engagementScore: number;
}

interface VisualComparisonSectionProps {
    jobId: string;
}

export function VisualComparisonSection({ jobId }: VisualComparisonSectionProps) {
    const [assets, setAssets] = useState<VisualAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchAssets() {
            try {
                const data = await apiFetch<VisualAsset[]>(`/research-jobs/${jobId}/visual-comparison`);
                setAssets(Array.isArray(data) ? data : []);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }

        if (jobId) {
            fetchAssets();
        }
    }, [jobId]);

    // Helper to process local file paths to server URLs
    const getDisplayUrl = (url: string | null) => {
        if (!url) return '';
        if (url.startsWith('http')) {
            // Check if it's a TikTok/Instagram URL (not an actual image)
            if (url.includes('tiktok.com') || url.includes('instagram.com')) {
                return ''; // Return empty to show fallback
            }
            return url; // Valid HTTP image URL
        }
        // Handle both file:// URLs and absolute paths
        return toMediaUrl(url);
    };

    if (loading) return null; // Or a skeleton
    if (error) return null; // Hide if error for now
    if (assets.length === 0) return null; // Hide if no assets

    return (
        <DataSourceSection
            title="Visual Strategy Comparison (Top Performers)"
            icon={Layers}
            count={assets.length}
            defaultOpen={true}
            className="border-blue-200 bg-blue-50/10" // Subtle highlight
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {assets.map((asset, i) => (
                    <div key={asset.id} className="group relative bg-card border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
                        {/* Rank Badge */}
                        <div className="absolute top-2 left-2 z-10 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-full backdrop-blur-sm">
                            #{i + 1}
                        </div>

                        {/* Image/Video Thumbnail */}
                        <div className="aspect-[9/16] bg-muted relative">
                            {asset.type === 'video' ? (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                                    <div className="absolute top-2 right-2 z-10">
                                        <span className="bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">VIDEO</span>
                                    </div>
                                    {getDisplayUrl(asset.thumbnailUrl || asset.url) ? (
                                        <img
                                            src={getDisplayUrl(asset.thumbnailUrl || asset.url)}
                                            alt={`Top post by ${asset.handle}`}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                // Fallback to placeholder
                                                e.currentTarget.style.display = 'none';
                                            }}
                                        />
                                    ) : null}
                                    {/* Fallback Icon */}
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="text-white/30 text-6xl">▶</div>
                                    </div>
                                </div>
                            ) : (
                                <img
                                    src={getDisplayUrl(asset.url)}
                                    alt={`Top post by ${asset.handle}`}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                    }}
                                />
                            )}

                            {/* Overlay for Platform/Handle */}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
                                <p className="text-white text-xs font-medium truncate">@{asset.handle}</p>
                                <p className="text-white/70 text-[10px] uppercase">{asset.platform}</p>
                            </div>
                        </div>

                        {/* Metrics Grid */}
                        <div className="p-3 grid grid-cols-2 gap-2 text-xs border-t bg-white/50">
                            <div className="flex items-center gap-1.5 text-muted-foreground" title="Likes">
                                <ThumbsUp className="h-3 w-3" />
                                <span className="font-mono">{asset.likes.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground" title="Views">
                                <Eye className="h-3 w-3" />
                                <span className="font-mono">{asset.views.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground" title="Comments">
                                <MessageCircle className="h-3 w-3" />
                                <span className="font-mono">{asset.comments.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground" title="Shares">
                                <Share2 className="h-3 w-3" />
                                <span className="font-mono">{asset.shares.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-4 p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground">
                <p className="font-medium mb-1">Why these posts?</p>
                The selected visuals represent the highest engagement (likes, shares, comments) from the scraped profiles.
                Focusing on these &quot;outliers&quot; reveals the visual patterns that currently resonate with the audience.
            </div>
        </DataSourceSection>
    );
}
