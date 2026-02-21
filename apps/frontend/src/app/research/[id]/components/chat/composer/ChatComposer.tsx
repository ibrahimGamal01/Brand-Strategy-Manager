'use client';

import { useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useScreenshotPaste } from './useScreenshotPaste';
import { ComposerScreenshotStrip } from './ComposerScreenshotStrip';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachments: string[]) => void;
  researchJobId: string;
  isStreaming?: boolean;
}

export function ChatComposer({ value, onChange, onSend, researchJobId }: ChatComposerProps) {
  const { attachments, handlePaste, removeAttachment, clearAttachments } = useScreenshotPaste(researchJobId);

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

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/70 p-3 shadow-sm">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ask BAT to analyze, compare, or propose options…"
        className="min-h-[120px] resize-none"
      />
      <ComposerScreenshotStrip attachments={attachments} onRemove={removeAttachment} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{value.length} chars</span>
        <Button
          onClick={() => {
            onSend(attachments.filter((a) => a.status === 'ready').map((a) => a.id));
            clearAttachments();
          }}
          disabled={!value.trim() && attachments.length === 0}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
