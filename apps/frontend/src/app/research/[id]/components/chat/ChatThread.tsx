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
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Conversation</p>
            <h3 className="text-sm font-semibold">{sessionTitle || 'Untitled session'}</h3>
            {headerTime ? (
              <p className="text-[11px] text-muted-foreground">Last active: {headerTime}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase">
              {displayMessages.length} messages
            </Badge>
            <Badge variant={isStreaming ? 'warning' : 'secondary'} className="text-[10px] uppercase">
              {isStreaming ? 'streaming' : 'idle'}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              {connectionLabel}
            </Badge>
          </div>
        </div>

        <div
          ref={containerRef}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-3 custom-scrollbar"
        >
          {displayMessages.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
              Start a chat to explore research insights, draft options, or compare directions.
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {displayMessages.map((message) => (
                <motion.div
                  key={message.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.2 }}
                >
          <ChatMessageItem
            message={message}
            pinnedBlockIds={pinnedBlockIds}
            onBlockView={onBlockView}
            onBlockPin={onBlockPin}
            onBlockUnpin={onBlockUnpin}
            onSelectDesign={onSelectDesign}
            onAttachmentView={onAttachmentView}
            researchJobId={researchJobId}
          />
        </motion.div>
      ))}
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
