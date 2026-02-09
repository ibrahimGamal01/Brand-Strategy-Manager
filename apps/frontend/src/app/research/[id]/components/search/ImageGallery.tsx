'use client';

import { useState } from 'react';
import { ExternalLink, Image as ImageIcon, Download, ChevronDown, Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ImageResult {
    id: string;
    title: string;
    imageUrl: string;
    thumbnailUrl?: string | null;
    sourceUrl: string;
    width?: number | null;
    height?: number | null;
    isDownloaded?: boolean;
}

interface ImageGalleryProps {
    images: ImageResult[];
    emptyMessage?: string;
}

export function ImageGallery({ images, emptyMessage = "No images found" }: ImageGalleryProps) {
    const [displayCount, setDisplayCount] = useState(20);
    const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

    const handleImageError = (imageId: string) => {
        setImageErrors(prev => new Set([...prev, imageId]));
    };

    const displayedImages = images.slice(0, displayCount);
    const hasMore = images.length > displayCount;

    const getSourceDomain = (url: string) => {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return 'Unknown';
        }
    };

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/30 text-muted-foreground">
                <ImageIcon className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between bg-secondary/20 p-3 rounded-lg border border-border/50">
                <div className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-purple-500" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Image Results
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 ml-1">
                        {images.length}
                    </Badge>
                </div>
            </div>

            {/* Images Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {displayedImages.map((image) => {
                    const hasError = imageErrors.has(image.id);
                    const sourceDomain = getSourceDomain(image.sourceUrl);

                    return (
                        <Card
                            key={image.id}
                            className="group relative overflow-hidden border-0 bg-secondary/20 shadow-none hover:shadow-xl hover:shadow-black/5 transition-all duration-300 hover:-translate-y-1 rounded-xl"
                        >
                            {/* Image Container */}
                            <div className="relative aspect-square bg-black/40 overflow-hidden">
                                {!hasError ? (
                                    <img
                                        src={image.thumbnailUrl || image.imageUrl}
                                        alt={image.title}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        onError={() => handleImageError(image.id)}
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/50 bg-secondary/50 p-4">
                                        <ImageIcon className="h-8 w-8 mb-2 opacity-50" />
                                        <span className="text-[10px] uppercase tracking-wider font-medium text-center">Failed to Load</span>
                                    </div>
                                )}

                                {/* Download Badge */}
                                {image.isDownloaded && (
                                    <div className="absolute top-2 right-2">
                                        <div className="bg-green-500/90 backdrop-blur-md rounded-full p-1.5 border border-white/10">
                                            <Download className="h-3 w-3 text-white" />
                                        </div>
                                    </div>
                                )}

                                {/* Dimensions Badge */}
                                {image.width && image.height && (
                                    <div className="absolute bottom-2 right-2">
                                        <Badge variant="secondary" className="text-[9px] px-1.5 h-4 bg-black/40 backdrop-blur-md border border-white/10 text-white font-medium">
                                            {image.width}×{image.height}
                                        </Badge>
                                    </div>
                                )}

                                {/* Overlay on Hover */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                                    <a
                                        href={image.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full bg-white/10 backdrop-blur-md hover:bg-white/20 text-white text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors border border-white/10"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                        View Source
                                    </a>
                                </div>
                            </div>

                            {/* Bottom Content */}
                            <div className="p-2.5 bg-secondary/10 backdrop-blur-sm border-t border-white/5">
                                <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed h-7 mb-1.5">
                                    {image.title || "Untitled Image"}
                                </p>
                                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                                    <Badge variant="outline" className="text-[9px] px-1.5 h-4 bg-purple-500/5 text-purple-500 border-purple-500/20">
                                        {sourceDomain}
                                    </Badge>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* Load More Button */}
            {hasMore && (
                <div className="flex justify-center pt-2">
                    <Button
                        onClick={() => setDisplayCount(prev => prev + 20)}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-2"
                    >
                        <ChevronDown className="h-3 w-3" />
                        Load More ({images.length - displayCount} remaining)
                    </Button>
                </div>
            )}
        </div>
    );
}
