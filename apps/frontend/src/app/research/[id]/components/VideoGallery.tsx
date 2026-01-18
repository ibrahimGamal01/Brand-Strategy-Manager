'use client';

import { useState } from 'react';
import { Play, ChevronLeft, ChevronRight, ExternalLink, Clock } from 'lucide-react';

interface VideoItem {
    id: string;
    title: string;
    url: string;
    embedUrl?: string;
    thumbnailUrl?: string;
    duration?: string;
    publisher?: string;
    viewCount?: number;
}

interface VideoGalleryProps {
    videos: VideoItem[];
    itemsPerPage?: number;
}

export function VideoGallery({ videos, itemsPerPage = 12 }: VideoGalleryProps) {
    const [page, setPage] = useState(0);

    const totalPages = Math.ceil(videos.length / itemsPerPage);
    const currentVideos = videos.slice(page * itemsPerPage, (page + 1) * itemsPerPage);

    return (
        <div>
            {/* Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {currentVideos.map((vid, i) => (
                    <a
                        key={vid.id || i}
                        href={vid.url || vid.embedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative aspect-video rounded-lg overflow-hidden bg-muted group"
                    >
                        {vid.thumbnailUrl ? (
                            <img
                                src={vid.thumbnailUrl}
                                alt={vid.title}
                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                loading="lazy"
                            />
                        ) : (
                            <div className="w-full h-full bg-muted flex items-center justify-center">
                                <Play className="h-8 w-8 text-muted-foreground" />
                            </div>
                        )}

                        {/* Play button overlay */}
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/20 transition-colors">
                            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
                                <Play className="h-5 w-5 text-black ml-1" fill="black" />
                            </div>
                        </div>

                        {/* Duration badge */}
                        {vid.duration && (
                            <span className="absolute bottom-2 right-2 text-xs bg-black/80 text-white px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {vid.duration}
                            </span>
                        )}

                        {/* Title overlay */}
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                            <p className="text-xs text-white line-clamp-2 font-medium">{vid.title}</p>
                            {vid.publisher && (
                                <p className="text-xs text-white/70 mt-0.5">{vid.publisher}</p>
                            )}
                        </div>
                    </a>
                ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-4">
                    <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                    <span className="text-sm text-muted-foreground">
                        Page {page + 1} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page === totalPages - 1}
                        className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronRight className="h-5 w-5" />
                    </button>
                </div>
            )}

            {videos.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No videos found</p>
            )}
        </div>
    );
}
