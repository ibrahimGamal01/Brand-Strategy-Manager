'use client';

import { useState } from 'react';

const DEFAULT_CHIPS = [
    { label: '⚔️ Compare competitors', prompt: 'Compare my top competitors and show me where I stand.' },
    { label: '📊 SWOT analysis', prompt: '/swot Run a full SWOT analysis for my brand.' },
    { label: '🎙️ Brand voice', prompt: '/voice Visualize my brand voice positioning.' },
    { label: '✨ Instagram hook', prompt: 'Write me 3 high-converting Instagram hook formulas for my niche.' },
    { label: '📅 Content calendar', prompt: '/calendar Show me content calendar actions I can take now.' },
    { label: '🔭 Brand gap', prompt: 'What is my biggest brand gap compared to competitors?' },
    { label: '🏆 Scoreboard', prompt: '/scoreboard Rank my top competitors by engagement score.' },
    { label: '🎨 Moodboard', prompt: '/moodboard Create a visual direction moodboard for my brand.' },
];

interface PromptChipsProps {
    onSelect: (prompt: string) => void;
    disabled?: boolean;
}

export function PromptChips({ onSelect, disabled }: PromptChipsProps) {
    const [expanded, setExpanded] = useState(false);

    const visible = expanded ? DEFAULT_CHIPS : DEFAULT_CHIPS.slice(0, 3);

    if (disabled) return null;

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {visible.map((chip) => (
                <button
                    key={chip.label}
                    onClick={() => onSelect(chip.prompt)}
                    disabled={disabled}
                    className="rounded-full border border-dashed border-border/60 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:opacity-40"
                >
                    {chip.label}
                </button>
            ))}
            <button
                onClick={() => setExpanded((p) => !p)}
                className="rounded-full border border-border/40 bg-background/40 px-2.5 py-1 text-[10px] text-muted-foreground transition-all hover:bg-accent"
            >
                {expanded ? '↑ Less' : `+${DEFAULT_CHIPS.length - 3} more`}
            </button>
        </div>
    );
}
