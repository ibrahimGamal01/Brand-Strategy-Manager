import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import type { ChatMessage } from './types';
import type { ChatBlock, ChatDesignOption } from './blocks/types';
import { BlockRenderer } from './blocks/BlockRenderer';
import { AttachmentGallery } from './AttachmentGallery';
import { MessageToolbar } from './MessageToolbar';
import { useRouter } from 'next/navigation';

interface ChatMessageItemProps {
  message: ChatMessage;
  pinnedBlockIds: Set<string>;
  onBlockView: (message: ChatMessage, block: ChatBlock) => void;
  onBlockPin: (message: ChatMessage, block: ChatBlock) => void;
  onBlockUnpin: (message: ChatMessage, block: ChatBlock) => void;
  onSelectDesign: (message: ChatMessage, designId: string) => void;
  onAttachmentView?: (message: ChatMessage, attachmentId: string, meta?: Record<string, unknown>) => void;
  onComposerFill?: (text: string) => void;
  researchJobId: string;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function resolveDesignSelection(message: ChatMessage): string | null {
  if (!message.designOptions?.length) return null;
  if (message.selectedDesignId) return message.selectedDesignId;
  return message.designOptions[0]?.designId || null;
}

function resolveBlocks(message: ChatMessage, selectedDesignId: string | null): ChatBlock[] {
  if (selectedDesignId && message.designOptions?.length) {
    const match = message.designOptions.find((option) => option.designId === selectedDesignId);
    if (match) return match.blocks || [];
  }
  return (message.blocks || []) as ChatBlock[];
}

export function ChatMessageItem({
  message,
  pinnedBlockIds,
  onBlockView,
  onBlockPin,
  onBlockUnpin,
  onSelectDesign,
  onAttachmentView,
  onComposerFill,
  researchJobId,
}: ChatMessageItemProps) {
  const router = useRouter();
  const isUser = message.role === 'USER';
  const [hovered, setHovered] = useState(false);
  const initialDesign = useMemo(() => resolveDesignSelection(message), [message]);
  const [selectedDesign, setSelectedDesign] = useState<string | null>(initialDesign);

  useEffect(() => {
    setSelectedDesign(resolveDesignSelection(message));
  }, [message.id, message.selectedDesignId, message.designOptions]);

  const activeBlocks = resolveBlocks(message, selectedDesign);
  const designOptions = (message.designOptions || []) as ChatDesignOption[];
  const blockCount = activeBlocks.length;
  const hasAttachments = (message.attachments?.length || 0) > 0;

  const avatarLabel = isUser ? 'You' : 'BAT';

  const cleanedContent = useMemo(() => {
    let content = message.content || '';
    content = content.replace(/```(?:json)?\s*\{[^`]*"blocks"[^`]*"designOptions"[^`]*\}\s*```/gi, '');
    if (/^\s*\{\s*"blocks"\s*:\s*\[[\s\S]*?\]\s*,\s*"designOptions"\s*:\s*\[[\s\S]*?\]\s*\}\s*$/i.test(content)) {
      content = '';
    }
    return content.trim();
  }, [message.content]);

  function handleRemix(content: string) {
    const preview = content.slice(0, 120).replace(/\n/g, ' ');
    onComposerFill?.(`Remix this: "${preview}"`);
  }

  function handleExpand(content: string) {
    const preview = content.slice(0, 120).replace(/\n/g, ' ');
    onComposerFill?.(`Go deeper on this: "${preview}"`);
  }

  function handleTranslate(content: string, tone: 'professional' | 'casual' | 'punchy') {
    const preview = content.slice(0, 120).replace(/\n/g, ' ');
    const toneLabel = { professional: 'professional and formal', casual: 'casual and friendly', punchy: 'punchy and bold' }[tone];
    onComposerFill?.(`Rewrite this in a ${toneLabel} tone: "${preview}"`);
  }

  return (
    <article
      className={`group relative rounded-xl border px-4 py-3 text-sm shadow-sm transition-colors ${isUser
          ? 'ml-auto max-w-[85%] border-primary/30 bg-gradient-to-br from-primary/10 to-background text-foreground'
          : 'mr-auto border-border/70 bg-card/80 text-foreground'
        }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold tracking-wide ${isUser
              ? 'bg-primary/20 text-primary'
              : 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-sm'
            }`}
        >
          {avatarLabel}
        </div>

        <div className="flex-1 min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="font-semibold">{isUser ? 'You' : 'BAT Intelligence'}</span>
              {message.pending ? <Badge variant="outline">sending</Badge> : null}
              {!isUser && (blockCount > 0 || hasAttachments) ? (
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {blockCount + (message.attachments?.length || 0)} items
                </Badge>
              ) : null}
            </div>
            <span className="text-[10px] text-muted-foreground">{formatTimestamp(message.createdAt)}</span>
          </div>

          {isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">{cleanedContent || message.content}</p>
          ) : cleanedContent ? (
            <div className="prose prose-sm max-w-none text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanedContent}</ReactMarkdown>
            </div>
          ) : null}

          {designOptions.length > 0 ? (
            <div className="mt-3 rounded-md border border-border/50 bg-background/70 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Design Options
                </span>
                {selectedDesign ? (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {selectedDesign}
                  </Badge>
                ) : null}
              </div>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={selectedDesign || undefined}
                onValueChange={(value) => {
                  if (!value) return;
                  setSelectedDesign(value);
                  onSelectDesign(message, value);
                }}
                className="justify-start"
              >
                {designOptions.map((option) => (
                  <ToggleGroupItem key={option.designId} value={option.designId} className="text-xs">
                    {option.label || option.designId}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ) : null}

          <AttachmentGallery
            attachments={message.attachments}
            onView={(att) => {
              onAttachmentView?.(message, att.id, {
                recordType: att.recordType,
                recordId: att.recordId,
                isAppScreenshot: att.isAppScreenshot,
              });
            }}
          />

          {activeBlocks.length > 0 ? (
            <div className="mt-3 space-y-2">
              {activeBlocks.map((block) => (
                <BlockRenderer
                  key={block.blockId}
                  block={block}
                  isPinned={pinnedBlockIds.has(block.blockId)}
                  onView={(b) => onBlockView(message, b)}
                  onPin={(b) => onBlockPin(message, b)}
                  onUnpin={(b) => onBlockUnpin(message, b)}
                  onAction={(action, href) => {
                    if (action === 'open_module') {
                      const targetHref = href || `/research/${researchJobId}?module=intelligence`;
                      if (targetHref.startsWith('http')) window.open(targetHref, '_blank');
                      else router.push(targetHref);
                      return;
                    }
                    if (action === 'run_intel' || action === 'run_orchestrator' || action === 'run_intelligence') {
                      const targetHref =
                        href || `/api/research-jobs/${researchJobId}/brand-intelligence/orchestrate`;
                      fetch(targetHref, { method: 'POST' }).catch(() => { });
                      return;
                    }
                    if (href) {
                      const target = href.startsWith('http') ? '_blank' : '_self';
                      window.open(href, target);
                    }
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Hover toolbar - only for assistant messages */}
      {!isUser && hovered && !message.pending && (
        <div className="absolute -top-5 right-3 z-20">
          <MessageToolbar
            message={message}
            onRemix={handleRemix}
            onExpand={handleExpand}
            onTranslate={handleTranslate}
          />
        </div>
      )}
    </article>
  );
}
