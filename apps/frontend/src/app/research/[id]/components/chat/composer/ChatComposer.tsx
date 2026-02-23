'use client';

import { useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
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

  // Show slash palette when value starts with /
  const showSlashPalette = value.startsWith('/') && !value.includes(' ');
  const slashQuery = showSlashPalette ? value : '';

  // Paste handler
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
    // Ctrl+Enter or Cmd+Enter to send
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSend();
      return;
    }
    // Up arrow to recall
    if (e.key === 'ArrowUp' && value === '' && recallHistory.length > 0) {
      e.preventDefault();
      const next = Math.min(recallIndex + 1, recallHistory.length - 1);
      setRecallIndex(next);
      onChange(recallHistory[next] || '');
      return;
    }
    // Down arrow to clear recall
    if (e.key === 'ArrowDown' && recallIndex >= 0) {
      e.preventDefault();
      const next = recallIndex - 1;
      setRecallIndex(next);
      onChange(next < 0 ? '' : recallHistory[next] || '');
      return;
    }
    // Escape to clear
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
    <div className="flex flex-col gap-2 max-w-4xl mx-auto w-full">
      {/* Prompt chips */}
      <div className="px-1">
        <PromptChips onSelect={handleChipSelect} disabled={isStreaming} />
      </div>

      <div className="relative flex flex-col rounded-2xl border border-border/50 bg-background/60 shadow-sm backdrop-blur-md transition-all focus-within:border-emerald-500/40 focus-within:shadow-md focus-within:ring-1 focus-within:ring-emerald-500/20">
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
          className="min-h-[60px] max-h-[200px] w-full resize-none border-0 bg-transparent px-4 py-4 text-[15px] leading-relaxed text-foreground shadow-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
          disabled={isStreaming}
        />

        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex min-h-[32px] flex-wrap items-center gap-2">
            <ComposerScreenshotStrip attachments={attachments} onRemove={removeAttachment} />
          </div>
          <div className="flex items-center gap-3 pl-2">
            <span className="hidden sm:inline-block text-[10px] font-medium tracking-wide text-muted-foreground/40 uppercase">
              {value.length > 0 ? `${value.length} chars` : 'Ctrl+Enter to send'}
            </span>
            <Button
              onClick={doSend}
              disabled={isStreaming || (!value.trim() && attachments.length === 0)}
              size="icon"
              className="h-8 w-8 rounded-full transition-transform hover:scale-105 active:scale-95 bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-muted disabled:text-muted-foreground"
            >
              {isStreaming ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="translate-x-[1px] translate-y-[0px]"><path d="M8.14645 3.14645C8.34171 2.95118 8.65829 2.95118 8.85355 3.14645L12.8536 7.14645C13.0488 7.34171 13.0488 7.65829 12.8536 7.85355L8.85355 11.8536C8.65829 12.0488 8.34171 12.0488 8.14645 11.8536C7.95118 11.6583 7.95118 11.3417 8.14645 11.1464L11.2929 8H2.5C2.22386 8 2 7.77614 2 7.5C2 7.22386 2.22386 7 2.5 7H11.2929L8.14645 3.85355C7.95118 3.65829 7.95118 3.34171 8.14645 3.14645Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
