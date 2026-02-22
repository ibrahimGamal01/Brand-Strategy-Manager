'use client';

export type BrandVoiceMeterBlock = {
    type: 'brand_voice_meter';
    blockId: string;
    title?: string;
    dimensions: Array<{
        leftLabel: string;
        rightLabel: string;
        value: number; // 0-100, where 0 = fully left, 100 = fully right
        note?: string;
    }>;
    summary?: string;
};

interface BrandVoiceMeterBlockViewProps {
    block: BrandVoiceMeterBlock;
}

function VoiceDimension({
    leftLabel,
    rightLabel,
    value,
    note,
}: {
    leftLabel: string;
    rightLabel: string;
    value: number;
    note?: string;
}) {
    const pct = Math.min(100, Math.max(0, value));
    const active = pct < 40 ? leftLabel : pct > 60 ? rightLabel : 'Balanced';

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
                <span className={`font-medium ${pct <= 50 ? 'text-foreground' : 'text-muted-foreground'}`}>{leftLabel}</span>
                <span className="text-[10px] text-muted-foreground bg-background/60 border border-border/40 rounded-full px-2 py-0.5">{active}</span>
                <span className={`font-medium ${pct >= 50 ? 'text-foreground' : 'text-muted-foreground'}`}>{rightLabel}</span>
            </div>
            <div className="relative h-2.5 w-full rounded-full bg-border/30">
                <div
                    className="absolute inset-y-0 left-1/2 w-px bg-border/60 z-10"
                    style={{ transform: 'translateX(-50%)' }}
                />
                <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-700"
                    style={{ width: `${pct}%` }}
                />
                <div
                    className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-sm transition-all duration-700"
                    style={{ left: `calc(${pct}% - 8px)` }}
                />
            </div>
            {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
        </div>
    );
}

export function BrandVoiceMeterBlockView({ block }: BrandVoiceMeterBlockViewProps) {
    return (
        <div className="space-y-4">
            {block.summary && (
                <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3 italic">{block.summary}</p>
            )}
            <div className="space-y-5">
                {block.dimensions.map((dim, i) => (
                    <VoiceDimension
                        key={i}
                        leftLabel={dim.leftLabel}
                        rightLabel={dim.rightLabel}
                        value={dim.value}
                        note={dim.note}
                    />
                ))}
            </div>
        </div>
    );
}
