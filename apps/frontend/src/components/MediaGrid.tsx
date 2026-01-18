'use client';

import { Play, Maximize2, X, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface MediaAsset {
    type: string;
    url: string;
    source: string;
    thumbnailPath?: string;
}

export function MediaGrid({ media }: { media: MediaAsset[] }) {
    const [selectedMedia, setSelectedMedia] = useState<MediaAsset | null>(null);

    if (!media || media.length === 0) return null;

    // Helper to get YouTube ID (can act as a fallback if not passed directly)
    const getYouTubeId = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    return (
        <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {media.slice(0, 10).map((item, index) => {
                    const isVideo = item.type === 'VIDEO' || item.type === 'DDG_VIDEO' || item.url.includes('youtube') || item.url.includes('youtu.be');
                    const youtubeId = (item.url.includes('youtube') || item.url.includes('youtu.be')) ? getYouTubeId(item.url) : null;

                    // Use provided thumbnail or fallback to item.url (for images) or YouTube thumb
                    let displayUrl = item.thumbnailPath || item.url;
                    if (youtubeId && !item.thumbnailPath) {
                        displayUrl = `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
                    }

                    return (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            onClick={() => setSelectedMedia(item)}
                            className="group relative aspect-video md:aspect-square rounded-xl overflow-hidden bg-zinc-900 border border-white/5 cursor-zoom-in shadow-sm hover:shadow-md hover:border-white/10 transition-all duration-300"
                        >
                            {/* Media Content */}
                            <img
                                src={displayUrl}
                                alt="Asset"
                                loading="lazy"
                                className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                                onError={(e) => {
                                    // Fallback for broken images
                                    (e.target as HTMLImageElement).src = 'https://placehold.co/400x400/18181b/52525b?text=Media';
                                }}
                            />

                            {/* Overlays */}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                                <Maximize2 className="text-white drop-shadow-md scale-75 group-hover:scale-100 transition-transform duration-300" size={24} />
                            </div>

                            {/* Type Badge */}
                            {isVideo && (
                                <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
                                    <Play className="fill-white text-white ml-0.5" size={12} />
                                </div>
                            )}

                            {/* Source Badge */}
                            <div className="absolute bottom-2 left-2 px-2 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
                                <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">{item.source || 'WEB'}</span>
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Lightbox Modal */}
            <AnimatePresence>
                {selectedMedia && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 md:p-8"
                        onClick={() => setSelectedMedia(null)}
                    >
                        <motion.button
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-50 border border-white/10"
                            onClick={(e) => { e.stopPropagation(); setSelectedMedia(null); }}
                        >
                            <X size={20} />
                        </motion.button>

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative max-w-6xl w-full max-h-[90vh] bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl flex flex-col"
                        >
                            {/* Main Content Area */}
                            <div className="flex-1 bg-black relative flex items-center justify-center min-h-[50vh] md:min-h-[70vh]">
                                {(() => {
                                    const isYoutube = selectedMedia.url.includes('youtube') || selectedMedia.url.includes('youtu.be');
                                    const youtubeId = isYoutube ? getYouTubeId(selectedMedia.url) : null;

                                    if (isYoutube && youtubeId) {
                                        return (
                                            <iframe
                                                width="100%"
                                                height="100%"
                                                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
                                                title="YouTube video player"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                className="absolute inset-0 w-full h-full"
                                                allowFullScreen
                                            ></iframe>
                                        );
                                    } else if (selectedMedia.type === 'VIDEO' || selectedMedia.type === 'DDG_VIDEO') {
                                        return (
                                            <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                                                {/* Fallback for raw video files if we have them, otherwise link */}
                                                <video
                                                    src={selectedMedia.url}
                                                    controls
                                                    className="max-h-[85vh] max-w-full"
                                                    autoPlay
                                                />
                                            </div>
                                        );
                                    } else {
                                        return (
                                            <img
                                                src={selectedMedia.url}
                                                className="max-h-[85vh] max-w-full object-contain"
                                                alt="Full preview"
                                            />
                                        );
                                    }
                                })()}
                            </div>

                            {/* Footer / Meta */}
                            <div className="p-4 bg-zinc-900/50 backdrop-blur border-t border-zinc-800 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-bold uppercase text-zinc-500 bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
                                        {selectedMedia.source}
                                    </span>
                                    <span className="text-sm text-zinc-300 font-medium truncate max-w-[300px]">
                                        {selectedMedia.url}
                                    </span>
                                </div>
                                <a
                                    href={selectedMedia.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 text-xs font-bold text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                                >
                                    Open Original <ExternalLink size={12} />
                                </a>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
