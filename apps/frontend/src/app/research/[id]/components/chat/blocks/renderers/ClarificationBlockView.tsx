'use client';

import { useState } from 'react';

interface ClarificationBlockData {
    type: 'clarification';
    blockId: string;
    question: string;
    options: string[];
    allowFreeText?: boolean;
}

interface ClarificationBlockViewProps {
    block: ClarificationBlockData;
    onAnswer: (answer: string) => void;
}

export function ClarificationBlockView({ block, onAnswer }: ClarificationBlockViewProps) {
    const [answered, setAnswered] = useState<string | null>(null);
    const [freeText, setFreeText] = useState('');

    function handleOption(option: string) {
        setAnswered(option);
        onAnswer(option);
    }

    function handleFreeTextSubmit() {
        const text = freeText.trim();
        if (!text) return;
        setAnswered(text);
        onAnswer(text);
    }

    return (
        <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
            {/* Question */}
            <p className="mb-3 text-[13px] font-medium text-foreground">
                <span className="mr-2 text-base">❓</span>
                {block.question}
            </p>

            {answered ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        ✓ {answered}
                    </span>
                    <span>Selected</span>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* Option chips */}
                    <div className="flex flex-wrap gap-2">
                        {block.options.map((option) => (
                            <button
                                key={option}
                                onClick={() => handleOption(option)}
                                className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:border-primary/60 hover:bg-primary/10"
                            >
                                {option}
                            </button>
                        ))}
                    </div>

                    {/* Free text fallback */}
                    {block.allowFreeText && (
                        <div className="mt-2 flex gap-2">
                            <input
                                type="text"
                                placeholder="Or type your answer..."
                                value={freeText}
                                onChange={(e) => setFreeText(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleFreeTextSubmit()}
                                className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none"
                            />
                            <button
                                onClick={handleFreeTextSubmit}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                            >
                                Send
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
