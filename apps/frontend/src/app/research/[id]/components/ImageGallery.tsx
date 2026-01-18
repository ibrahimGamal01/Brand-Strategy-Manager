'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react';

interface ImageItem {
    id: string;
    title: string;
    imageUrl: string;
    thumbnailUrl?: string;
    sourceUrl?: string;
    isDownloaded?: boolean;
    width?: number;
    height?: number;
}

interface ImageGalleryProps {
    images: ImageItem[];
    itemsPerPage?: number;
}

export function ImageGallery({ images, itemsPerPage = 24 }: ImageGalleryProps) {
    const [page, setPage] = useState(0);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const totalPages = Math.ceil(images.length / itemsPerPage);
    const currentImages = images.slice(page * itemsPerPage, (page + 1) * itemsPerPage);

    const openLightbox = (index: number) => setLightboxIndex(page * itemsPerPage + index);
    const closeLightbox = () => setLightboxIndex(null);

    const prevImage = () => {
        if (lightboxIndex !== null && lightboxIndex > 0) {
            setLightboxIndex(lightboxIndex - 1);
        }
    };

    const nextImage = () => {
        if (lightboxIndex !== null && lightboxIndex < images.length - 1) {
            setLightboxIndex(lightboxIndex + 1);
        }
    };

    return (
        <div>
            {/* Grid */}
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {currentImages.map((img, i) => (
                    <div
                        key={img.id || i}
                        onClick={() => openLightbox(i)}
                        className="relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer group"
                    >
                        <img
                            src={img.thumbnailUrl || img.imageUrl}
                            alt={img.title}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                            <span className="text-xs text-white line-clamp-2">{img.title}</span>
                        </div>
                        {img.isDownloaded && (
                            <Download className="absolute top-2 right-2 h-4 w-4 text-green-500" />
                        )}
                    </div>
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

            {/* Lightbox */}
            {lightboxIndex !== null && images[lightboxIndex] && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
                    onClick={closeLightbox}
                >
                    <button
                        onClick={closeLightbox}
                        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                    >
                        <X className="h-6 w-6 text-white" />
                    </button>

                    <button
                        onClick={(e) => { e.stopPropagation(); prevImage(); }}
                        disabled={lightboxIndex === 0}
                        className="absolute left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
                    >
                        <ChevronLeft className="h-8 w-8 text-white" />
                    </button>

                    <div className="max-w-4xl max-h-[80vh] p-4" onClick={e => e.stopPropagation()}>
                        <img
                            src={images[lightboxIndex].imageUrl}
                            alt={images[lightboxIndex].title}
                            className="max-w-full max-h-[70vh] object-contain mx-auto rounded-lg"
                        />
                        <div className="mt-4 text-center">
                            <p className="text-white text-sm">{images[lightboxIndex].title}</p>
                            {images[lightboxIndex].sourceUrl && (
                                <a
                                    href={images[lightboxIndex].sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary text-xs mt-2 hover:underline"
                                >
                                    Open source <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={(e) => { e.stopPropagation(); nextImage(); }}
                        disabled={lightboxIndex === images.length - 1}
                        className="absolute right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
                    >
                        <ChevronRight className="h-8 w-8 text-white" />
                    </button>

                    <div className="absolute bottom-4 text-white/60 text-sm">
                        {lightboxIndex + 1} / {images.length}
                    </div>
                </div>
            )}
        </div>
    );
}
