'use client';

import { ThumbsUp, ThumbsDown, Minus, MessageSquare, AlertCircle, Quote } from 'lucide-react';
import { motion } from 'framer-motion';

interface Insight {
    source: string;
    content: string;
    sentiment: string;
    painPoints: string[];
    desires: string[];
    marketingHooks: string[];
}

export function VoCViewer({ insights }: { insights: Insight[] }) {
    if (!insights || insights.length === 0) return null;

    const getSentimentIcon = (sentiment: string) => {
        switch (sentiment.toLowerCase()) {
            case 'positive': return <ThumbsUp size={14} className="text-emerald-400" />;
            case 'negative': return <ThumbsDown size={14} className="text-rose-400" />;
            default: return <Minus size={14} className="text-zinc-500" />;
        }
    };

    const getSentimentColor = (sentiment: string) => {
        switch (sentiment.toLowerCase()) {
            case 'positive': return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
            case 'negative': return 'bg-rose-500/10 border-rose-500/20 text-rose-300';
            default: return 'bg-zinc-800 text-zinc-400 border-zinc-700';
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between px-1">
                <h3 className="text-xl font-bold text-white flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20">
                        <MessageSquare size={20} className="text-purple-400" />
                    </div>
                    Community Voices
                </h3>
                <span className="text-xs font-semibold bg-zinc-900 border border-zinc-800 text-zinc-400 px-3 py-1.5 rounded-full">
                    {insights.length} Discussions Analyzed
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {insights.map((insight, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="group flex flex-col bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-lg hover:-translate-y-1"
                    >
                        {/* Header */}
                        <div className="flex items-start justify-between mb-4">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-950 px-2 py-1 rounded border border-zinc-800/50">
                                {insight.source}
                            </span>
                            <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase border ${getSentimentColor(insight.sentiment)}`}>
                                {getSentimentIcon(insight.sentiment)}
                                <span>{insight.sentiment}</span>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="relative mb-6 flex-grow">
                            <Quote className="absolute -top-1 -left-1 text-zinc-800 fill-zinc-800/50 scale-150 rotate-180" size={24} />
                            <p className="relative text-sm text-zinc-300 leading-relaxed italic z-10 pl-2">
                                "{insight.content.length > 250 ? insight.content.substring(0, 250) + '...' : insight.content}"
                            </p>
                        </div>

                        {/* Tags section */}
                        <div className="space-y-3 pt-4 border-t border-zinc-800/50">
                            {/* Pain Points */}
                            {insight.painPoints.length > 0 && (
                                <div>
                                    <h4 className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-rose-300 mb-2 opacity-80">
                                        <AlertCircle size={10} /> Pain Points
                                    </h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        {insight.painPoints.slice(0, 3).map((pt, idx) => (
                                            <span key={idx} className="text-[10px] bg-rose-950/20 text-rose-200/80 px-2 py-1 rounded border border-rose-900/30">
                                                {pt}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Hooks */}
                            {insight.marketingHooks.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] uppercase font-bold text-blue-300 mb-2 opacity-80">
                                        Hooks
                                    </h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        {insight.marketingHooks.slice(0, 3).map((hook, idx) => (
                                            <span key={idx} className="text-[10px] bg-blue-950/20 text-blue-200/80 px-2 py-1 rounded border border-blue-900/30">
                                                {hook}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
