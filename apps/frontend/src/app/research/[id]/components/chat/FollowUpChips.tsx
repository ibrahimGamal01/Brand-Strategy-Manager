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
        <div className="mt-4 flex flex-wrap items-center gap-2 pt-1">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-600/60 dark:text-emerald-400/60">
                Suggested
            </span>
            {suggestions.slice(0, 3).map((s, i) => (
                <button
                    key={s}
                    onClick={() => onSelect(s)}
                    className="group flex items-center gap-1.5 rounded-full border border-border/40 bg-card/40 px-3.5 py-1.5 text-xs font-medium text-foreground/90 shadow-sm backdrop-blur-sm transition-all hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400"
                >
                    <span className="text-[10px] opacity-50 transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:opacity-100">
                        {FOLLOW_UP_ICONS[i % FOLLOW_UP_ICONS.length]}
                    </span>
                    {s}
                </button>
            ))}
        </div>
    );
}
