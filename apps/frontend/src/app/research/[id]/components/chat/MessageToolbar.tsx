'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy,
  Check,
  Download,
  Shuffle,
  ArrowUpRight,
  Wand2,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
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

const TONE_LABELS: Record<Tone, string> = {
  professional: 'Professional',
  casual: 'Casual',
  punchy: 'Punchy',
};

type Tone = 'professional' | 'casual' | 'punchy';

export function MessageToolbar({ message, onRemix, onExpand, onTranslate }: MessageToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const [reaction, setReaction] = useState<'up' | 'down' | null>(null);

  function handleCopy() {
    copyToClipboard(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className="flex w-fit items-center gap-0.5 rounded-full border px-1.5 py-1 shadow-sm"
      style={{ borderColor: 'var(--chat-shell-border)', background: 'var(--chat-shell-surface)' }}
    >
      {/* Copy */}
      <ToolButton onClick={handleCopy} title="Copy text" active={copied}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </ToolButton>

      {/* Export */}
      <ToolButton onClick={() => downloadMarkdown(message)} title="Download as markdown">
        <Download className="h-3 w-3" />
      </ToolButton>

      {/* Remix */}
      <ToolButton onClick={() => onRemix(message.content || '')} title="Remix this response">
        <Shuffle className="h-3 w-3" />
      </ToolButton>

      {/* Expand */}
      <ToolButton onClick={() => onExpand(message.content || '')} title="Go deeper on this">
        <ArrowUpRight className="h-3 w-3" />
      </ToolButton>

      {/* Tone selector */}
      <div className="relative">
        <ToolButton
          onClick={() => setToneOpen((p) => !p)}
          title="Re-ask in a different tone"
          active={toneOpen}
        >
          <Wand2 className="h-3 w-3" />
        </ToolButton>
        <AnimatePresence>
          {toneOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 4 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-full right-0 mb-1 z-50 rounded-xl border border-border/60 bg-popover py-1 shadow-xl min-w-[130px]"
            >
              {(Object.keys(TONE_LABELS) as Tone[]).map((tone) => (
                <button
                  key={tone}
                  onClick={() => {
                    onTranslate(message.content || '', tone);
                    setToneOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors capitalize"
                >
                  {TONE_LABELS[tone]}
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
        onClick={() => setReaction(reaction === 'up' ? null : 'up')}
        title="Helpful"
        active={reaction === 'up'}
      >
        <ThumbsUp className="h-3 w-3" />
      </ToolButton>
      <ToolButton
        onClick={() => setReaction(reaction === 'down' ? null : 'down')}
        title="Not helpful"
        active={reaction === 'down'}
      >
        <ThumbsDown className="h-3 w-3" />
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
      className="flex h-6 w-6 items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95"
      style={{
        background: active ? 'var(--chat-shell-accent-soft)' : 'transparent',
        color: active ? 'var(--chat-shell-accent)' : 'var(--chat-shell-text-muted)',
      }}
    >
      {children}
    </button>
  );
}
