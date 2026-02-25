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
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--chat-shell-text-muted)' }}>
                Suggested
            </span>
            {suggestions.slice(0, 3).map((s, i) => (
                <button
                    key={s}
                    onClick={() => onSelect(s)}
                    className="group flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all hover:-translate-y-0.5"
                    style={{
                        borderColor: 'var(--chat-shell-border)',
                        background: 'var(--chat-shell-muted)',
                        color: 'var(--chat-shell-text)',
                    }}
                >
                    <span className="text-[10px] opacity-50 transition-colors group-hover:opacity-100" style={{ color: 'var(--chat-shell-accent)' }}>
                        {FOLLOW_UP_ICONS[i % FOLLOW_UP_ICONS.length]}
                    </span>
                    {s}
                </button>
            ))}
        </div>
    );
}
