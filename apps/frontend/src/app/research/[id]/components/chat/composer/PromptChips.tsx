'use client';

import { motion } from 'framer-motion';

interface PromptChip {
    label: string;
    prompt: string;
    icon?: string;
}

const DEFAULT_CHIPS: PromptChip[] = [
    { label: 'Compare competitors', prompt: 'Compare my top 3 competitors side by side', icon: '⚔️' },
    { label: 'Instagram hook', prompt: 'Suggest 3 strong hooks for Instagram', icon: '✨' },
    { label: 'Content calendar', prompt: 'Build me a 1-week content calendar based on the strategy', icon: '📅' },
    { label: 'Brand gap', prompt: "What's my brand's biggest gap right now?", icon: '🔍' },
    { label: 'SWOT analysis', prompt: 'Give me a full SWOT analysis for my brand', icon: '📊' },
    { label: 'Brand voice', prompt: 'Analyze and describe my brand voice profile', icon: '🎙️' },
    { label: 'Top post format', prompt: 'What content format performs best for my niche?', icon: '🏆' },
    { label: 'Competitor weakness', prompt: 'What are the biggest weaknesses of my top competitors?', icon: '💡' },
];

interface PromptChipsProps {
    onSelect: (prompt: string) => void;
    disabled?: boolean;
}

export function PromptChips({ onSelect, disabled }: PromptChipsProps) {
    return (
        <div className="overflow-x-auto pb-1 no-scrollbar">
            <div className="flex gap-2 w-max">
                {DEFAULT_CHIPS.map((chip, index) => (
                    <motion.button
                        key={chip.label}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: index * 0.03 }}
                        onClick={() => onSelect(chip.prompt)}
                        disabled={disabled}
                        className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 whitespace-nowrap cursor-pointer"
                    >
                        {chip.icon && <span className="text-[12px]">{chip.icon}</span>}
                        {chip.label}
                    </motion.button>
                ))}
            </div>
        </div>
    );
}
