'use client';

import { useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useScreenshotPaste } from './useScreenshotPaste';
import { ComposerScreenshotStrip } from './ComposerScreenshotStrip';
import { PromptChips } from './PromptChips';
import { SlashCommandPalette } from './SlashCommandPalette';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachments: string[]) => void;
  researchJobId: string;
  isStreaming?: boolean;
}

export function ChatComposer({ value, onChange, onSend, researchJobId, isStreaming }: ChatComposerProps) {
  const { attachments, handlePaste, removeAttachment, clearAttachments } = useScreenshotPaste(researchJobId);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [recallHistory, setRecallHistory] = useState<string[]>([]);
  const [recallIndex, setRecallIndex] = useState(-1);

  const showSlashPalette = value.startsWith('/') && !value.includes(' ');
  const slashQuery = showSlashPalette ? value : '';

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      void handlePaste(e);
    }
    const target = typeof window !== 'undefined' ? window : null;
    if (target) target.addEventListener('paste', onPaste);
    return () => {
      if (target) target.removeEventListener('paste', onPaste);
    };
  }, [handlePaste]);

  function doSend() {
    if (isStreaming) return;
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    if (trimmed) setRecallHistory((prev) => [trimmed, ...prev.slice(0, 19)]);
    setRecallIndex(-1);
    onSend(attachments.filter((a) => a.status === 'ready').map((a) => a.id));
    clearAttachments();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSend();
      return;
    }
    if (e.key === 'ArrowUp' && value === '' && recallHistory.length > 0) {
      e.preventDefault();
      const next = Math.min(recallIndex + 1, recallHistory.length - 1);
      setRecallIndex(next);
      onChange(recallHistory[next] || '');
      return;
    }
    if (e.key === 'ArrowDown' && recallIndex >= 0) {
      e.preventDefault();
      const next = recallIndex - 1;
      setRecallIndex(next);
      onChange(next < 0 ? '' : recallHistory[next] || '');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onChange('');
      setRecallIndex(-1);
    }
  }

  function handleChipSelect(prompt: string) {
    onChange(prompt);
    textareaRef.current?.focus();
  }

  function handleSlashSelect(template: string) {
    onChange(template);
    textareaRef.current?.focus();
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    setRecallIndex(-1);
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div
        className="relative flex flex-col rounded-2xl border transition-all focus-within:shadow-md"
        style={{ borderColor: 'var(--chat-shell-border)', background: 'var(--chat-shell-surface)' }}
      >
        {showSlashPalette && (
          <SlashCommandPalette
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={() => onChange('')}
          />
        )}

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'BAT is thinking...' : 'Ask BAT anything about your brand, or type / for commands…'}
          className="min-h-[56px] max-h-[180px] w-full resize-none border-0 bg-transparent px-4 py-3.5 text-[14px] leading-relaxed shadow-none placeholder:text-[#5e625f]/70 focus-visible:ring-0 dark:placeholder:text-[#a6bcba]/70"
          style={{ color: 'var(--chat-shell-text)' }}
          disabled={isStreaming}
        />

        <div className="flex items-center justify-between px-3 pb-3 pt-1 gap-2">
          <div className="flex flex-1 min-w-0 flex-wrap items-center gap-2">
            <ComposerScreenshotStrip attachments={attachments} onRemove={removeAttachment} />
            <PromptChips onSelect={handleChipSelect} disabled={isStreaming} />
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="hidden whitespace-nowrap text-[10px] font-medium uppercase tracking-wide sm:inline-block" style={{ color: 'var(--chat-shell-text-muted)' }}>
              {value.length > 0 ? `${value.length} chars` : '⌘↵ send'}
            </span>
            <Button
              onClick={doSend}
              disabled={isStreaming || (!value.trim() && attachments.length === 0)}
              size="sm"
              className="h-8 gap-1 rounded-full px-3 text-xs font-semibold"
              style={{ background: 'var(--chat-shell-accent)', color: '#fff' }}
            >
              {isStreaming ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running
                </>
              ) : (
                <>
                  <ArrowRight className="h-3.5 w-3.5" /> Run
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
