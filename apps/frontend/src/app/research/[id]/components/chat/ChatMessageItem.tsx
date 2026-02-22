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
import { FollowUpChips } from './FollowUpChips';
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

/**
 * Aggressive JSON cleaner.
 * Strips:
 *  1. <chat_blocks>...</chat_blocks> blobs
 *  2. ```json {...} ``` fences
 *  3. Trailing partial { "blocks"... JSON
 *  4. Any trailing standalone { that starts a JSON object
 */
function cleanContent(raw: string): string {
  let text = raw;
  // Remove XML-wrapped blocks payload
  text = text.replace(/<chat_blocks>[\s\S]*?<\/chat_blocks>/gi, '');
  // Remove fenced JSON blocks
  text = text.replace(/```json[\s\S]*?```/gi, '');
  text = text.replace(/```[\s\S]*?```/g, (m) => (m.includes('"blocks"') ? '' : m));
  // Remove trailing standalone JSON object that starts with {
  text = text.replace(/\s*\{[\s\S]*$/m, (match) => {
    if (/"blocks"\s*:/.test(match) || /"designOptions"\s*:/.test(match) || /"follow_up"\s*:/.test(match)) {
      return '';
    }
    return match;
  });
  return text.trim();
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
  const cleanedContent = useMemo(() => cleanContent(message.content || ''), [message.content]);

  const followUp: string[] = useMemo(() => {
    if (Array.isArray(message.followUp) && message.followUp.length > 0) return message.followUp;
    return [];
  }, [message.followUp]);

  function handleRemix(content: string) {
    onComposerFill?.(`Remix this: "${content.slice(0, 120).replace(/\n/g, ' ')}"`);
  }
  function handleExpand(content: string) {
    onComposerFill?.(`Go deeper on this: "${content.slice(0, 120).replace(/\n/g, ' ')}"`);
  }
  function handleTranslate(content: string, tone: 'professional' | 'casual' | 'punchy') {
    const labels = { professional: 'professional and formal', casual: 'casual and friendly', punchy: 'punchy and bold' };
    onComposerFill?.(`Rewrite this in a ${labels[tone]} tone: "${content.slice(0, 120).replace(/\n/g, ' ')}"`);
  }
  function handleClarify(answer: string) {
    onComposerFill?.(answer);
  }

  // ── USER BUBBLE ────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary/12 px-4 py-2.5 text-sm text-foreground shadow-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          <p className="mt-1 text-right text-[10px] text-muted-foreground/60">{formatTimestamp(message.createdAt)}</p>
        </div>
      </div>
    );
  }

  // ── BAT RESPONSE ──────────────────────────────────────────────────────────
  return (
    <article
      className="group relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3">

        {/* BAT avatar column */}
        <div className="flex flex-shrink-0 flex-col items-center gap-0.5 pt-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-[10px] font-bold tracking-wide text-white shadow-md">
            BAT
          </div>
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50">Intel</span>
        </div>

        {/* Message body */}
        <div className="min-w-0 flex-1">

          {/* Header row: label + timestamp */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-teal-600 dark:text-teal-400">
              BAT Intelligence
            </span>
            <span className="text-[10px] text-muted-foreground/50">{formatTimestamp(message.createdAt)}</span>
          </div>

          {/* ZONE A: Narrative response */}
          {cleanedContent ? (
            <div className="prose prose-sm max-w-none text-foreground [&_li]:my-0.5 [&_p]:my-1 [&_strong]:font-semibold">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanedContent}</ReactMarkdown>
            </div>
          ) : null}

          {/* Design options selector */}
          {designOptions.length > 0 ? (
            <div className="mt-3 rounded-lg border border-border/40 bg-muted/30 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Design Options
                </span>
                {selectedDesign ? (
                  <Badge variant="outline" className="text-[10px] uppercase">{selectedDesign}</Badge>
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

          {/* Attachments */}
          <AttachmentGallery
            attachments={message.attachments}
            onView={(att) => onAttachmentView?.(message, att.id, {
              recordType: att.recordType,
              recordId: att.recordId,
              isAppScreenshot: att.isAppScreenshot,
            })}
          />

          {/* ZONE B: Structured blocks */}
          {activeBlocks.length > 0 ? (
            <div className="mt-3 space-y-3">
              {activeBlocks.map((block) => (
                <BlockRenderer
                  key={block.blockId}
                  block={block}
                  isPinned={pinnedBlockIds.has(block.blockId)}
                  onView={(b) => onBlockView(message, b)}
                  onPin={(b) => onBlockPin(message, b)}
                  onUnpin={(b) => onBlockUnpin(message, b)}
                  onClarify={handleClarify}
                  onAction={(action, href) => {
                    if (action === 'open_module') {
                      const target = href || `/research/${researchJobId}?module=intelligence`;
                      if (target.startsWith('http')) window.open(target, '_blank');
                      else router.push(target);
                      return;
                    }
                    if (action === 'run_intel' || action === 'run_orchestrator' || action === 'run_intelligence') {
                      const target = href || `/api/research-jobs/${researchJobId}/brand-intelligence/orchestrate`;
                      fetch(target, { method: 'POST' }).catch(() => { });
                      return;
                    }
                    if (href) window.open(href, href.startsWith('http') ? '_blank' : '_self');
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* ZONE C: Follow-up suggestions */}
          <FollowUpChips
            suggestions={followUp}
            onSelect={(s) => onComposerFill?.(s)}
            isHidden={message.pending}
          />
        </div>
      </div>

      {/* Hover toolbar */}
      {hovered && !message.pending && (
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
