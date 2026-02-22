'use client';

import { useState } from 'react';

export type SwotBlock = {
    type: 'swot';
    blockId: string;
    title?: string;
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
};

interface SwotBlockViewProps {
    block: SwotBlock;
}

type Quadrant = 'strengths' | 'weaknesses' | 'opportunities' | 'threats';

const QUADRANT_CONFIG: Record<Quadrant, { label: string; icon: string; color: string; border: string; bg: string }> = {
    strengths: {
        label: 'Strengths',
        icon: '💪',
        color: 'text-emerald-700 dark:text-emerald-400',
        border: 'border-emerald-200 dark:border-emerald-800',
        bg: 'bg-emerald-50/60 dark:bg-emerald-900/20',
    },
    weaknesses: {
        label: 'Weaknesses',
        icon: '⚠️',
        color: 'text-rose-700 dark:text-rose-400',
        border: 'border-rose-200 dark:border-rose-800',
        bg: 'bg-rose-50/60 dark:bg-rose-900/20',
    },
    opportunities: {
        label: 'Opportunities',
        icon: '🚀',
        color: 'text-sky-700 dark:text-sky-400',
        border: 'border-sky-200 dark:border-sky-800',
        bg: 'bg-sky-50/60 dark:bg-sky-900/20',
    },
    threats: {
        label: 'Threats',
        icon: '🔴',
        color: 'text-amber-700 dark:text-amber-400',
        border: 'border-amber-200 dark:border-amber-800',
        bg: 'bg-amber-50/60 dark:bg-amber-900/20',
    },
};

function SwotQuadrant({ quadrant, items }: { quadrant: Quadrant; items: string[] }) {
    const [expanded, setExpanded] = useState(true);
    const cfg = QUADRANT_CONFIG[quadrant];

    return (
        <div className={`rounded-lg border p-3 ${cfg.border} ${cfg.bg}`}>
            <button
                onClick={() => setExpanded((p) => !p)}
                className="flex w-full items-center justify-between gap-2 text-left"
            >
                <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${cfg.color}`}>
                    <span>{cfg.icon}</span>
                    {cfg.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{expanded ? '▲' : '▼'}</span>
            </button>
            {expanded && (
                <ul className="mt-2 space-y-1">
                    {items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                            <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current opacity-50" />
                            {item}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export function SwotBlockView({ block }: SwotBlockViewProps) {
    return (
        <div className="grid grid-cols-2 gap-2">
            <SwotQuadrant quadrant="strengths" items={block.strengths} />
            <SwotQuadrant quadrant="weaknesses" items={block.weaknesses} />
            <SwotQuadrant quadrant="opportunities" items={block.opportunities} />
            <SwotQuadrant quadrant="threats" items={block.threats} />
        </div>
    );
}
