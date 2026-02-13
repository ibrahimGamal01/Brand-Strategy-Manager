'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { ResearchJobEvent } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';
type FeedFilter = 'all' | 'scraper' | 'downloader' | 'continuity' | 'errors';

interface LiveActivityFeedProps {
  events: ResearchJobEvent[];
  connectionState: ConnectionState;
  mode?: 'panel' | 'rail';
}

const FILTER_OPTIONS: Array<{ key: FeedFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'scraper', label: 'Scraper' },
  { key: 'downloader', label: 'Downloader' },
  { key: 'continuity', label: 'Continuity' },
  { key: 'errors', label: 'Errors' },
];

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function timeAgo(value: string) {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return value;
  const diff = Date.now() - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function summarizeMetrics(metrics: Record<string, unknown> | null): string | null {
  if (!metrics) return null;
  const entries = Object.entries(metrics).slice(0, 4);
  if (!entries.length) return null;
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' | ');
}

function getConnectionBadge(connectionState: ConnectionState) {
  if (connectionState === 'connected') {
    return (
      <Badge variant="success" className="gap-1">
        <Radio className="h-3 w-3" />
        Live
      </Badge>
    );
  }

  if (connectionState === 'connecting') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Connecting
      </Badge>
    );
  }

  return (
    <Badge variant="warning" className="gap-1">
      <RefreshCw className="h-3 w-3" />
      Polling
    </Badge>
  );
}

export function LiveActivityFeed({ events, connectionState, mode = 'panel' }: LiveActivityFeedProps) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [readIds, setReadIds] = useState<Set<number>>(() => new Set());
  const feedRef = useRef<HTMLDivElement | null>(null);

  const filteredEvents = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      if (filter === 'scraper' && !(event.source === 'scraper' || event.code.startsWith('scrape.'))) return false;
      if (filter === 'downloader' && !(event.source === 'downloader' || event.code.startsWith('download.'))) return false;
      if (filter === 'continuity' && !(event.source === 'continuity' || event.code.startsWith('continuity.'))) return false;
      if (filter === 'errors' && !(event.level === 'error' || event.code.endsWith('.failed'))) return false;
      if (!loweredQuery) return true;

      return [event.message, event.code, event.platform || '', event.handle || '']
        .join(' ')
        .toLowerCase()
        .includes(loweredQuery);
    });
  }, [events, filter, query]);

  const groupedEvents = useMemo(() => {
    const groups: Array<{ runId: string | null; key: string; events: ResearchJobEvent[] }> = [];
    const groupIndex = new Map<string, number>();

    for (const event of filteredEvents) {
      const key = event.runId || 'unscoped';
      if (!groupIndex.has(key)) {
        groupIndex.set(key, groups.length);
        groups.push({ runId: event.runId, key, events: [event] });
      } else {
        groups[groupIndex.get(key) as number].events.push(event);
      }
    }

    return groups;
  }, [filteredEvents]);

  const counters = useMemo(() => {
    const recent = events.slice(-400);
    return {
      profilesScraped: recent.filter((event) => event.code === 'scrape.saved').length,
      competitorScrapes: recent.filter((event) => event.code === 'competitor.scrape.completed').length,
      mediaSaved: recent.filter((event) => event.code === 'download.file.saved').length,
      failures: recent.filter((event) => event.level === 'error' || event.code.endsWith('.failed')).length,
    };
  }, [events]);

  const unreadCount = useMemo(
    () => filteredEvents.filter((event) => !readIds.has(event.id)).length,
    [filteredEvents, readIds]
  );

  useEffect(() => {
    if (!autoScroll || !feedRef.current || mode === 'rail') return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [autoScroll, groupedEvents, mode]);

  function onScrollFeed() {
    if (!feedRef.current) return;
    const distanceFromBottom =
      feedRef.current.scrollHeight - feedRef.current.scrollTop - feedRef.current.clientHeight;
    setAutoScroll(distanceFromBottom < 100);
  }

  function toggleRead(eventId: number) {
    setReadIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  function clearRead() {
    setReadIds(new Set(filteredEvents.map((event) => event.id)));
  }

  if (mode === 'rail') {
    const railEvents = [...filteredEvents].reverse().slice(0, 120);

    return (
      <section className="sticky top-4 rounded-xl border border-border/70 bg-card/60 backdrop-blur-sm">
        <header className="space-y-3 border-b border-border/70 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold">Notifications</h3>
              <p className="text-xs text-muted-foreground">Automation alerts you can act on.</p>
            </div>
            <div className="space-y-1 text-right">
              {getConnectionBadge(connectionState)}
              <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
            </div>
          </div>

          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search alerts..."
              className="h-8 w-full rounded-md border border-border bg-background/70 pl-8 pr-2 text-xs outline-none transition-colors focus:border-primary/40"
            />
          </label>

          <div className="flex items-center justify-between gap-2">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as FeedFilter)}
              className="h-8 rounded-md border border-border bg-background/70 px-2 text-xs outline-none"
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>

            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={clearRead}>
              Clear read
            </Button>
          </div>
        </header>

        <div className="max-h-[75vh] space-y-2 overflow-y-auto p-3 custom-scrollbar">
          {railEvents.length === 0 ? (
            <p className="rounded-md border border-border/50 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              No alerts found for this filter.
            </p>
          ) : (
            railEvents.map((event) => {
              const isError = event.level === 'error' || event.code.endsWith('.failed');
              const read = readIds.has(event.id);
              const metricsText = summarizeMetrics(event.metrics);
              return (
                <article
                  key={event.id}
                  className={`rounded-lg border p-3 text-xs transition-colors ${
                    isError
                      ? 'border-destructive/35 bg-destructive/10'
                      : read
                        ? 'border-border/50 bg-background/50'
                        : 'border-primary/25 bg-primary/5'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="line-clamp-1 font-medium">{event.message}</p>
                    <div className="flex items-center gap-1">
                      <Badge variant={read ? 'secondary' : 'outline'} className="h-5 px-1.5 text-[10px]">
                        {read ? 'Read' : 'Unread'}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => toggleRead(event.id)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                        aria-label={read ? 'Mark as unread' : 'Mark as read'}
                      >
                        {read ? <Circle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <p className="text-muted-foreground">
                    {timeAgo(event.createdAt)} {event.platform ? `• ${event.platform}` : ''}
                    {event.handle ? ` • @${event.handle}` : ''}
                  </p>
                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground/90">{event.code}</p>
                  {metricsText ? <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/90">{metricsText}</p> : null}
                </article>
              );
            })
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card/40">
      <header className="border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Live Activity Feed</h3>
            <p className="text-xs text-muted-foreground">Continuity, scraper, and downloader events in real time.</p>
          </div>
          {getConnectionBadge(connectionState)}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {FILTER_OPTIONS.map((option) => (
            <Button
              key={option.key}
              size="sm"
              variant={filter === option.key ? 'default' : 'outline'}
              onClick={() => setFilter(option.key)}
              className="h-7 text-xs"
            >
              {option.label}
            </Button>
          ))}
          {query ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setQuery('')}
              className="h-7 text-xs text-muted-foreground"
            >
              <X className="h-3 w-3" />
              Clear Search
            </Button>
          ) : null}
        </div>

        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events..."
            className="h-8 w-full rounded-md border border-border bg-background/70 pl-8 pr-2 text-xs outline-none transition-colors focus:border-primary/40"
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <div className="rounded border bg-background/70 px-2 py-1">
            Profiles Scraped: <span className="font-semibold">{counters.profilesScraped}</span>
          </div>
          <div className="rounded border bg-background/70 px-2 py-1">
            Competitor Scrapes: <span className="font-semibold">{counters.competitorScrapes}</span>
          </div>
          <div className="rounded border bg-background/70 px-2 py-1">
            Media Saved: <span className="font-semibold">{counters.mediaSaved}</span>
          </div>
          <div className="rounded border bg-background/70 px-2 py-1">
            Failures: <span className="font-semibold">{counters.failures}</span>
          </div>
        </div>
      </header>

      <div ref={feedRef} onScroll={onScrollFeed} className="max-h-[420px] overflow-y-auto px-4 py-3 custom-scrollbar">
        {groupedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <div className="space-y-4">
            {groupedEvents.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold">Run:</span>
                  <span className="font-mono">{group.runId || 'unscoped'}</span>
                </div>

                <div className="space-y-2">
                  {group.events.map((event) => {
                    const isError = event.level === 'error' || event.code.endsWith('.failed');
                    const isWarn = event.level === 'warn';
                    const metricsText = summarizeMetrics(event.metrics);
                    return (
                      <div
                        key={event.id}
                        className={`rounded-md border px-3 py-2 text-sm ${
                          isError
                            ? 'border-destructive/40 bg-destructive/5'
                            : isWarn
                              ? 'border-amber-500/40 bg-amber-500/5'
                              : 'border-border bg-background/60'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {isError ? (
                              <AlertCircle className="h-4 w-4 text-destructive" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            )}
                            <span className="font-medium">{event.message}</span>
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">{formatClock(event.createdAt)}</span>
                        </div>

                        <div className="mt-1 text-xs text-muted-foreground">
                          {event.code}
                          {event.platform ? ` • ${event.platform}` : ''}
                          {event.handle ? ` @${event.handle}` : ''}
                        </div>

                        {metricsText ? <div className="mt-1 text-xs text-muted-foreground">{metricsText}</div> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!autoScroll ? (
        <div className="border-t px-4 py-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAutoScroll(true);
              if (feedRef.current) {
                feedRef.current.scrollTop = feedRef.current.scrollHeight;
              }
            }}
            className="h-7 text-xs"
          >
            Jump To Latest
          </Button>
        </div>
      ) : null}
    </section>
  );
}
