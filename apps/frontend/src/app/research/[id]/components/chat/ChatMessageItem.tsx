import { memo, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import type { ChatMessage } from './types';
import type { ChatBlock, ChatDesignOption } from './blocks/types';
import { BlockRenderer } from './blocks/BlockRenderer';
import { AttachmentGallery } from './AttachmentGallery';
import { MessageToolbar } from './MessageToolbar';
import { FollowUpChips } from './FollowUpChips';
import { sanitizeChatMessage } from './message-normalizer';
import { useRouter } from 'next/navigation';

interface ChatMessageItemProps {
  message: ChatMessage;
  pinnedBlockIds: Set<string>;
  onBlockView: (message: ChatMessage, block: ChatBlock) => void;
  onBlockPin: (message: ChatMessage, block: ChatBlock) => void;
  onBlockUnpin: (message: ChatMessage, block: ChatBlock) => void;
  onBlockFormSubmit?: (message: ChatMessage, block: ChatBlock, answer: string) => void;
  onSelectDesign: (message: ChatMessage, designId: string) => void;
  onAttachmentView?: (message: ChatMessage, attachmentId: string, meta?: Record<string, unknown>) => void;
  onComposerFill?: (text: string) => void;
  onActionIntent?: (action?: string, href?: string, payload?: Record<string, unknown>) => void;
  researchJobId: string;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function resolveDesignSelection(message: ChatMessage): string | null {
  const designOptions = asArray<ChatDesignOption>((message as any).designOptions);
  if (!designOptions.length) return null;
  if (message.selectedDesignId) return message.selectedDesignId;
  return designOptions[0]?.designId || null;
}

function resolveBlocks(message: ChatMessage, selectedDesignId: string | null): ChatBlock[] {
  const designOptions = asArray<ChatDesignOption>((message as any).designOptions);
  if (selectedDesignId && designOptions.length) {
    const match = designOptions.find((option) => option?.designId === selectedDesignId);
    if (match) return asArray<ChatBlock>((match as any).blocks);
  }
  return asArray<ChatBlock>((message as any).blocks);
}

const COMPONENT_FIRST_BLOCKS = new Set([
  'progress_stepper',
  'guided_question_card',
  'choice_chips',
  'option_cards',
  'recap_editor',
  'quick_reply_bar',
  'compare_modes',
  'scenario_simulator',
  'constraint_builder',
  'examples_gallery',
  'tradeoff_matrix',
  'draft_preview_card',
  'confidence_check',
]);

/**
 * Aggressive JSON cleaner — strips chat_blocks payloads, fenced JSON, trailing JSON objects,
 * bare markdown table rows, and heading markers from the narrative bubble.
 */
function cleanContent(raw: string): string {
  let text = raw;
  text = text.replace(/<chat_blocks>[\s\S]*?<\/chat_blocks>/gi, '');
  text = text.replace(/```json[\s\S]*?```/gi, '');
  text = text.replace(/```[\s\S]*?```/g, (m) => (m.includes('"blocks"') ? '' : m));
  text = text.replace(/\s*\{[\s\S]*$/m, (match) => {
    if (/"blocks"\s*:/.test(match) || /"designOptions"\s*:/.test(match) || /"follow_up"\s*:/.test(match)) {
      return '';
    }
    return match;
  });
  text = text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\|.*\|$/.test(trimmed)) return false;
      if (/^\|?[-:\s|]{3,}\|?$/.test(trimmed)) return false;
      return true;
    })
    .join('\n');
  text = text.replace(/^\s*#{1,6}\s*/gm, '');
  text = text.replace(/\*\*/g, '');
  return text.trim();
}

// Cap stagger delay so follow-up chips never feel slow even on rich responses (design review #7)
const MAX_FOLLOWUP_DELAY = 0.4;

function ChatMessageItemImpl({
  message,
  pinnedBlockIds,
  onBlockView,
  onBlockPin,
  onBlockUnpin,
  onBlockFormSubmit,
  onSelectDesign,
  onAttachmentView,
  onComposerFill,
  onActionIntent,
  researchJobId,
}: ChatMessageItemProps) {
  const router = useRouter();
  const safeMessage = useMemo(() => sanitizeChatMessage(message), [message]);
  const isUser = safeMessage.role === 'USER';
  const [hovered, setHovered] = useState(false);
  const initialDesign = useMemo(() => resolveDesignSelection(safeMessage), [safeMessage]);
  const [selectedDesign, setSelectedDesign] = useState<string | null>(initialDesign);

  useEffect(() => {
    setSelectedDesign(resolveDesignSelection(safeMessage));
  }, [safeMessage.id, safeMessage.selectedDesignId, safeMessage.designOptions]);

  const activeBlocks = resolveBlocks(safeMessage, selectedDesign);
  const designOptions = asArray<ChatDesignOption>((safeMessage as any).designOptions);
  const cleanedContent = useMemo(() => cleanContent(safeMessage.content || ''), [safeMessage.content]);
  const hasInlineQuickReplyBar = useMemo(
    () => activeBlocks.some((block) => String(block?.type || '').toLowerCase() === 'quick_reply_bar'),
    [activeBlocks]
  );
  const narrativeContent = cleanedContent || '';

  const followUp: string[] = useMemo(() => {
    if (Array.isArray(safeMessage.followUp) && safeMessage.followUp.length > 0) return safeMessage.followUp;
    return [];
  }, [safeMessage.followUp]);

  // Capped follow-up delay — never longer than 0.5s regardless of block count
  const followUpDelay = Math.min(0.3 + activeBlocks.length * 0.08, MAX_FOLLOWUP_DELAY);

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

  // ── USER BUBBLE ──────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex justify-end my-1.5"
      >
        <div className="max-w-[82%] rounded-2xl rounded-tr-md bg-primary/10 px-4 py-3 text-[14px] text-foreground shadow-sm backdrop-blur-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{safeMessage.content}</p>
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-widest">
              {formatTimestamp(safeMessage.createdAt)}
            </span>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── ASSISTANT RESPONSE ──────────────────────────────────────────────────
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="group my-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3">
        {/* BAT avatar */}
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-[9px] font-bold tracking-wider text-primary-foreground shadow-sm ring-1 ring-primary/20 mt-0.5">
          BAT
        </div>

        {/* Message body */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] font-semibold tracking-tight text-foreground">
              BAT Intelligence
            </span>
            <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground/40">
              {formatTimestamp(safeMessage.createdAt)}
            </span>
          </div>

          {/* Narrative text */}
          {narrativeContent ? (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">
              {narrativeContent}
            </p>
          ) : null}

          {/* Design options selector */}
          {designOptions.length > 0 ? (
            <div className="rounded-xl border border-border/40 bg-card/30 p-3 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Design Options
                </span>
                {selectedDesign && (
                  <Badge variant="outline" className="text-[9px] uppercase">{selectedDesign}</Badge>
                )}
              </div>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={selectedDesign || undefined}
                onValueChange={(value) => {
                  if (!value) return;
                  setSelectedDesign(value);
                  onSelectDesign(safeMessage, value);
                }}
                className="justify-start"
              >
                {designOptions.map((option, index) => {
                  const designId = String(option?.designId || `design-${index + 1}`);
                  return (
                    <ToggleGroupItem key={designId} value={designId} className="text-xs">
                      {option?.label || designId}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
          ) : null}

          {/* Attachments */}
          <AttachmentGallery
            attachments={safeMessage.attachments}
            onView={(att) => onAttachmentView?.(safeMessage, att.id, {
              recordType: att.recordType,
              recordId: att.recordId,
              isAppScreenshot: att.isAppScreenshot,
            })}
          />

          {/* Structured blocks — only newly-arriving ones get animation */}
          {activeBlocks.length > 0 ? (
            <div className="space-y-3">
              {activeBlocks.map((block, index) => (
                <BlockRenderer
                  key={String((block as any)?.blockId || `block-${index}`)}
                  block={block}
                  isPinned={pinnedBlockIds.has(String((block as any)?.blockId || ''))}
                  onView={(b) => onBlockView(safeMessage, b)}
                  onPin={(b) => onBlockPin(safeMessage, b)}
                  onUnpin={(b) => onBlockUnpin(safeMessage, b)}
                  onClarify={handleClarify}
                  onFormSubmit={(b, answer) => onBlockFormSubmit?.(safeMessage, b, answer)}
                  onAction={(action, href, payload) => {
                    if (onActionIntent) {
                      onActionIntent(action, href, payload);
                      return;
                    }
                    if (action === 'open_module') {
                      const target = href || `/research/${researchJobId}?module=intelligence`;
                      if (target.startsWith('http')) window.open(target, '_blank');
                      else router.push(target);
                      return;
                    }
                    if (action === 'run_intel' || action === 'run_orchestrator' || action === 'run_intelligence') {
                      const target = href || `/api/research-jobs/${researchJobId}/brand-intelligence/orchestrate`;
                      fetch(target, { method: 'POST' }).catch(() => {});
                      return;
                    }
                    if (action === 'run_orchestration') {
                      fetch(`/api/research-jobs/${researchJobId}/orchestration/run`, { method: 'POST' }).catch(() => {});
                      return;
                    }
                    if (action === 'document_generate') {
                      window.open(`/api/strategy/${researchJobId}/export`, '_blank');
                      return;
                    }
                    if (href) window.open(href, href.startsWith('http') ? '_blank' : '_self');
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* Follow-up chips — capped delay */}
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: followUpDelay, ease: 'easeOut' }}
          >
            <FollowUpChips
              suggestions={followUp}
              onSelect={(s) => onComposerFill?.(s)}
              isHidden={safeMessage.pending || hasInlineQuickReplyBar}
            />
          </motion.div>

          {/* Inline message toolbar — opacity-only toggle to avoid layout shift */}
          {!safeMessage.pending && (
            <div
              className={`transition-opacity duration-150 ${
                hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <MessageToolbar
                message={safeMessage}
                onRemix={handleRemix}
                onExpand={handleExpand}
                onTranslate={handleTranslate}
              />
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export const ChatMessageItem = memo(ChatMessageItemImpl);
