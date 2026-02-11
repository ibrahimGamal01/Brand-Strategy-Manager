'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Radio, RefreshCw } from 'lucide-react';
import { ResearchJobEvent } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';
type FeedFilter = 'all' | 'scraper' | 'downloader' | 'continuity' | 'errors';

interface LiveActivityFeedProps {
  events: ResearchJobEvent[];
  connectionState: ConnectionState;
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

export function LiveActivityFeed({ events, connectionState }: LiveActivityFeedProps) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filter === 'all') return true;
      if (filter === 'scraper') return event.source === 'scraper' || event.code.startsWith('scrape.');
      if (filter === 'downloader') return event.source === 'downloader' || event.code.startsWith('download.');
      if (filter === 'continuity') return event.source === 'continuity' || event.code.startsWith('continuity.');
      if (filter === 'errors') return event.level === 'error' || event.code.endsWith('.failed');
      return true;
    });
  }, [events, filter]);

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

  useEffect(() => {
    if (!autoScroll || !feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [autoScroll, groupedEvents]);

  function onScrollFeed() {
    if (!feedRef.current) return;
    const distanceFromBottom =
      feedRef.current.scrollHeight - feedRef.current.scrollTop - feedRef.current.clientHeight;
    setAutoScroll(distanceFromBottom < 100);
  }

  return (
    <div className="container mx-auto px-6 pt-6">
      <section className="rounded-xl border bg-card/40">
        <header className="border-b px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Live Activity Feed
              </h3>
              <p className="text-xs text-muted-foreground">
                Continuity, scraper, and downloader events in real time.
              </p>
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
          </div>

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

        <div ref={feedRef} onScroll={onScrollFeed} className="max-h-[380px] overflow-y-auto px-4 py-3">
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
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatClock(event.createdAt)}
                            </span>
                          </div>

                          <div className="mt-1 text-xs text-muted-foreground">
                            {event.code}
                            {event.platform ? ` • ${event.platform}` : ''}
                            {event.handle ? ` @${event.handle}` : ''}
                          </div>

                          {metricsText && <div className="mt-1 text-xs text-muted-foreground">{metricsText}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!autoScroll && (
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
        )}
      </section>
    </div>
  );
}
