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
    <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border/40 bg-card/60 px-4 backdrop-blur-md z-10">
      {/* Brand mark */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-[9px] font-bold text-primary-foreground shadow-sm">
          BAT
        </div>
        <span className="text-sm font-semibold tracking-tight hidden sm:block">Intelligence Studio</span>
      </div>

      <div className="h-4 w-px bg-border/50 flex-shrink-0" />

      {/* Session title — takes remaining space */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-widest font-medium text-primary flex-shrink-0 hidden md:block">
          Thread
        </span>
        <h2 className="text-[13px] font-medium truncate text-foreground">
          {sessionTitle || 'Untitled session'}
        </h2>
        {relativeTime && (
          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 hidden lg:block">
            · {relativeTime}
          </span>
        )}
      </div>

      {/* Right: status indicators + CRUD toggle */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isStreaming && (
          <Badge variant="warning" className="text-[10px] uppercase animate-pulse hidden sm:flex">
            thinking
          </Badge>
        )}
        <Badge variant={connectionBadgeVariant} className="text-[10px] uppercase">
          {connectionStatus === 'open' ? 'live' : connectionStatus || 'offline'}
        </Badge>
        <span className="text-[11px] text-muted-foreground tabular-nums hidden sm:block">
          {messageCount} msgs
        </span>
        {pinnedCount > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums hidden md:block">
            {pinnedCount} pinned
          </span>
        )}
        <div className="h-4 w-px bg-border/50" />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onOpenCrud}
          title="Open Intelligence CRUD Control Deck"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
