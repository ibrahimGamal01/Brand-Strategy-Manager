'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SlashCommand {
    command: string;
    description: string;
    icon: string;
    template: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
    { command: '/swot', description: 'Generate a SWOT analysis block', icon: '📊', template: '/swot Generate a full SWOT analysis for my brand' },
    { command: '/compare', description: 'Side-by-side comparison of competitors', icon: '⚔️', template: '/compare Compare my top competitors side by side' },
    { command: '/table', description: 'Output data as a structured table', icon: '📋', template: '/table Show me a data table of ' },
    { command: '/brief', description: 'Generate a creative brief card', icon: '📝', template: '/brief Generate a creative brief for ' },
    { command: '/voice', description: 'Analyze brand voice profile', icon: '🎙️', template: '/voice Analyze my brand voice and rate it across key dimensions' },
    { command: '/calendar', description: 'Build a content calendar', icon: '📅', template: '/calendar Build a 1-week content calendar for my brand' },
    { command: '/scoreboard', description: 'Rank competitors with scores', icon: '🏆', template: '/scoreboard Rank my competitors by content quality and engagement' },
    { command: '/poll', description: 'Ask me to choose between options', icon: '🗳️', template: '/poll Give me options to choose between for ' },
];

interface SlashCommandPaletteProps {
    query: string;
    onSelect: (template: string) => void;
    onClose: () => void;
}

export function SlashCommandPalette({ query, onSelect, onClose }: SlashCommandPaletteProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const filtered = SLASH_COMMANDS.filter((cmd) =>
        cmd.command.includes(query.toLowerCase()) || cmd.description.toLowerCase().includes(query.slice(1).toLowerCase())
    );

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [onClose]);

    if (filtered.length === 0) return null;

    return (
        <AnimatePresence>
            <motion.div
                ref={containerRef}
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-xl border border-border/70 bg-popover shadow-xl overflow-hidden"
            >
                <div className="px-3 py-2 border-b border-border/50">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Commands</p>
                </div>
                <ul className="py-1 max-h-60 overflow-y-auto">
                    {filtered.map((cmd) => (
                        <li key={cmd.command}>
                            <button
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    onSelect(cmd.template);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors"
                            >
                                <span className="text-base flex-shrink-0">{cmd.icon}</span>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground">{cmd.command}</p>
                                    <p className="text-[11px] text-muted-foreground truncate">{cmd.description}</p>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            </motion.div>
        </AnimatePresence>
    );
}
