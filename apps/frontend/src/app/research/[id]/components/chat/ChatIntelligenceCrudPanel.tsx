'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { IntelligenceCrudAction, IntelligenceSectionKey } from './intelligence-crud';
import { INTELLIGENCE_SECTIONS, INTELLIGENCE_SECTION_BY_KEY } from './intelligence-crud';

export interface IntelligenceCrudRequest {
  section: IntelligenceSectionKey;
  action: IntelligenceCrudAction;
  itemId?: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown> | string;
  contextQuery?: string;
  quiet?: boolean;
}

interface ChatIntelligenceCrudPanelProps {
  onRunCrud: (request: IntelligenceCrudRequest) => Promise<unknown>;
  onOpenSection: (section: IntelligenceSectionKey) => void;
}

type CrudDraft = {
  primary: string;
  secondary: string;
  details: string;
  url: string;
};

type SectionFieldLabels = {
  primary: string;
  secondary: string;
  details: string;
  url: string;
};

const SECTION_LABELS: Record<IntelligenceSectionKey, SectionFieldLabels> = {
  client_profiles: {
    primary: 'Platform (instagram/tiktok)',
    secondary: 'Handle',
    details: 'Bio',
    url: 'Profile URL',
  },
  competitors: {
    primary: 'Platform',
    secondary: 'Handle',
    details: 'Discovery reason',
    url: 'Profile URL',
  },
  search_results: {
    primary: 'Query',
    secondary: 'Title',
    details: 'Snippet / body',
    url: 'Result URL',
  },
  images: {
    primary: 'Query',
    secondary: 'Title',
    details: 'Thumbnail URL (optional)',
    url: 'Image URL',
  },
  videos: {
    primary: 'Query',
    secondary: 'Title',
    details: 'Description',
    url: 'Video URL',
  },
  news: {
    primary: 'Query',
    secondary: 'Title',
    details: 'Body / excerpt',
    url: 'Article URL',
  },
  brand_mentions: {
    primary: 'Source type',
    secondary: 'Title',
    details: 'Snippet',
    url: 'Mention URL',
  },
  media_assets: {
    primary: 'Media type (IMAGE/VIDEO/AUDIO)',
    secondary: 'Source type',
    details: 'Download note',
    url: 'Original URL',
  },
  search_trends: {
    primary: 'Keyword',
    secondary: 'Region (US)',
    details: 'Related queries (comma-separated)',
    url: 'Optional source URL',
  },
  community_insights: {
    primary: 'Source',
    secondary: 'Metric',
    details: 'Insight content',
    url: 'Source URL',
  },
  ai_questions: {
    primary: 'Question type (CUSTOM)',
    secondary: 'Question',
    details: 'Answer',
    url: 'Reference URL (optional)',
  },
  web_sources: {
    primary: 'Source type (CLIENT_SITE/COMPETITOR_SITE/ARTICLE)',
    secondary: 'Discovery method (CHAT_TOOL/DDG/USER)',
    details: 'Domain (optional)',
    url: 'Source URL',
  },
  web_snapshots: {
    primary: 'Fetcher mode (AUTO/HTTP/DYNAMIC/STEALTH)',
    secondary: 'Web source id',
    details: 'Clean text snippet (optional)',
    url: 'Final URL (optional)',
  },
  web_extraction_recipes: {
    primary: 'Recipe name',
    secondary: 'Target domain (optional)',
    details: 'JSON schema',
    url: 'Created by (optional)',
  },
  web_extraction_runs: {
    primary: 'Recipe id',
    secondary: 'Snapshot id',
    details: 'JSON extracted payload',
    url: 'Confidence (0-1, optional)',
  },
};

function emptyDraft(): CrudDraft {
  return { primary: '', secondary: '', details: '', url: '' };
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toMediaType(value: string): 'IMAGE' | 'VIDEO' | 'AUDIO' {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'VIDEO') return 'VIDEO';
  if (normalized === 'AUDIO') return 'AUDIO';
  return 'IMAGE';
}

function toMediaSourceType(value: string): 'CLIENT_POST_SNAPSHOT' | 'COMPETITOR_POST_SNAPSHOT' | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'CLIENT_POST_SNAPSHOT') return 'CLIENT_POST_SNAPSHOT';
  if (normalized === 'COMPETITOR_POST_SNAPSHOT') return 'COMPETITOR_POST_SNAPSHOT';
  return null;
}

function toAiQuestionType(value: string): string {
  const normalized = value.trim().toUpperCase();
  const allowed = new Set([
    'VALUE_PROPOSITION',
    'TARGET_AUDIENCE',
    'CONTENT_PILLARS',
    'BRAND_VOICE',
    'BRAND_PERSONALITY',
    'COMPETITOR_ANALYSIS',
    'NICHE_POSITION',
    'UNIQUE_STRENGTHS',
    'CONTENT_OPPORTUNITIES',
    'GROWTH_STRATEGY',
    'PAIN_POINTS',
    'KEY_DIFFERENTIATORS',
    'CUSTOM',
    'COMPETITOR_DISCOVERY_METHOD',
  ]);
  return allowed.has(normalized) ? normalized : 'CUSTOM';
}

function buildCreatePayload(section: IntelligenceSectionKey, draft: CrudDraft): Record<string, unknown> {
  const primary = draft.primary.trim();
  const secondary = draft.secondary.trim();
  const details = draft.details.trim();
  const url = draft.url.trim();

  switch (section) {
    case 'client_profiles':
      return {
        platform: primary || 'instagram',
        handle: secondary.replace(/^@+/, '') || `manual_${Date.now()}`,
        bio: details || null,
        profileUrl: url || null,
      };
    case 'competitors':
      return {
        platform: primary || 'instagram',
        handle: secondary.replace(/^@+/, '') || `competitor_${Date.now()}`,
        discoveryReason: details || 'Added from chat control panel',
        profileUrl: url || null,
      };
    case 'search_results':
      return {
        query: primary || 'manual query',
        title: secondary || 'Manual search result',
        body: details || 'Added from chat control panel',
        href: url || `https://manual.local/search/${Date.now()}`,
        source: 'manual',
      };
    case 'images':
      return {
        query: primary || 'manual image query',
        title: secondary || 'Manual image',
        imageUrl: url || `https://picsum.photos/seed/${Date.now()}/800/800`,
        sourceUrl: url || `https://manual.local/image/${Date.now()}`,
        thumbnailUrl: details || null,
      };
    case 'videos':
      return {
        query: primary || 'manual video query',
        title: secondary || 'Manual video',
        description: details || null,
        url: url || `https://manual.local/video/${Date.now()}`,
      };
    case 'news':
      return {
        query: primary || 'manual news query',
        title: secondary || 'Manual news article',
        body: details || null,
        url: url || `https://manual.local/news/${Date.now()}`,
      };
    case 'brand_mentions':
      return {
        sourceType: primary || 'manual',
        title: secondary || 'Manual mention',
        snippet: details || null,
        url: url || `https://manual.local/mention/${Date.now()}`,
      };
    case 'media_assets':
      return {
        mediaType: toMediaType(primary),
        sourceType: toMediaSourceType(secondary),
        originalUrl: url || null,
        downloadError: details || null,
      };
    case 'search_trends':
      return {
        keyword: primary || `manual-trend-${Date.now()}`,
        region: secondary || 'US',
        relatedQueries: splitCsv(details),
        sourceUrl: url || null,
      };
    case 'community_insights':
      return {
        source: primary || 'manual',
        metric: secondary || null,
        content: details || 'Manual community insight entry',
        url: url || `https://manual.local/community/${Date.now()}`,
      };
    case 'ai_questions':
      return {
        questionType: toAiQuestionType(primary || 'CUSTOM'),
        question: secondary || 'Manual strategic question',
        answer: details || null,
        contextUsed: url || null,
      };
    case 'web_sources':
      return {
        sourceType: primary || 'OTHER',
        discoveredBy: secondary || 'CHAT_TOOL',
        domain: details || null,
        url: url || `https://manual.local/web-source/${Date.now()}`,
      };
    case 'web_snapshots':
      return {
        fetcherUsed: primary || 'AUTO',
        webSourceId: secondary || null,
        cleanText: details || null,
        finalUrl: url || null,
      };
    case 'web_extraction_recipes': {
      let schema: Record<string, unknown> = { fields: { summary: { selector: 'title' } } };
      if (details) {
        try {
          const parsed = JSON.parse(details);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            schema = parsed as Record<string, unknown>;
          }
        } catch {
          schema = { fields: { summary: { selector: details } } };
        }
      }
      return {
        name: primary || `recipe-${Date.now()}`,
        targetDomain: secondary || null,
        schema,
        createdBy: url || 'chat-crud-panel',
      };
    }
    case 'web_extraction_runs': {
      let extracted: Record<string, unknown> = { note: details || 'Manual extraction output' };
      if (details) {
        try {
          const parsed = JSON.parse(details);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            extracted = parsed as Record<string, unknown>;
          }
        } catch {
          extracted = { note: details };
        }
      }
      return {
        recipeId: primary || null,
        snapshotId: secondary || null,
        extracted,
        confidence: url && Number.isFinite(Number(url)) ? Number(url) : null,
      };
    }
    default:
      return {};
  }
}

function buildUpdatePayload(section: IntelligenceSectionKey, draft: CrudDraft): Record<string, unknown> {
  const payload = buildCreatePayload(section, draft);
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value === null) return false;
      if (typeof value === 'string' && value.trim().length === 0) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    })
  );
}

function summarizeRow(row: Record<string, unknown>): string {
  const pieces = [
    row.title,
    row.question,
    row.handle,
    row.keyword,
    row.source,
    row.platform,
    row.url,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!pieces.length) return 'No preview fields available';
  return pieces.slice(0, 3).join(' · ');
}

export function ChatIntelligenceCrudPanel({ onRunCrud, onOpenSection }: ChatIntelligenceCrudPanelProps) {
  const [section, setSection] = useState<IntelligenceSectionKey>('search_results');
  const [action, setAction] = useState<IntelligenceCrudAction>('read');
  const [draft, setDraft] = useState<CrudDraft>(emptyDraft());
  const [itemId, setItemId] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [statusText, setStatusText] = useState('Ready');
  const [running, setRunning] = useState(false);

  const labels = SECTION_LABELS[section];
  const sectionConfig = INTELLIGENCE_SECTION_BY_KEY[section];
  const actionRequiresPayload = action === 'create' || action === 'update';
  const actionSupportsItem = action === 'update' || action === 'delete';

  const sortedRows = useMemo(() => rows.slice(0, 20), [rows]);

  async function runAction() {
    if (running) return;
    setRunning(true);
    try {
      const payload =
        action === 'create'
          ? buildCreatePayload(section, draft)
          : action === 'update'
            ? buildUpdatePayload(section, draft)
            : undefined;
      const targetHint = [draft.primary, draft.secondary, draft.url, draft.details]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(' ');

      const response = await onRunCrud({
        section,
        action,
        itemId: actionSupportsItem ? itemId.trim() || undefined : undefined,
        data: payload,
        target: actionSupportsItem ? targetHint || undefined : undefined,
        contextQuery: targetHint || undefined,
      });

      if (action === 'read') {
        const dataRows = Array.isArray((response as any)?.data)
          ? ((response as any).data as Array<Record<string, unknown>>)
          : Array.isArray(response)
            ? (response as Array<Record<string, unknown>>)
            : [];
        setRows(dataRows);
        setStatusText(`Loaded ${dataRows.length} row(s).`);
      } else {
        const refreshed = await onRunCrud({ section, action: 'read', quiet: true });
        const refreshedRows = Array.isArray((refreshed as any)?.data)
          ? ((refreshed as any).data as Array<Record<string, unknown>>)
          : [];
        setRows(refreshedRows);
        setStatusText(`${action.toUpperCase()} completed. Refreshed ${refreshedRows.length} row(s).`);
      }
    } catch (error: any) {
      setStatusText(error?.message || 'Operation failed');
    } finally {
      setRunning(false);
    }
  }

  function selectRow(row: Record<string, unknown>) {
    setItemId(String(row.id || ''));
    setAction('update');
    setDraft({
      primary: String(row.platform || row.query || row.source || row.keyword || row.questionType || ''),
      secondary: String(row.handle || row.title || row.question || row.metric || row.region || ''),
      details: String(row.bio || row.discoveryReason || row.body || row.snippet || row.content || row.answer || ''),
      url: String(row.profileUrl || row.href || row.imageUrl || row.url || row.originalUrl || ''),
    });
  }

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-background to-cyan-500/10 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Intelligence Bridge</p>
          <h3 className="text-sm font-semibold">CRUD Control Deck</h3>
          <p className="text-xs text-muted-foreground">{sectionConfig.summary}</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpenSection(section)}>
          Open in Intelligence
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {INTELLIGENCE_SECTIONS.map((entry) => (
          <button
            key={entry.key}
            onClick={() => setSection(entry.key)}
            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide transition ${
              section === entry.key
                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : 'border-border/60 bg-background/70 text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {(['read', 'create', 'update', 'delete', 'clear'] as IntelligenceCrudAction[]).map((entry) => (
          <Button
            key={entry}
            size="sm"
            variant={action === entry ? 'default' : 'outline'}
            className="h-7 px-2 text-[10px] uppercase"
            onClick={() => setAction(entry)}
          >
            {entry}
          </Button>
        ))}
      </div>

      {actionSupportsItem ? (
        <div className="mb-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Item ID (optional)</p>
          <Input value={itemId} onChange={(event) => setItemId(event.target.value)} placeholder="Leave empty to auto-match from your values..." />
        </div>
      ) : null}

      {actionRequiresPayload ? (
        <div className="mb-3 grid gap-2">
          <Input
            value={draft.primary}
            onChange={(event) => setDraft((prev) => ({ ...prev, primary: event.target.value }))}
            placeholder={labels.primary}
          />
          <Input
            value={draft.secondary}
            onChange={(event) => setDraft((prev) => ({ ...prev, secondary: event.target.value }))}
            placeholder={labels.secondary}
          />
          <Input
            value={draft.url}
            onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))}
            placeholder={labels.url}
          />
          <Textarea
            value={draft.details}
            onChange={(event) => setDraft((prev) => ({ ...prev, details: event.target.value }))}
            placeholder={labels.details}
            className="min-h-[84px]"
          />
        </div>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" className="h-8" onClick={runAction} disabled={running}>
          {running ? 'Running...' : `Run ${action.toUpperCase()}`}
        </Button>
        <Badge variant="outline" className="text-[10px] uppercase">
          {statusText}
        </Badge>
      </div>

      <div className="rounded-xl border border-border/60 bg-background/70 p-2">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Section preview</p>
          <Badge variant="secondary" className="text-[10px]">
            {rows.length} rows
          </Badge>
        </div>
        {sortedRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Run READ to inspect records for this section.</p>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto custom-scrollbar pr-1">
            {sortedRows.map((row, index) => {
              const rowId = String(row.id || '');
              const selected = itemId === rowId;
              return (
                <button
                  key={rowId || `row-${index}`}
                  onClick={() => selectRow(row)}
                  className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                    selected
                      ? 'border-emerald-500/40 bg-emerald-500/15'
                      : 'border-border/50 bg-background/70 hover:border-border'
                  }`}
                >
                  <p className="font-mono text-[10px] text-muted-foreground">{rowId || 'no-id'}</p>
                  <p className="truncate text-foreground">{summarizeRow(row)}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
