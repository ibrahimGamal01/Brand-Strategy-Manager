import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ChatMessage, ChatSession } from './types';

type ChatSessionListItem = ChatSession & { lastMessage?: ChatMessage | null };

interface ChatSessionListProps {
  sessions: ChatSessionListItem[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  isLoading?: boolean;
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatSessionList({
  sessions,
  activeSessionId,
  onSelect,
  onNewSession,
  isLoading,
}: ChatSessionListProps) {
  const [query, setQuery] = useState('');

  const filteredSessions = useMemo(() => {
    const raw = query.trim().toLowerCase();
    if (!raw) return sessions;
    return sessions.filter((session) => {
      const title = session.title || '';
      const snippet = session.lastMessage?.content || '';
      return `${title} ${snippet}`.toLowerCase().includes(raw);
    });
  }, [sessions, query]);

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Session Memory</p>
            <h3 className="text-sm font-semibold">Chat Threads</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={onNewSession} className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground">
            + New
          </Button>
        </div>
        <div className="relative">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter sessions..."
            aria-label="Filter sessions"
            className="h-8 w-full rounded-md border border-border/50 bg-background/40 px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 focus:bg-background/80 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 space-y-1">
        {isLoading ? (
          <p className="text-xs text-muted-foreground text-center py-4">Loading sessions...</p>
        ) : filteredSessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/40 bg-background/20 p-4 text-center text-xs text-muted-foreground">
            {query ? 'No sessions match.' : 'No chats yet. Start a new session.'}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const active = session.id === activeSessionId;
            const lastMessage = session.lastMessage?.content?.slice(0, 60) || 'No messages yet';
            return (
              <button
                key={session.id}
                onClick={() => onSelect(session.id)}
                className={`w-full group relative flex flex-col items-start gap-1 rounded-lg px-3 py-2.5 text-left text-xs transition-all ${active
                    ? 'bg-primary/10 text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted/40'
                  }`}
              >
                {active && (
                  <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-primary" />
                )}
                <div className="flex w-full items-center justify-between gap-2">
                  <span className={`font-medium line-clamp-1 ${active ? 'text-primary' : 'text-foreground group-hover:text-primary'}`}>
                    {session.title || 'Untitled session'}
                  </span>
                </div>
                <p className={`line-clamp-2 text-[11px] leading-relaxed ${active ? 'text-primary/70' : 'text-muted-foreground/70'}`}>
                  {lastMessage}
                </p>
                <div className="mt-1 flex w-full items-center justify-between text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40">
                  <span>{formatDate(session.lastActiveAt || session.createdAt)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
