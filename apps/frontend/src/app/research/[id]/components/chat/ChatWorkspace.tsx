'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api/http';
import { useToast } from '@/hooks/use-toast';
import { useChatSocket } from '@/lib/ws/useChatSocket';
import { ChatSessionList } from './ChatSessionList';
import { ChatThread } from './ChatThread';
import { SidebarContextPanel } from './SidebarContextPanel';
import { CompactChatTopbar } from './CompactChatTopbar';
import { CrudDrawer } from './CrudDrawer';
import {
  ChatIntelligenceCrudPanel,
  type IntelligenceCrudRequest,
} from './ChatIntelligenceCrudPanel';
import {
  INTELLIGENCE_SECTION_BY_KEY,
  resolveIntelligenceCrudAction,
  resolveIntelligenceSection,
  type IntelligenceCrudAction,
  type IntelligenceSectionKey,
} from './intelligence-crud';
import {
  sanitizeChatBlocks,
  sanitizeChatDesignOptions,
  sanitizeChatMessage,
  sanitizeChatMessages,
  sanitizeFollowUp,
} from './message-normalizer';
import type { ChatBlock } from './blocks/types';
import type { ChatMessage, ChatSavedBlock, ChatSession } from './types';

interface ChatSessionResponse {
  sessions: Array<ChatSession & { lastMessage?: ChatMessage | null }>;
}

interface ChatSessionDetailResponse {
  session: ChatSession;
  messages: ChatMessage[];
}

interface ChatSavedBlocksResponse {
  blocks: ChatSavedBlock[];
}

type IntelligenceRow = Record<string, unknown> & { id?: string };
type WorkspaceModuleKey =
  | 'brain'
  | 'chat'
  | 'intelligence'
  | 'strategy_docs'
  | 'content_calendar'
  | 'content_generators'
  | 'performance';

const SECTION_MATCH_FIELDS: Record<IntelligenceSectionKey, string[]> = {
  client_profiles: ['handle', 'platform', 'profileUrl', 'bio'],
  competitors: ['handle', 'platform', 'profileUrl', 'discoveryReason', 'selectionState'],
  search_results: ['title', 'href', 'query', 'source', 'body'],
  images: ['title', 'imageUrl', 'sourceUrl', 'query'],
  videos: ['title', 'url', 'query', 'publisher', 'uploader'],
  news: ['title', 'url', 'query', 'source'],
  brand_mentions: ['title', 'url', 'sourceType', 'snippet', 'fullText'],
  media_assets: ['originalUrl', 'externalMediaId', 'sourceId', 'blobStoragePath', 'downloadError'],
  search_trends: ['keyword', 'region', 'timeframe'],
  community_insights: ['source', 'url', 'metric', 'content', 'sourceQuery'],
  ai_questions: ['question', 'questionType', 'contextUsed', 'answer'],
};

const IDENTIFIER_HINT_KEYS = [
  'handle', 'platform', 'profileUrl', 'title', 'query', 'url',
  'href', 'keyword', 'question', 'source', 'metric', 'sourceType',
];

const DESTRUCTIVE_CRUD_ACTIONS = new Set<IntelligenceCrudAction>(['delete', 'clear']);
const MODULE_ALIASES: Record<string, WorkspaceModuleKey> = {
  home: 'brain',
  brain: 'brain',
  chat: 'chat',
  intelligence: 'intelligence',
  intel: 'intelligence',
  strategy: 'strategy_docs',
  strategy_docs: 'strategy_docs',
  calendar: 'content_calendar',
  content_calendar: 'content_calendar',
  content_generators: 'content_generators',
  generators: 'content_generators',
  performance: 'performance',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[@]/g, '')
    .replace(/[^a-z0-9._:/-]+/g, ' ')
    .trim();
}

function splitTerms(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
}

function scoreValueMatch(rowValue: unknown, targetValue: unknown): number {
  const row = normalizeText(rowValue);
  const target = normalizeText(targetValue);
  if (!row || !target) return 0;
  if (row === target) return 6;
  if (row.includes(target) || target.includes(row)) return 4;
  const rowTokens = new Set(splitTerms(row));
  const targetTokens = splitTerms(target);
  const overlap = targetTokens.filter((token) => rowTokens.has(token)).length;
  if (!overlap) return 0;
  return Math.min(3, overlap);
}

function extractCandidateTerms(
  target: Record<string, unknown> | null,
  contextQuery?: string,
  data?: Record<string, unknown>
): string[] {
  const terms: string[] = [];
  if (contextQuery) terms.push(contextQuery);
  if (target) {
    Object.values(target).forEach((value) => {
      if (value === null || value === undefined) return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        terms.push(String(value));
      }
    });
  }
  if (data) {
    IDENTIFIER_HINT_KEYS.forEach((key) => {
      const value = data[key];
      if (value === null || value === undefined) return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        terms.push(String(value));
      }
    });
  }
  return terms.flatMap((term) => splitTerms(term));
}

function detectCrudIntent(text: string): IntelligenceCrudAction | null {
  const raw = String(text || '').toLowerCase();
  if (!raw.trim()) return null;
  if (/\b(clear|wipe|reset)\b/.test(raw)) return 'clear';
  if (/\b(delete|remove|erase)\b/.test(raw)) return 'delete';
  if (/\b(update|edit|change|replace|set)\b/.test(raw)) return 'update';
  if (/\b(create|add|insert|new)\b/.test(raw)) return 'create';
  if (/\b(read|list|show|get|fetch)\b/.test(raw)) return 'read';
  return null;
}

function parseHrefParams(href?: string): Record<string, string> {
  if (!href) return {};
  try {
    const url = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const values: Record<string, string> = {};
    url.searchParams.forEach((value, key) => { values[key] = value; });
    return values;
  } catch {
    return {};
  }
}

function resolveModuleKey(value: unknown): WorkspaceModuleKey | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return MODULE_ALIASES[normalized] || null;
}

function normalizeScraperPlatform(value: unknown): 'INSTAGRAM' | 'TIKTOK' | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'instagram' || raw === 'ig') return 'INSTAGRAM';
  if (raw === 'tiktok' || raw === 'tt') return 'TIKTOK';
  return null;
}

export default function ChatWorkspace({ jobId }: { jobId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [draft, setDraft] = useState('');
  const [crudOpen, setCrudOpen] = useState(false);

  const activeSessionStorageKey = useMemo(() => `bat.chat.activeSession.${jobId}`, [jobId]);
  const lastUserCommandRef = useRef('');
  const autoCrudHandledRef = useRef<Set<string>>(new Set());

  // ── Queries ──────────────────────────────────────────────────────────────

  const sessionsQuery = useQuery({
    queryKey: ['chatSessions', jobId],
    queryFn: () => apiFetch<ChatSessionResponse>(`/research-jobs/${jobId}/chat/sessions`),
  });

  const sessionDetailQuery = useQuery({
    queryKey: ['chatSession', jobId, activeSessionId],
    queryFn: () =>
      apiFetch<ChatSessionDetailResponse>(`/research-jobs/${jobId}/chat/sessions/${activeSessionId}`),
    enabled: Boolean(activeSessionId),
  });

  const savedBlocksQuery = useQuery({
    queryKey: ['chatSavedBlocks', jobId, activeSessionId],
    queryFn: () =>
      apiFetch<ChatSavedBlocksResponse>(
        `/research-jobs/${jobId}/chat/sessions/${activeSessionId}/saved-blocks`
      ),
    enabled: Boolean(activeSessionId),
  });

  // ── Derived values (single source, no repeated .find/.map on same array) ─

  const sessions = sessionsQuery.data?.sessions || [];

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const pinnedBlockIds = useMemo(() => {
    const ids = new Set<string>();
    (savedBlocksQuery.data?.blocks || []).forEach((block) => ids.add(block.blockId));
    return ids;
  }, [savedBlocksQuery.data?.blocks]);

  // ── Session selection effects ─────────────────────────────────────────────

  useEffect(() => {
    if (!sessions.length) return;
    const availableIds = new Set(sessions.map((s) => s.id));
    if (activeSessionId && availableIds.has(activeSessionId)) return;

    let fromStorage: string | null = null;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(activeSessionStorageKey);
      if (stored && availableIds.has(stored)) fromStorage = stored;
    }
    const nextSessionId = fromStorage || sessions[0].id;
    if (nextSessionId && nextSessionId !== activeSessionId) setActiveSessionId(nextSessionId);
  }, [sessions, activeSessionId, activeSessionStorageKey]);

  useEffect(() => {
    if (!activeSessionId || typeof window === 'undefined') return;
    window.localStorage.setItem(activeSessionStorageKey, activeSessionId);
  }, [activeSessionId, activeSessionStorageKey]);

  useEffect(() => {
    if (sessionDetailQuery.data?.messages) {
      setMessages(sanitizeChatMessages(sessionDetailQuery.data.messages));
    }
  }, [sessionDetailQuery.data?.messages, activeSessionId]);

  useEffect(() => {
    setStreamingMessage(null);
    if (activeSessionId && !sessionDetailQuery.data?.messages) setMessages([]);
  }, [activeSessionId]);

  // ── CRUD auto-run ─────────────────────────────────────────────────────────

  async function maybeAutoRunCrudFromBlocks(messageId: string, blocks: ChatBlock[]) {
    if (autoCrudHandledRef.current.has(messageId)) return;
    const intent = detectCrudIntent(lastUserCommandRef.current);
    if (!intent) return;

    const crudButtons = blocks.flatMap((block) => {
      if (String(block.type || '').toLowerCase() !== 'action_buttons') return [];
      const record = block as unknown as { buttons?: Array<Record<string, unknown>> };
      if (!Array.isArray(record.buttons)) return [];
      return record.buttons.map((button) => ({
        action: String(button.action || ''),
        href: typeof button.href === 'string' ? button.href : undefined,
        payload: asRecord(button.payload) || undefined,
      }));
    });
    if (!crudButtons.length) return;

    const matched = crudButtons.find((button) => {
      const normalized = resolveIntelligenceCrudAction(button.action.replace(/^intel_/, ''));
      return normalized === intent;
    });
    if (!matched) return;

    // Cap ref size to prevent unbounded memory growth
    if (autoCrudHandledRef.current.size >= 100) {
      const [first] = autoCrudHandledRef.current;
      autoCrudHandledRef.current.delete(first);
    }
    autoCrudHandledRef.current.add(messageId);

    try {
      await handleActionIntent(matched.action, matched.href, matched.payload);
    } catch (error) {
      autoCrudHandledRef.current.delete(messageId);
      toast({
        title: 'Could not run chat CRUD automatically',
        description:
          error instanceof Error
            ? error.message
            : 'Please retry with a more specific handle/title/url.',
        variant: 'destructive',
      });
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const socket = useChatSocket({
    researchJobId: jobId,
    sessionId: activeSessionId,
    onEvent: (event) => {
      switch (event.type) {
        case 'AUTH_OK': {
          if (event.sessionId && event.sessionId !== activeSessionId) {
            setActiveSessionId(event.sessionId as string);
            void sessionsQuery.refetch();
          }
          break;
        }
        case 'HISTORY': {
          if (Array.isArray(event.messages)) {
            setMessages(sanitizeChatMessages(event.messages));
            setStreamingMessage(null);
          }
          break;
        }
        case 'ASSISTANT_START': {
          const msgId = typeof event.messageId === 'string' ? event.messageId : null;
          if (!msgId) break;
          setStreamingMessage(sanitizeChatMessage({
            id: msgId,
            role: 'ASSISTANT',
            content: '',
            createdAt: new Date().toISOString(),
          }));
          break;
        }
        case 'ASSISTANT_DELTA': {
          const msgId = typeof event.messageId === 'string' ? event.messageId : null;
          if (!msgId) break;
          setStreamingMessage((prev) =>
            prev && prev.id === msgId
              ? sanitizeChatMessage({ ...prev, content: `${prev.content}${event.delta || ''}` })
              : prev
          );
          break;
        }
        case 'ASSISTANT_BLOCKS': {
          const msgId = typeof event.messageId === 'string' ? event.messageId : null;
          if (!msgId) break;
          const safeBlocks = sanitizeChatBlocks(event.blocks);
          const safeDesignOptions = sanitizeChatDesignOptions(event.designOptions);
          const safeFollowUp = sanitizeFollowUp(event.followUp);
          setStreamingMessage((prev) =>
            prev && prev.id === msgId
              ? sanitizeChatMessage({
                ...prev,
                blocks: safeBlocks,
                designOptions: safeDesignOptions,
                ...(safeFollowUp.length ? { followUp: safeFollowUp } : {}),
              })
              : prev
          );
          void maybeAutoRunCrudFromBlocks(msgId, safeBlocks);
          break;
        }
        case 'ASSISTANT_DONE': {
          const doneId = typeof event.messageId === 'string' ? event.messageId : null;
          const doneFollowUp = sanitizeFollowUp(event.followUp);
          setStreamingMessage((prev) => {
            if (prev && doneId && prev.id === doneId) {
              const finalMsg = sanitizeChatMessage({ ...prev, pending: false, followUp: doneFollowUp });
              setMessages((msgs) => {
                const exists = msgs.find((m) => m.id === doneId);
                if (exists) {
                  return msgs.map((m) =>
                    m.id === doneId
                      ? sanitizeChatMessage({ ...m, followUp: doneFollowUp })
                      : m
                  );
                }
                return [...msgs.filter((m) => !m.pending || m.id !== doneId), finalMsg];
              });
            }
            return null;
          });
          void sessionDetailQuery.refetch();
          void savedBlocksQuery.refetch();
          break;
        }
        case 'ERROR': {
          toast({
            title: 'Chat error',
            description: String(event.details || event.error || 'Chat connection failed'),
            variant: 'destructive',
          });
          break;
        }
        default:
          break;
      }
    },
  });

  // ── Intelligence CRUD ─────────────────────────────────────────────────────

  async function resolveCrudItemId(
    section: IntelligenceSectionKey,
    itemId: string | undefined,
    data?: Record<string, unknown>,
    target?: Record<string, unknown> | string,
    contextQuery?: string
  ): Promise<string | null> {
    const explicit = String(itemId || '').trim();
    if (explicit) return explicit;

    const response = await apiFetch<{ data?: IntelligenceRow[] } | IntelligenceRow[]>(
      `/research-jobs/${jobId}/intelligence/${section}?limit=300`
    );
    const rowsRaw = Array.isArray(response)
      ? response
      : Array.isArray((response as { data?: unknown[] }).data)
        ? ((response as { data?: IntelligenceRow[] }).data as IntelligenceRow[])
        : [];
    const rows = rowsRaw.filter(
      (row): row is IntelligenceRow => Boolean(row && typeof row === 'object' && typeof row.id === 'string')
    );
    if (!rows.length) return null;
    if (rows.length === 1) return String(rows[0].id || '');

    const directTarget = asRecord(target);
    const dataTarget =
      asRecord(data?.target) ||
      asRecord(data?.where) ||
      asRecord(data?.match) ||
      asRecord(data?.record) ||
      asRecord(data?.item);
    const targetRecord = directTarget || dataTarget;
    const sectionFields = SECTION_MATCH_FIELDS[section] || [];
    const termHints = extractCandidateTerms(targetRecord, contextQuery, data);

    const scored = rows
      .map((row) => {
        let score = 0;
        if (targetRecord) {
          Object.entries(targetRecord).forEach(([key, value]) => {
            if (value === null || value === undefined || typeof value === 'object') return;
            const rowValue = row[key];
            const fieldWeight = sectionFields.includes(key) ? 1.6 : 1;
            score += scoreValueMatch(rowValue, value) * fieldWeight;
          });
        }
        if (termHints.length) {
          termHints.forEach((term) => {
            if (!term) return;
            const fieldsToCheck = sectionFields.length ? sectionFields : Object.keys(row);
            let matched = false;
            for (const field of fieldsToCheck) {
              const value = normalizeText(row[field]);
              if (!value) continue;
              if (value.includes(term)) { score += 1.25; matched = true; break; }
            }
            if (!matched) {
              const corpus = normalizeText(JSON.stringify(row));
              if (corpus.includes(term)) score += 0.35;
            }
          });
        }
        return { row, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    if (!best || best.score <= 0) return null;
    if (second && best.score - second.score < 0.7) return null;
    return String(best.row.id || '');
  }

  async function runIntelligenceCrud({
    section, action, itemId, data, quiet, target, contextQuery,
  }: IntelligenceCrudRequest): Promise<unknown> {
    const config = INTELLIGENCE_SECTION_BY_KEY[section];
    const basePath = `/research-jobs/${jobId}/intelligence/${section}`;
    let response: unknown = null;

    if (action === 'read') {
      response = await apiFetch(basePath);
    } else if (action === 'create') {
      response = await apiFetch(basePath, { method: 'POST', body: JSON.stringify(data || {}) });
    } else if (action === 'update') {
      const resolvedItemId = await resolveCrudItemId(section, itemId, data, target, contextQuery);
      if (!resolvedItemId) throw new Error(`Unable to identify which ${config.label} record to update.`);
      response = await apiFetch(`${basePath}/${resolvedItemId}`, { method: 'PATCH', body: JSON.stringify({ data: data || {} }) });
    } else if (action === 'delete') {
      const resolvedItemId = await resolveCrudItemId(section, itemId, data, target, contextQuery);
      if (!resolvedItemId) throw new Error(`Unable to identify which ${config.label} record to delete.`);
      response = await apiFetch(`${basePath}/${resolvedItemId}`, { method: 'DELETE' });
    } else if (action === 'clear') {
      response = await apiFetch(basePath, { method: 'DELETE' });
    }

    if (action !== 'read') {
      queryClient.invalidateQueries({ queryKey: ['researchJob', jobId] });
      queryClient.invalidateQueries({ queryKey: ['chatSessions', jobId] });
      queryClient.invalidateQueries({ queryKey: ['chatSession', jobId, activeSessionId] });
      if (!quiet) {
        toast({ title: `${config.label}: ${action}`, description: `Successfully ran ${action.toUpperCase()} on ${config.label}.` });
      }
    }
    return response;
  }

  async function listCompetitorRows(): Promise<IntelligenceRow[]> {
    const response = await apiFetch<{ data?: IntelligenceRow[] } | IntelligenceRow[]>(
      `/research-jobs/${jobId}/intelligence/competitors?limit=300`
    );
    if (Array.isArray(response)) return response;
    if (Array.isArray((response as { data?: IntelligenceRow[] }).data)) {
      return ((response as { data?: IntelligenceRow[] }).data || []) as IntelligenceRow[];
    }
    return [];
  }

  async function resolveScraperTarget(
    itemId: string | undefined,
    competitorId: string | undefined,
    platformHint: 'INSTAGRAM' | 'TIKTOK' | null,
    target: Record<string, unknown> | string | undefined,
    contextQuery?: string
  ): Promise<{ discoveredId: string; platform: 'INSTAGRAM' | 'TIKTOK'; handle: string } | null> {
    const rows = await listCompetitorRows();
    if (!rows.length) return null;

    const byDiscoveredId = String(itemId || '').trim();
    if (byDiscoveredId) {
      const found = rows.find((row) => String(row.id || '') === byDiscoveredId);
      if (found) {
        return {
          discoveredId: byDiscoveredId,
          platform: normalizeScraperPlatform(found.platform) || platformHint || 'INSTAGRAM',
          handle: String(found.handle || ''),
        };
      }
    }

    const byCompetitorId = String(competitorId || '').trim();
    if (byCompetitorId) {
      const found = rows.find((row) => String(row.competitorId || '') === byCompetitorId);
      if (found && typeof found.id === 'string') {
        return {
          discoveredId: found.id,
          platform: normalizeScraperPlatform(found.platform) || platformHint || 'INSTAGRAM',
          handle: String(found.handle || ''),
        };
      }
    }

    const data = asRecord(target) || undefined;
    const resolvedItemId = await resolveCrudItemId(
      'competitors',
      undefined,
      data,
      typeof target === 'string' || asRecord(target) ? (target as Record<string, unknown> | string) : undefined,
      contextQuery
    );
    if (!resolvedItemId) return null;
    const found = rows.find((row) => String(row.id || '') === resolvedItemId);
    return {
      discoveredId: resolvedItemId,
      platform: normalizeScraperPlatform(found?.platform) || platformHint || 'INSTAGRAM',
      handle: String(found?.handle || ''),
    };
  }

  function openIntelligenceSection(sectionKey?: IntelligenceSectionKey) {
    const nextParams = new URLSearchParams(searchParamsString);
    nextParams.set('module', 'intelligence');
    if (sectionKey) nextParams.set('intelSection', sectionKey);
    router.push(`${pathname}?${nextParams.toString()}`);
  }

  async function handleActionIntent(action?: string, href?: string, payload?: Record<string, unknown>) {
    const normalizedAction = String(action || '').toLowerCase();

    if (normalizedAction === 'open_module') {
      const hrefParams = parseHrefParams(href);
      const moduleKey = resolveModuleKey(
        payload?.module || payload?.moduleKey || hrefParams.module || hrefParams.moduleKey
      );
      const section = resolveIntelligenceSection(
        payload?.section || payload?.sectionKey || hrefParams.intelSection || hrefParams.section
      );

      if (href && href.startsWith('http')) {
        window.open(href, '_blank');
        return;
      }

      const nextParams = new URLSearchParams(searchParamsString);
      nextParams.set('module', moduleKey || 'intelligence');
      if (section && (moduleKey || 'intelligence') === 'intelligence') {
        nextParams.set('intelSection', section);
      } else {
        nextParams.delete('intelSection');
      }
      router.push(`${pathname}?${nextParams.toString()}`);
      return;
    }

    if (normalizedAction === 'run_intel' || normalizedAction === 'run_orchestrator' || normalizedAction === 'run_intelligence') {
      const target = href || `/api/research-jobs/${jobId}/brand-intelligence/orchestrate`;
      await apiFetch(target.replace('/api', ''), { method: 'POST' }).catch(() => {});
      toast({ title: 'Intelligence run started', description: 'Queued orchestration for brand mentions and community insights.' });
      return;
    }

    if (normalizedAction === 'run_orchestration') {
      await apiFetch(`/research-jobs/${jobId}/orchestration/run`, { method: 'POST' });
      toast({
        title: 'Full orchestration started',
        description: 'Running cross-module orchestration cycle for this workspace.',
      });
      return;
    }

    if (normalizedAction === 'run_scraper') {
      const hrefParams = parseHrefParams(href);
      const itemId =
        (typeof payload?.itemId === 'string' && payload.itemId) ||
        (typeof payload?.discoveredId === 'string' && payload.discoveredId) ||
        (typeof payload?.id === 'string' && payload.id) ||
        hrefParams.itemId ||
        hrefParams.discoveredId ||
        hrefParams.id ||
        undefined;
      const competitorId =
        (typeof payload?.competitorId === 'string' && payload.competitorId) || hrefParams.competitorId || undefined;
      const targetCandidate = payload?.target || payload?.where || payload?.match || payload?.record || payload?.item;
      const platform = normalizeScraperPlatform(payload?.platform || hrefParams.platform);
      const lastUserText =
        [...messages].reverse().find((m) => m.role === 'USER' && String(m.content || '').trim())?.content ||
        lastUserCommandRef.current;
      const resolved = await resolveScraperTarget(
        itemId,
        competitorId,
        platform,
        typeof targetCandidate === 'string' || asRecord(targetCandidate)
          ? (targetCandidate as Record<string, unknown> | string)
          : undefined,
        lastUserText
      );
      if (!resolved?.discoveredId) {
        toast({
          title: 'Could not resolve competitor to scrape',
          description: 'Please include the exact competitor handle (and platform) in your request.',
          variant: 'destructive',
        });
        openIntelligenceSection('competitors');
        return;
      }

      await apiFetch(`/competitors/discovered/${resolved.discoveredId}/scrape`, {
        method: 'POST',
        body: JSON.stringify({ forceUnavailable: Boolean(payload?.forceUnavailable) }),
      });
      toast({
        title: 'Scraper started',
        description: `Queued scrape for @${resolved.handle || 'competitor'} on ${resolved.platform}.`,
      });
      openIntelligenceSection('competitors');
      return;
    }

    if (normalizedAction === 'user_context_upsert') {
      const category = String(payload?.category || '').trim();
      const value = String(payload?.value || '').trim();
      if (!category || !value) {
        toast({
          title: 'Missing context payload',
          description: 'user_context_upsert requires category and value.',
          variant: 'destructive',
        });
        return;
      }
      await apiFetch(`/research-jobs/${jobId}/chat/user-context`, {
        method: 'POST',
        body: JSON.stringify({
          category,
          key: typeof payload?.key === 'string' ? payload.key : null,
          value,
          label: typeof payload?.label === 'string' ? payload.label : null,
          sourceMessage: lastUserCommandRef.current || undefined,
        }),
      });
      toast({
        title: 'Context saved',
        description: 'Added to persistent chat memory for this workspace.',
      });
      return;
    }

    if (normalizedAction === 'user_context_delete') {
      const contextId =
        (typeof payload?.contextId === 'string' && payload.contextId) ||
        (typeof payload?.id === 'string' && payload.id) ||
        '';
      if (!contextId) {
        toast({
          title: 'Missing context id',
          description: 'user_context_delete requires payload.contextId',
          variant: 'destructive',
        });
        return;
      }
      if (typeof window !== 'undefined' && !window.confirm('Remove this saved chat context item?')) {
        return;
      }
      await apiFetch(`/research-jobs/${jobId}/chat/user-context/${contextId}`, { method: 'DELETE' });
      toast({
        title: 'Context removed',
        description: 'The memory item was removed from this workspace.',
      });
      return;
    }

    if (normalizedAction === 'document_generate') {
      const template = String(payload?.template || payload?.docType || 'strategy_export').trim().toLowerCase();
      const format = String(payload?.format || 'pdf').trim().toLowerCase();
      if (format !== 'pdf') {
        toast({
          title: 'Unsupported document format',
          description: 'Only PDF generation is currently supported.',
          variant: 'destructive',
        });
        return;
      }
      if (template !== 'strategy_export') {
        toast({
          title: 'Template queued for next phase',
          description: `Template "${template}" is not wired yet. Running strategy export for now.`,
        });
      }
      const filename = `strategy-${jobId}-${new Date().toISOString().slice(0, 10)}.pdf`;
      const pdfResponse = await fetch(`/api/strategy/${jobId}/export`);
      if (!pdfResponse.ok) {
        throw new Error('Failed to generate strategy PDF');
      }
      const blob = await pdfResponse.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast({
        title: 'PDF generated',
        description: `Downloaded ${filename}.`,
      });
      return;
    }

    if (normalizedAction.startsWith('intel_')) {
      const hrefParams = parseHrefParams(href);
      const section = resolveIntelligenceSection(
        payload?.section || payload?.sectionKey || hrefParams.section || hrefParams.sectionKey
      );
      const actionFromButton = normalizedAction === 'intel_crud' ? null : resolveIntelligenceCrudAction(normalizedAction.replace('intel_', ''));
      const resolvedAction = actionFromButton || resolveIntelligenceCrudAction(payload?.operation || payload?.action || hrefParams.operation || hrefParams.action);
      if (!section || !resolvedAction) {
        toast({ title: 'Invalid CRUD action', description: 'The assistant action is missing a valid section or operation.', variant: 'destructive' });
        return;
      }
      const itemId = (typeof payload?.itemId === 'string' && payload.itemId) || (typeof payload?.id === 'string' && payload.id) || hrefParams.itemId || hrefParams.id || undefined;
      const targetCandidate = payload?.target || payload?.where || payload?.match || payload?.record || payload?.item || hrefParams.target || hrefParams.lookup || undefined;
      const fallbackPayloadData = payload && typeof payload === 'object'
        ? Object.fromEntries(Object.entries(payload).filter(([key]) => !['section', 'sectionKey', 'operation', 'action', 'itemId', 'id', 'target', 'where', 'match', 'record', 'item', 'href', 'label', 'intent', 'method', 'data'].includes(key)))
        : {};
      const body = payload && typeof payload.data === 'object' && payload.data !== null ? (payload.data as Record<string, unknown>) : (fallbackPayloadData as Record<string, unknown>);
      const lastUserText = [...messages].reverse().find((m) => m.role === 'USER' && String(m.content || '').trim())?.content || lastUserCommandRef.current;
      if (DESTRUCTIVE_CRUD_ACTIONS.has(resolvedAction)) {
        const shouldProceed =
          typeof window === 'undefined' ||
          window.confirm(
            `Confirm ${resolvedAction.toUpperCase()} on ${section.replace(/_/g, ' ')}${
              itemId ? ` (id: ${itemId})` : ''
            }?`
          );
        if (!shouldProceed) return;
      }
      await runIntelligenceCrud({ section, action: resolvedAction, itemId, data: body, target: typeof targetCandidate === 'string' || asRecord(targetCandidate) ? (targetCandidate as Record<string, unknown> | string) : undefined, contextQuery: lastUserText });
      if (resolvedAction !== 'read') openIntelligenceSection(section);
      return;
    }

    if (href) window.open(href, href.startsWith('http') ? '_blank' : '_self');
  }

  async function handleNewSession(): Promise<string | null> {
    try {
      const response = await apiFetch<{ session: ChatSession }>(`/research-jobs/${jobId}/chat/sessions`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (response?.session?.id) {
        setActiveSessionId(response.session.id);
        await sessionsQuery.refetch();
        return response.session.id;
      }
      return null;
    } catch (error: unknown) {
      toast({ title: 'Failed to create session', description: error instanceof Error ? error.message : 'Unable to start a new chat session', variant: 'destructive' });
      return null;
    }
  }

  async function submitMessage(rawContent: string, attachmentIds: string[] = []) {
    const trimmed = rawContent.trim();
    if (!trimmed && attachmentIds.length === 0) return;
    if (trimmed) lastUserCommandRef.current = trimmed;

    let sessionId = activeSessionId;
    if (!sessionId) sessionId = await handleNewSession();
    if (!sessionId) return;

    const clientMessageId = `client-${Date.now()}`;
    const newMessage = sanitizeChatMessage({
      id: clientMessageId,
      role: 'USER',
      content: trimmed,
      createdAt: new Date().toISOString(),
      pending: true,
      attachments: attachmentIds.map((id) => ({ id, storagePath: '', mimeType: '', aiSummary: 'Uploading…' })),
    });

    // ✅ Fix: no O(n) re-sanitization of existing messages on every send
    setMessages((prev) => [...prev, newMessage]);

    if (socket.status === 'open') {
      socket.sendUserMessage(trimmed, clientMessageId, attachmentIds);
    } else {
      await apiFetch(`/research-jobs/${jobId}/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: trimmed, attachments: attachmentIds }),
      });
      void sessionDetailQuery.refetch();
    }
    setDraft((prev) => (prev.trim() === trimmed ? '' : prev));
  }

  async function handleSendMessage(attachmentIds: string[] = []) {
    await submitMessage(draft, attachmentIds);
    setDraft('');
  }

  async function recordEvent(message: ChatMessage, block: ChatBlock, eventType: 'VIEW' | 'PIN' | 'UNPIN') {
    if (!activeSessionId) return;
    const payload = { type: block.type, title: block.title || null };
    if (socket.status === 'open') {
      socket.sendBlockEvent({ messageId: message.id, blockId: block.blockId, eventType, payload });
    } else {
      await apiFetch(`/research-jobs/${jobId}/chat/sessions/${activeSessionId}/events`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id, blockId: block.blockId, eventType, payload }),
      });
    }
    if (eventType === 'PIN' || eventType === 'UNPIN') void savedBlocksQuery.refetch();
  }

  async function handleSelectDesign(message: ChatMessage, designId: string) {
    if (!activeSessionId) return;
    if (socket.status === 'open') {
      socket.sendDesignSelection({ messageId: message.id, designId });
    } else {
      await apiFetch(`/research-jobs/${jobId}/chat/sessions/${activeSessionId}/events`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id, blockId: designId, eventType: 'SELECT_DESIGN', payload: { designId } }),
      });
    }
  }

  async function handleFormSubmit(message: ChatMessage, block: ChatBlock, answer: string) {
    if (!activeSessionId) return;
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) return;
    const payload = { answer: trimmedAnswer, type: block.type, title: block.title || null, autoSent: true, timestamp: new Date().toISOString() };
    if (socket.status === 'open') {
      socket.sendBlockEvent({ messageId: message.id, blockId: block.blockId, eventType: 'FORM_SUBMIT', payload });
    } else {
      await apiFetch(`/research-jobs/${jobId}/chat/sessions/${activeSessionId}/events`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id, blockId: block.blockId, eventType: 'FORM_SUBMIT', payload }),
      });
    }
    await submitMessage(trimmedAnswer);
  }

  async function handleAttachmentView(message: ChatMessage, attachmentId: string, meta?: Record<string, unknown>) {
    if (!activeSessionId) return;
    const payload = meta || {};
    if (socket.status === 'open') {
      socket.sendBlockEvent({ messageId: message.id, blockId: attachmentId, eventType: 'ATTACH_VIEW', payload });
    } else {
      await apiFetch(`/research-jobs/${jobId}/chat/sessions/${activeSessionId}/events`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id, blockId: attachmentId, eventType: 'ATTACH_VIEW', payload }),
      });
    }
  }

  async function handleUnpinSavedBlock(block: ChatSavedBlock) {
    if (!activeSessionId) return;
    await recordEvent({ id: block.messageId, role: 'ASSISTANT', content: '', createdAt: block.createdAt }, { ...block.blockData, blockId: block.blockId }, 'UNPIN');
    queryClient.invalidateQueries({ queryKey: ['chatSavedBlocks', jobId, activeSessionId] });
  }

  const displayMessageCount = messages.length + (streamingMessage ? 1 : 0);
  const sessionError = sessionsQuery.error as Error | null;

  return (
    <div className="relative flex flex-col h-[calc(100vh-12rem)] min-h-[600px] overflow-hidden rounded-2xl border border-primary/20 bg-background/40 shadow-2xl backdrop-blur-md">
      {/* Ambient glow — uses theme primary */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-primary/6 to-transparent" />

      {/* ── Single slim topbar (replaces double-header) ── */}
      <CompactChatTopbar
        sessionTitle={activeSession?.title}
        sessionUpdatedAt={activeSession?.lastActiveAt || activeSession?.createdAt}
        messageCount={displayMessageCount}
        pinnedCount={pinnedBlockIds.size}
        connectionStatus={socket.status}
        isStreaming={socket.status === 'open' && Boolean(streamingMessage)}
        onOpenCrud={() => setCrudOpen(true)}
      />

      {/* Error bar */}
      {sessionError ? (
        <div className="flex-shrink-0 border-b border-destructive/20 bg-destructive/10 px-5 py-1.5 text-[11px] font-medium text-destructive">
          Failed to load chat sessions. {sessionError.message || 'Please retry.'}
        </div>
      ) : null}

      {/* ── Two-column body (no right panel) ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar — narrowed to 220px, contains sessions + context panel */}
        <div className="shrink-0 w-[220px] border-r border-border/40 bg-card/30 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden flex flex-col">
            <ChatSessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={setActiveSessionId}
              onNewSession={handleNewSession}
              isLoading={sessionsQuery.isLoading}
            />
          </div>

          {/* Context panel (Pinned / Stats / Export) in sidebar footer */}
          <SidebarContextPanel
            blocks={savedBlocksQuery.data?.blocks || []}
            onUnpin={handleUnpinSavedBlock}
            isLoading={savedBlocksQuery.isLoading}
            messageCount={displayMessageCount}
          />
        </div>

        {/* Main thread — fills remaining space */}
        <div className="flex-1 min-w-0 bg-background/20 relative overflow-hidden">
          <ChatThread
            messages={messages}
            streamingMessage={streamingMessage}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleSendMessage}
            pinnedBlockIds={pinnedBlockIds}
            onBlockView={(message, block) => recordEvent(message, block, 'VIEW')}
            onBlockPin={(message, block) => recordEvent(message, block, 'PIN')}
            onBlockUnpin={(message, block) => recordEvent(message, block, 'UNPIN')}
            onBlockFormSubmit={handleFormSubmit}
            onSelectDesign={handleSelectDesign}
            onAttachmentView={handleAttachmentView}
            onActionIntent={handleActionIntent}
            isStreaming={socket.status === 'open' && Boolean(streamingMessage)}
            researchJobId={jobId}
          />
        </div>
      </div>

      {/* ── CRUD slide-over drawer (was always-on right panel) ── */}
      <CrudDrawer
        open={crudOpen}
        onClose={() => setCrudOpen(false)}
        onRunCrud={runIntelligenceCrud}
        onOpenSection={openIntelligenceSection}
      />
    </div>
  );
}
