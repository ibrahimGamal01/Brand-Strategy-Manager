'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

export type PollBlock = {
    type: 'poll';
    blockId: string;
    title?: string;
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
};

interface PollBlockViewProps {
    block: PollBlock;
    onVote?: (optionId: string) => void;
}

export function PollBlockView({ block, onVote }: PollBlockViewProps) {
    const [selected, setSelected] = useState<string | null>(null);

    function handleSelect(id: string) {
        if (selected) return;
        setSelected(id);
        onVote?.(id);
    }

    return (
        <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{block.question}</p>
            <div className="space-y-2">
                {block.options.map((option) => {
                    const isSelected = selected === option.id;
                    const isOther = selected && selected !== option.id;
                    return (
                        <motion.button
                            key={option.id}
                            onClick={() => handleSelect(option.id)}
                            whileTap={selected ? {} : { scale: 0.98 }}
                            disabled={Boolean(selected)}
                            className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all
                ${isSelected
                                    ? 'border-primary bg-primary/10 text-foreground'
                                    : isOther
                                        ? 'border-border/40 bg-background/30 text-muted-foreground opacity-50'
                                        : 'border-border/60 bg-background/50 text-foreground hover:border-primary/40 hover:bg-primary/5 cursor-pointer'
                                }`}
                        >
                            <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all
                ${isSelected ? 'border-primary bg-primary' : 'border-border'}`}>
                                {isSelected && (
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="h-2 w-2 rounded-full bg-white"
                                    />
                                )}
                            </div>
                            <div>
                                <p className="font-medium">{option.label}</p>
                                {option.description && (
                                    <p className="text-[11px] text-muted-foreground mt-0.5">{option.description}</p>
                                )}
                            </div>
                            {isSelected && (
                                <span className="ml-auto text-[10px] font-semibold uppercase tracking-widest text-primary">Selected</span>
                            )}
                        </motion.button>
                    );
                })}
            </div>
            {selected && (
                <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[11px] text-muted-foreground"
                >
                    Your choice has been recorded.
                </motion.p>
            )}
        </div>
    );
}
