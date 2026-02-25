import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MessageSquarePlus } from 'lucide-react';
import type { ChatMessage, ChatSession } from './types';

type ChatSessionListItem = ChatSession & { lastMessage?: ChatMessage | null };

interface ChatSessionListProps {
  sessions: ChatSessionListItem[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  isLoading?: boolean;
}

function formatRelativeTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
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
      <div className="flex-shrink-0 px-3 pb-2 pt-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--chat-shell-text-muted)' }}>
              Session Memory
            </p>
            <h3 className="text-sm font-semibold leading-tight">Chat Sessions</h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onNewSession}
            className="h-7 gap-1 px-2 text-[11px]"
            title="New session"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> New
          </Button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter sessions..."
          aria-label="Filter sessions"
          className="h-8 w-full rounded-xl border px-2.5 text-[11px] outline-none transition-colors focus:bg-white/60"
          style={{
            borderColor: 'var(--chat-shell-border)',
            background: 'var(--chat-shell-muted)',
            color: 'var(--chat-shell-text)',
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-0.5">
        {isLoading ? (
          <p className="py-4 text-center text-[11px]" style={{ color: 'var(--chat-shell-text-muted)' }}>
            Loading sessions...
          </p>
        ) : filteredSessions.length === 0 ? (
          <div
            className="mx-1 rounded-xl border border-dashed p-4 text-center text-[11px]"
            style={{
              borderColor: 'var(--chat-shell-border)',
              background: 'var(--chat-shell-muted)',
              color: 'var(--chat-shell-text-muted)',
            }}
          >
            {query ? 'No sessions match.' : 'No chats yet. Start one!'}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const active = session.id === activeSessionId;
            const lastMessage = session.lastMessage?.content?.slice(0, 55) || 'No messages yet';
            const relTime = formatRelativeTime(session.lastActiveAt || session.createdAt);
            return (
              <button
                key={session.id}
                onClick={() => onSelect(session.id)}
                className={`group relative flex w-full flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-left text-xs transition-all ${
                  active
                    ? 'bg-[#d6f2ef]/70 text-[#0f766e] dark:bg-[#1d4b46]'
                    : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {active && (
                  <div
                    className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full"
                    style={{ background: 'var(--chat-shell-accent)' }}
                  />
                )}
                <div className="flex w-full items-center justify-between gap-1.5">
                  <span
                    className={`font-medium line-clamp-1 text-[12px] ${
                      active ? 'text-current' : 'group-hover:text-current'
                    }`}
                  >
                    {session.title || 'Untitled session'}
                  </span>
                  {relTime && (
                    <span className="shrink-0 whitespace-nowrap text-[9px] font-medium" style={{ color: 'var(--chat-shell-text-muted)' }}>
                      {relTime}
                    </span>
                  )}
                </div>
                <p
                  className={`line-clamp-1 text-[10px] leading-relaxed w-full ${
                    active ? 'opacity-80' : 'opacity-70'
                  }`}
                >
                  {lastMessage}
                </p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
