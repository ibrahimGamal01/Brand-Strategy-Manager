import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import type { ChatMessage } from './types';
import type { ChatBlock } from './blocks/types';
import { ChatMessageItem } from './ChatMessageItem';
import { ChatComposer } from './composer/ChatComposer';

interface ChatThreadProps {
  messages: ChatMessage[];
  streamingMessage?: ChatMessage | null;
  sessionTitle?: string | null;
  sessionUpdatedAt?: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (attachments: string[]) => void;
  pinnedBlockIds: Set<string>;
  onBlockView: (message: ChatMessage, block: ChatBlock) => void;
  onBlockPin: (message: ChatMessage, block: ChatBlock) => void;
  onBlockUnpin: (message: ChatMessage, block: ChatBlock) => void;
  onSelectDesign: (message: ChatMessage, designId: string) => void;
  onAttachmentView?: (message: ChatMessage, attachmentId: string, meta?: Record<string, unknown>) => void;
  isStreaming?: boolean;
  connectionStatus?: string;
  researchJobId: string;
}

export function ChatThread({
  messages,
  streamingMessage,
  sessionTitle,
  sessionUpdatedAt,
  draft,
  onDraftChange,
  onSend,
  pinnedBlockIds,
  onBlockView,
  onBlockPin,
  onBlockUnpin,
  onSelectDesign,
  onAttachmentView,
  isStreaming,
  connectionStatus,
  researchJobId,
}: ChatThreadProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const displayMessages = streamingMessage
    ? [...messages.filter((msg) => msg.id !== streamingMessage.id), streamingMessage]
    : messages;

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [displayMessages.length, streamingMessage?.content]);

  const headerTime = sessionUpdatedAt ? new Date(sessionUpdatedAt).toLocaleString() : null;
  const connectionLabel = connectionStatus || 'idle';

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-sm flex flex-col overflow-hidden" style={{ minHeight: 0, flex: '1 1 auto' }}>
        {/* Session header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 flex-shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active Thread</p>
            <h3 className="text-sm font-semibold">{sessionTitle || 'Untitled session'}</h3>
            {headerTime ? (
              <p className="text-[11px] text-muted-foreground">Last active: {headerTime}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase">
              {displayMessages.length} messages
            </Badge>
            <Badge
              variant={isStreaming ? 'warning' : 'secondary'}
              className={`text-[10px] uppercase transition-all ${isStreaming ? 'animate-pulse' : ''}`}
            >
              {isStreaming ? 'thinking' : 'idle'}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              {connectionLabel}
            </Badge>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={containerRef}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-3 custom-scrollbar"
          style={{ minHeight: 0 }}
        >
          {displayMessages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-12 text-center"
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl text-white shadow-lg">
                BAT
              </div>
              <h4 className="text-sm font-semibold text-foreground">BAT Intelligence</h4>
              <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">
                Your brand strategy co-pilot. Ask anything about your brand, competitors, or content direction.
              </p>
              <p className="mt-3 text-[11px] text-muted-foreground/60">
                Type / to see available commands
              </p>
            </motion.div>
          ) : (
            <AnimatePresence initial={false}>
              {displayMessages.map((message, index) => (
                <motion.div
                  key={message.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.2, delay: index === displayMessages.length - 1 ? 0 : 0 }}
                >
                  <ChatMessageItem
                    message={message}
                    pinnedBlockIds={pinnedBlockIds}
                    onBlockView={onBlockView}
                    onBlockPin={onBlockPin}
                    onBlockUnpin={onBlockUnpin}
                    onSelectDesign={onSelectDesign}
                    onAttachmentView={onAttachmentView}
                    onComposerFill={onDraftChange}
                    researchJobId={researchJobId}
                  />
                </motion.div>
              ))}
              {/* Streaming cursor indicator */}
              {isStreaming && (
                <motion.div
                  key="streaming-cursor"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 px-4 py-2"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-[10px] font-bold text-white">
                    BAT
                  </div>
                  <div className="flex items-center gap-1">
                    {[0, 0.15, 0.3].map((delay, i) => (
                      <motion.div
                        key={i}
                        className="h-2 w-2 rounded-full bg-emerald-500"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ repeat: Infinity, duration: 0.6, delay }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

      <ChatComposer
        value={draft}
        onChange={onDraftChange}
        onSend={onSend}
        isStreaming={isStreaming}
        researchJobId={researchJobId}
      />
    </section>
  );
}
