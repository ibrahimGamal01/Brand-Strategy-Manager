import { useEffect, useRef } from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
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
  onBlockFormSubmit?: (message: ChatMessage, block: ChatBlock, answer: string) => void;
  onSelectDesign: (message: ChatMessage, designId: string) => void;
  onAttachmentView?: (message: ChatMessage, attachmentId: string, meta?: Record<string, unknown>) => void;
  onActionIntent?: (action?: string, href?: string, payload?: Record<string, unknown>) => void;
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
  onBlockFormSubmit,
  onSelectDesign,
  onAttachmentView,
  onActionIntent,
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
  const realtimeBadgeVariant: BadgeProps['variant'] =
    connectionLabel === 'open'
      ? 'success'
      : connectionLabel === 'reconnecting' || connectionLabel === 'connecting'
        ? 'warning'
        : connectionLabel === 'error'
          ? 'destructive'
          : 'outline';

  return (
    <section className="flex h-full flex-col">
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ minHeight: 0 }}
      >
        {/* Session header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 bg-background/60 backdrop-blur-md px-6 py-3 flex-shrink-0 z-10">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-medium text-emerald-500">Active Thread</p>
            <h3 className="text-sm font-semibold mt-0.5">{sessionTitle || 'Untitled session'}</h3>
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
            <Badge variant={realtimeBadgeVariant} className="text-[10px] uppercase">
              {connectionLabel}
            </Badge>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={containerRef}
          className="flex-1 space-y-6 overflow-y-auto bg-[linear-gradient(180deg,rgba(16,185,129,0.01)_0%,rgba(14,165,233,0.01)_100%)] px-6 py-6 custom-scrollbar relative"
          style={{ minHeight: 0 }}
        >
          {displayMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 lg:py-16 text-center h-full max-w-2xl mx-auto px-4">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 text-[16px] font-bold text-white shadow-xl ring-2 ring-emerald-500/20 ring-offset-4 ring-offset-background">
                BAT
              </div>
              <h4 className="text-lg font-bold tracking-tight text-foreground">Intelligence Studio</h4>
              <p className="mt-2 text-sm text-muted-foreground max-w-md">
                Your AI co-pilot for brand strategy. Select a starting point below or type your own question.
              </p>

              <div className="mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { q: 'Identify my top 3 competitors based on recent performance.', icon: '🔭' },
                  { q: 'Show me my brand’s biggest engagement gap vs competitors.', icon: '⚔️' },
                  { q: 'What content themes should I prioritize this week?', icon: '✨' },
                  { q: 'Draft a brand voice alignment guide.', icon: '✍️' },
                ].map((card) => (
                  <button
                    key={card.q}
                    onClick={() => onDraftChange(card.q)}
                    className="group relative flex flex-col items-start gap-2 h-full rounded-2xl border border-border/50 bg-card/40 p-4 text-left transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:shadow-md"
                  >
                    <span className="text-xl bg-background rounded-full p-1.5 shadow-sm border border-border/40 group-hover:scale-110 transition-transform">{card.icon}</span>
                    <span className="text-[13px] font-medium leading-relaxed text-foreground/90 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">{card.q}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {displayMessages.map((message) => (
                <div key={message.id}>
                  <ChatMessageItem
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
                </div>
              ))}
              {isStreaming ? (
                <div className="flex items-start gap-4 my-2 px-2">
                  <div className="flex flex-shrink-0 flex-col items-center pt-0.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 text-[10px] font-bold tracking-wider text-white shadow-sm ring-1 ring-emerald-500/20">
                      BAT
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col justify-center pt-2">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500/60 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500/80 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" />
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border/40 bg-background/80 backdrop-blur-sm p-4">
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
