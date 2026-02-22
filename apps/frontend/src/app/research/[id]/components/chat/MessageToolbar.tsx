'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from './types';

interface MessageToolbarProps {
    message: ChatMessage;
    onRemix: (content: string) => void;
    onExpand: (content: string) => void;
    onTranslate: (content: string, tone: 'professional' | 'casual' | 'punchy') => void;
}

function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
}

function downloadMarkdown(message: ChatMessage) {
    const content = message.content || '';
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bat-response-${message.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

const TONE_LABELS = {
    professional: '🎩 Professional',
    casual: '😎 Casual',
    punchy: '⚡ Punchy',
} as const;

type Tone = keyof typeof TONE_LABELS;

export function MessageToolbar({ message, onRemix, onExpand, onTranslate }: MessageToolbarProps) {
    const [copied, setCopied] = useState(false);
    const [toneOpen, setToneOpen] = useState(false);
    const [reaction, setReaction] = useState<'up' | 'down' | null>(null);

    function handleCopy() {
        copyToClipboard(message.content || '');
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    }

    function handleReaction(r: 'up' | 'down') {
        setReaction(r);
    }

    return (
        <div className="flex items-center gap-0.5 rounded-full border border-border/50 bg-background/80 px-1.5 py-1 shadow-sm backdrop-blur-sm">
            {/* Copy */}
            <ToolButton
                onClick={handleCopy}
                title="Copy text"
                active={copied}
            >
                {copied ? '✓' : '📋'}
            </ToolButton>

            {/* Export */}
            <ToolButton onClick={() => downloadMarkdown(message)} title="Download as markdown">
                ⬇
            </ToolButton>

            {/* Remix */}
            <ToolButton
                onClick={() => onRemix(message.content || '')}
                title="Remix this response"
            >
                🔀
            </ToolButton>

            {/* Expand */}
            <ToolButton
                onClick={() => onExpand(message.content || '')}
                title="Go deeper on this"
            >
                🔭
            </ToolButton>

            {/* Tone selector */}
            <div className="relative">
                <ToolButton
                    onClick={() => setToneOpen((p) => !p)}
                    title="Re-ask in a different tone"
                    active={toneOpen}
                >
                    🎭
                </ToolButton>
                <AnimatePresence>
                    {toneOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.92, y: 4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92, y: 4 }}
                            transition={{ duration: 0.12 }}
                            className="absolute bottom-full right-0 mb-1 z-50 rounded-xl border border-border/60 bg-popover py-1 shadow-xl min-w-[140px]"
                        >
                            {(Object.entries(TONE_LABELS) as [Tone, string][]).map(([tone, label]) => (
                                <button
                                    key={tone}
                                    onClick={() => {
                                        onTranslate(message.content || '', tone);
                                        setToneOpen(false);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors"
                                >
                                    {label}
                                </button>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Divider */}
            <div className="mx-1 h-4 w-px bg-border/50" />

            {/* Reactions */}
            <ToolButton
                onClick={() => handleReaction('up')}
                title="Helpful"
                active={reaction === 'up'}
            >
                {reaction === 'up' ? '👍' : '👍'}
            </ToolButton>
            <ToolButton
                onClick={() => handleReaction('down')}
                title="Not helpful"
                active={reaction === 'down'}
            >
                {reaction === 'down' ? '👎' : '👎'}
            </ToolButton>
        </div>
    );
}

function ToolButton({
    children,
    onClick,
    title,
    active,
}: {
    children: React.ReactNode;
    onClick: () => void;
    title: string;
    active?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-sm transition-all hover:bg-accent hover:scale-110 active:scale-95 ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                }`}
        >
            {children}
        </button>
    );
}
