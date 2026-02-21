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
    <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Chat Sessions</h3>
          <p className="text-xs text-muted-foreground">
            Curated threads grounded in this research workspace.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onNewSession} className="h-8 px-3 text-xs">
          New chat
        </Button>
      </div>

      <div className="mb-3 rounded-lg border border-border/60 bg-background/80 px-2 py-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter sessions..."
          aria-label="Filter sessions"
          className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading sessions...</p>
      ) : filteredSessions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
          {query ? 'No sessions match that filter.' : 'No chat sessions yet. Start a new chat to begin.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSessions.map((session) => {
            const active = session.id === activeSessionId;
            const lastMessage = session.lastMessage?.content?.slice(0, 80) || 'No messages yet.';
            return (
              <button
                key={session.id}
                onClick={() => onSelect(session.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                  active
                    ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
                    : 'border-border/50 bg-background/60 text-muted-foreground hover:bg-background'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{session.title || 'Untitled session'}</span>
                  {active ? (
                    <Badge variant="outline" className="text-[10px] uppercase">
                      active
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{lastMessage}</p>
                <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>{formatDate(session.lastActiveAt || session.createdAt)}</span>
                  <span>{formatTime(session.lastActiveAt || session.createdAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
