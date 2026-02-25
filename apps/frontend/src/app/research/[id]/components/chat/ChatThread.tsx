import { useEffect, useMemo, useRef } from 'react';
import type { ChatMessage } from './types';
import type { ChatBlock } from './blocks/types';
import { ChatMessageItem } from './ChatMessageItem';
import { ChatComposer } from './composer/ChatComposer';

interface ChatThreadProps {
  messages: ChatMessage[];
  streamingMessage?: ChatMessage | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (attachments: string[]) => void;
  pinnedBlockIds: Set<string>;
  onBlockView: (message: ChatMessage, block: ChatBlock) => void;
  onBlockPin: (message: ChatMessage, block: ChatBlock) => void;
  onBlockUnpin: (message: ChatMessage, block: ChatBlock) => void;
  onBlockFormSubmit?: (message: ChatMessage, block: ChatBlock, answer: string) => void;
  onSelectDesign: (message: ChatMessage, designId: string) => void;
  onAttachmentView?: (message: ChatMessage, attachmentId: string, meta?: Record<string, unknown>) => void;
  onActionIntent?: (action?: string, href?: string, payload?: Record<string, unknown>) => void;
  isStreaming?: boolean;
  researchJobId: string;
}

export function ChatThread({
  messages,
  streamingMessage,
  draft,
  onDraftChange,
  onSend,
  pinnedBlockIds,
  onBlockView,
  onBlockPin,
  onBlockUnpin,
  onBlockFormSubmit,
  onSelectDesign,
  onAttachmentView,
  onActionIntent,
  isStreaming,
  researchJobId,
}: ChatThreadProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const displayMessages = useMemo(() => {
    if (!streamingMessage) return messages;
    return [...messages.filter((msg) => msg.id !== streamingMessage.id), streamingMessage];
  }, [messages, streamingMessage]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [displayMessages.length, streamingMessage?.content]);

  return (
    <section className="flex h-full flex-col">
      <div
        ref={containerRef}
        className="custom-scrollbar flex-1 overflow-y-auto px-5 py-5"
        style={{ minHeight: 0 }}
      >
        {displayMessages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-4 py-10 text-center">
            <div
              className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-[14px] font-bold text-white"
              style={{ background: 'var(--chat-shell-accent)' }}
            >
              BAT
            </div>
            <h4 className="text-base font-bold tracking-tight">Intelligence Studio</h4>
            <p className="mt-1.5 max-w-sm text-[13px]" style={{ color: 'var(--chat-shell-text-muted)' }}>
              Start with one request and BAT will run the full workspace loop with evidence and actions.
            </p>

            <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[
                { q: 'Identify my top 3 competitors based on recent performance.', icon: '🔭' },
                { q: "Show me my brand's biggest engagement gap vs competitors.", icon: '⚔️' },
                { q: 'What content themes should I prioritize this week?', icon: '✨' },
                { q: 'Draft a brand voice alignment guide.', icon: '✍️' },
              ].map((card) => (
                <button
                  key={card.q}
                  onClick={() => onDraftChange(card.q)}
                  className="group relative flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5"
                  style={{
                    borderColor: 'var(--chat-shell-border)',
                    background: 'var(--chat-shell-muted)',
                  }}
                >
                  <span className="rounded-full border p-1.5 text-lg shadow-sm transition-transform group-hover:scale-110" style={{ borderColor: 'var(--chat-shell-border)', background: 'var(--chat-shell-surface)' }}>
                    {card.icon}
                  </span>
                  <span className="text-[12px] font-medium leading-snug">
                    {card.q}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {displayMessages.map((message) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                pinnedBlockIds={pinnedBlockIds}
                onBlockView={onBlockView}
                onBlockPin={onBlockPin}
                onBlockUnpin={onBlockUnpin}
                onBlockFormSubmit={onBlockFormSubmit}
                onSelectDesign={onSelectDesign}
                onAttachmentView={onAttachmentView}
                onComposerFill={onDraftChange}
                onActionIntent={onActionIntent}
                researchJobId={researchJobId}
              />
            ))}
            {isStreaming && !streamingMessage && (
              <div className="flex items-start gap-3 px-1">
                <div
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold tracking-wider text-white shadow-sm"
                  style={{ background: 'var(--chat-shell-accent)' }}
                >
                  BAT
                </div>
                <div className="flex items-center gap-1.5 pt-2.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/80 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t px-4 py-3" style={{ borderColor: 'var(--chat-shell-border)', background: 'var(--chat-shell-surface)' }}>
        <ChatComposer
          value={draft}
          onChange={onDraftChange}
          onSend={onSend}
          isStreaming={isStreaming}
          researchJobId={researchJobId}
        />
      </div>
    </section>
  );
}
