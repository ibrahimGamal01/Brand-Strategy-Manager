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
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/70 p-3 shadow-sm">
      {/* Prompt chips */}
      <PromptChips onSelect={handleChipSelect} disabled={isStreaming} />

      {/* Composer area with relative positioning for slash palette */}
      <div className="relative">
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
          className="min-h-[100px] resize-none"
          disabled={isStreaming}
        />
      </div>

      <ComposerScreenshotStrip attachments={attachments} onRemove={removeAttachment} />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="text-[10px] text-muted-foreground/60">
          {value.length > 0 ? `${value.length} chars` : 'Ctrl+Enter to send · / for commands · ↑ to recall'}
        </span>
        <Button
          onClick={doSend}
          disabled={isStreaming || (!value.trim() && attachments.length === 0)}
          size="sm"
          className="gap-2"
        >
          {isStreaming ? (
            <>
              <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Thinking...
            </>
          ) : (
            <>Send ↵</>
          )}
        </Button>
      </div>
    </div>
  );
}
