'use client';

import { Settings } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface CompactChatTopbarProps {
  sessionTitle?: string | null;
  sessionUpdatedAt?: string | null;
  messageCount: number;
  pinnedCount: number;
  connectionStatus: string;
  isStreaming: boolean;
  onOpenCrud: () => void;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function CompactChatTopbar({
  sessionTitle,
  sessionUpdatedAt,
  messageCount,
  pinnedCount,
  connectionStatus,
  isStreaming,
  onOpenCrud,
}: CompactChatTopbarProps) {
  const connectionBadgeVariant: BadgeProps['variant'] =
    connectionStatus === 'open'
      ? 'success'
      : connectionStatus === 'reconnecting' || connectionStatus === 'connecting'
        ? 'warning'
        : connectionStatus === 'error'
          ? 'destructive'
          : 'outline';

  const relativeTime = sessionUpdatedAt ? formatRelativeTime(sessionUpdatedAt) : null;

  return (
    <div
      className="z-10 flex h-12 flex-shrink-0 items-center gap-3 border-b px-4"
      style={{ borderColor: 'var(--chat-shell-border)' }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-bold text-white"
          style={{ background: 'var(--chat-shell-accent)' }}
        >
          BAT
        </div>
        <span className="hidden text-sm font-semibold tracking-tight sm:block">Intelligence Studio</span>
      </div>

      <div className="h-4 w-px" style={{ background: 'color-mix(in srgb, var(--chat-shell-border) 80%, transparent)' }} />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className="hidden text-[9px] font-medium uppercase tracking-[0.12em] md:block"
          style={{ color: 'var(--chat-shell-text-muted)' }}
        >
          Thread
        </span>
        <h2 className="truncate text-[13px] font-medium">{sessionTitle || 'Untitled session'}</h2>
        {relativeTime ? (
          <span className="hidden text-[10px] lg:block" style={{ color: 'var(--chat-shell-text-muted)' }}>
            · {relativeTime}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {isStreaming ? <span className="bat-chip hidden sm:inline-flex">Running</span> : null}
        <Badge variant={connectionBadgeVariant} className="text-[10px] uppercase">
          {connectionStatus === 'open' ? 'live' : connectionStatus || 'offline'}
        </Badge>
        <span className="bat-chip hidden sm:inline-flex">{messageCount} msgs</span>
        {pinnedCount > 0 ? <span className="bat-chip hidden md:inline-flex">{pinnedCount} pinned</span> : null}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: 'var(--chat-shell-text-muted)' }}
          onClick={onOpenCrud}
          title="Open Intelligence CRUD Control Deck"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
