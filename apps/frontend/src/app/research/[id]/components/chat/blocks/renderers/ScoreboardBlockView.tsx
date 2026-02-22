'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export type ScoreboardBlock = {
    type: 'scoreboard';
    blockId: string;
    title?: string;
    rows: Array<{
        label: string;
        score: number;
        maxScore?: number;
        note?: string;
        rank?: number;
    }>;
};

interface ScoreboardBlockViewProps {
    block: ScoreboardBlock;
}

export function ScoreboardBlockView({ block }: ScoreboardBlockViewProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 100);
        return () => clearTimeout(t);
    }, []);

    const sorted = [...block.rows].sort((a, b) => b.score - a.score);

    const RANK_COLORS = [
        'from-amber-400 to-amber-500',   // 1st
        'from-slate-400 to-slate-500',   // 2nd
        'from-orange-400 to-orange-500', // 3rd
    ];

    const BAR_COLORS = [
        'bg-primary',
        'bg-sky-500',
        'bg-emerald-500',
        'bg-violet-500',
        'bg-rose-500',
    ];

    return (
        <div className="space-y-3">
            {sorted.map((row, index) => {
                const max = row.maxScore || 100;
                const pct = Math.min(100, Math.round((row.score / max) * 100));
                const rankColor = RANK_COLORS[index] || 'from-border to-border';
                const barColor = BAR_COLORS[index % BAR_COLORS.length];

                return (
                    <div key={row.label} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${rankColor} text-[11px] font-bold text-white`}>
                                    {index + 1}
                                </div>
                                <span className="text-sm font-medium">{row.label}</span>
                                {row.note && (
                                    <span className="text-[10px] text-muted-foreground">{row.note}</span>
                                )}
                            </div>
                            <span className="text-sm font-semibold tabular-nums">{row.score}{row.maxScore ? `/${row.maxScore}` : ''}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-border/40">
                            <motion.div
                                className={`h-full rounded-full ${barColor}`}
                                initial={{ width: 0 }}
                                animate={{ width: mounted ? `${pct}%` : 0 }}
                                transition={{ duration: 0.7, delay: index * 0.1, ease: 'easeOut' }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
