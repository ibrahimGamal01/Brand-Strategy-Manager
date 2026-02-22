'use client';

interface FollowUpChipsProps {
    suggestions: string[];
    onSelect: (suggestion: string) => void;
    isHidden?: boolean;
}

const FOLLOW_UP_ICONS = ['↗', '→', '⟶'];

export function FollowUpChips({ suggestions, onSelect, isHidden }: FollowUpChipsProps) {
    if (isHidden || suggestions.length === 0) return null;

    return (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border/30 pt-3">
            <span className="mr-1 self-center text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
                Next
            </span>
            {suggestions.slice(0, 3).map((s, i) => (
                <button
                    key={s}
                    onClick={() => onSelect(s)}
                    className="group flex items-center gap-1.5 rounded-full border border-border/50 bg-background/80 px-3 py-1.5 text-xs text-foreground/80 transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                >
                    <span className="text-[10px] text-muted-foreground/50 transition-colors group-hover:text-primary/60">
                        {FOLLOW_UP_ICONS[i % FOLLOW_UP_ICONS.length]}
                    </span>
                    {s}
                </button>
            ))}
        </div>
    );
}
