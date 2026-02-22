'use client';

export type MoodboardBlock = {
    type: 'moodboard';
    blockId: string;
    title?: string;
    palette: Array<{ hex: string; name?: string }>;
    fonts?: Array<{ name: string; style?: string }>;
    keywords?: string[];
    aesthetic?: string;
};

interface MoodboardBlockViewProps {
    block: MoodboardBlock;
}

export function MoodboardBlockView({ block }: MoodboardBlockViewProps) {
    return (
        <div className="space-y-4">
            {block.aesthetic && (
                <p className="text-xs italic text-muted-foreground border-l-2 border-primary/40 pl-3">{block.aesthetic}</p>
            )}

            {block.palette && block.palette.length > 0 && (
                <div>
                    <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Color Palette</p>
                    <div className="flex flex-wrap gap-2">
                        {block.palette.map((color) => (
                            <div key={color.hex} className="flex flex-col items-center gap-1">
                                <div
                                    className="h-10 w-10 rounded-lg border border-border/40 shadow-sm"
                                    style={{ backgroundColor: color.hex }}
                                    title={color.hex}
                                />
                                {color.name && <span className="text-[10px] text-muted-foreground max-w-[44px] text-center truncate">{color.name}</span>}
                                <span className="text-[9px] text-muted-foreground/60 font-mono">{color.hex}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {block.fonts && block.fonts.length > 0 && (
                <div>
                    <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Typography</p>
                    <div className="flex flex-wrap gap-2">
                        {block.fonts.map((font) => (
                            <div key={font.name} className="rounded-md border border-border/50 bg-background/60 px-3 py-1.5">
                                <p className="text-sm font-medium">{font.name}</p>
                                {font.style && <p className="text-[10px] text-muted-foreground">{font.style}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {block.keywords && block.keywords.length > 0 && (
                <div>
                    <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Aesthetic Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                        {block.keywords.map((keyword) => (
                            <span
                                key={keyword}
                                className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary border border-primary/20"
                            >
                                {keyword}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
