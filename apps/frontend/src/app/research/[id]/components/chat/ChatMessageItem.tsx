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
 * Aggressive JSON cleaner.
 * Strips:
 *  1. <chat_blocks>...</chat_blocks> blobs
 *  2. ```json {... } ``` fences
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
  // Remove markdown table rows and separators from narrative text.
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
  // Remove heading markers to keep the bubble clean.
  text = text.replace(/^\s*#{1,6}\s*/gm, '');
  text = text.replace(/\*\*/g, '');
  return text.trim();
}

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
  const hasComponentFirstBlocks = useMemo(
    () => activeBlocks.some((block) => COMPONENT_FIRST_BLOCKS.has(String(block?.type || '').toLowerCase())),
    [activeBlocks]
  );
  const hasInlineQuickReplyBar = useMemo(
    () => activeBlocks.some((block) => String(block?.type || '').toLowerCase() === 'quick_reply_bar'),
    [activeBlocks]
  );
  const narrativeContent = useMemo(() => {
    return cleanedContent || '';
  }, [cleanedContent]);

  const followUp: string[] = useMemo(() => {
    if (Array.isArray(safeMessage.followUp) && safeMessage.followUp.length > 0) return safeMessage.followUp;
    return [];
  }, [safeMessage.followUp]);

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
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex justify-end my-2"
      >
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary/10 px-5 py-3.5 text-[15px] text-foreground shadow-sm backdrop-blur-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{safeMessage.content}</p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">
              {formatTimestamp(safeMessage.createdAt)}
            </span>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── BAT RESPONSE ──────────────────────────────────────────────────────────
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="group relative my-4"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-4">

        {/* BAT avatar column */}
        <div className="flex flex-shrink-0 flex-col items-center pt-0.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 text-[10px] font-bold tracking-wider text-white shadow-sm ring-1 ring-emerald-500/20">
            BAT
          </div>
        </div>

        {/* Message body */}
        <div className="min-w-0 flex-1 space-y-4 pt-1">

          {/* Header row: label + timestamp */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold tracking-tight text-foreground">
              BAT Intelligence
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
              {formatTimestamp(safeMessage.createdAt)}
            </span>
          </div>

          {/* ZONE A: Narrative response */}
          {narrativeContent ? (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="prose prose-sm dark:prose-invert max-w-none"
            >
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{narrativeContent}</p>
            </motion.div>
          ) : null}

          {/* Design options selector */}
          {designOptions.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
              className="rounded-xl border border-border/40 bg-card/30 p-3 backdrop-blur-sm"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
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
                  onSelectDesign(safeMessage, value);
                }}
                className="justify-start"
              >
                {designOptions.map((option, index) => {
                  const designId = String(option?.designId || `design - ${index + 1} `);
                  return (
                    <ToggleGroupItem key={designId} value={designId} className="text-xs">
                      {option?.label || designId}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </motion.div>
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

          {/* ZONE B: Structured blocks */}
          {activeBlocks.length > 0 ? (
            <div className="mt-3 space-y-3">
              {activeBlocks.map((block, index) => (
                <motion.div
                  key={String((block as any)?.blockId || `block - ${index} `)}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 + index * 0.1, ease: 'easeOut' }}
                >
                  <BlockRenderer
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
                        fetch(target, { method: 'POST' }).catch(() => { });
                        return;
                      }
                      if (href) window.open(href, href.startsWith('http') ? '_blank' : '_self');
                    }}
                  />
                </motion.div>
              ))}
            </div>
          ) : null}

          {/* ZONE C: Follow-up suggestions */}
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.4 + activeBlocks.length * 0.1, ease: 'easeOut' }}
          >
            <FollowUpChips
              suggestions={followUp}
              onSelect={(s) => onComposerFill?.(s)}
              isHidden={safeMessage.pending || hasInlineQuickReplyBar}
            />
          </motion.div>
        </div>
      </div>

      {/* Hover toolbar */}
      {hovered && !safeMessage.pending && (
        <div className="absolute -top-5 right-3 z-20">
          <MessageToolbar
            message={safeMessage}
            onRemix={handleRemix}
            onExpand={handleExpand}
            onTranslate={handleTranslate}
          />
        </div>
      )}
    </motion.article>
  );
}

export const ChatMessageItem = memo(ChatMessageItemImpl);
