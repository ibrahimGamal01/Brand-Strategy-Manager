'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api/http';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { useChatSocket } from '@/lib/ws/useChatSocket';
import { ChatSessionList } from './ChatSessionList';
import { ChatThread } from './ChatThread';
import { ChatSavedPanel } from './ChatSavedPanel';
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
  'handle',
  'platform',
  'profileUrl',
  'title',
  'query',
  'url',
  'href',
  'keyword',
  'question',
  'source',
  'metric',
  'sourceType',
];

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
    url.searchParams.forEach((value, key) => {
      values[key] = value;
    });
    return values;
  } catch {
    return {};
  }
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
  const activeSessionStorageKey = useMemo(() => `bat.chat.activeSession.${jobId}`, [jobId]);
  const lastUserCommandRef = useRef('');
  const autoCrudHandledRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    const sessions = sessionsQuery.data?.sessions || [];
    if (!sessions.length) return;
    const availableIds = new Set(sessions.map((session) => session.id));

    if (activeSessionId && availableIds.has(activeSessionId)) {
      return;
    }

    let fromStorage: string | null = null;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(activeSessionStorageKey);
      if (stored && availableIds.has(stored)) {
        fromStorage = stored;
      }
    }

    const nextSessionId = fromStorage || sessions[0].id;
    if (nextSessionId && nextSessionId !== activeSessionId) {
      setActiveSessionId(nextSessionId);
    }
  }, [sessionsQuery.data?.sessions, activeSessionId, activeSessionStorageKey]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(activeSessionStorageKey, activeSessionId);
  }, [activeSessionId, activeSessionStorageKey]);

  useEffect(() => {
    if (sessionDetailQuery.data?.messages) {
      setMessages(sanitizeChatMessages(sessionDetailQuery.data.messages));
    }
  }, [sessionDetailQuery.data?.messages, activeSessionId]);

  useEffect(() => {
    setStreamingMessage(null);
    if (activeSessionId && !sessionDetailQuery.data?.messages) {
      setMessages([]);
    }
  }, [activeSessionId]);

  const pinnedBlockIds = useMemo(() => {
    const ids = new Set<string>();
    (savedBlocksQuery.data?.blocks || []).forEach((block) => ids.add(block.blockId));
    return ids;
  }, [savedBlocksQuery.data?.blocks]);

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
          // Immediately promote the streaming message into the messages array with followUp
          setStreamingMessage((prev) => {
            if (prev && doneId && prev.id === doneId) {
              const finalMsg = sanitizeChatMessage({
                ...prev,
                pending: false,
                followUp: doneFollowUp,
              });
              setMessages((msgs) => {
                const exists = msgs.find((m) => m.id === doneId);
                if (exists) {
                  return msgs.map((m) =>
                    m.id === doneId
                      ? sanitizeChatMessage({ ...m, followUp: doneFollowUp })
                      : sanitizeChatMessage(m)
                  );
                }
                return [
                  ...msgs.filter((m) => !m.pending || m.id !== doneId).map((m) => sanitizeChatMessage(m)),
                  finalMsg,
                ];
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

  const activeSession = sessionsQuery.data?.sessions?.find((session) => session.id === activeSessionId) || null;
  const connectionBadge =
    socket.status === 'open'
      ? { label: 'connected', variant: 'success' as const }
      : socket.status === 'reconnecting'
        ? { label: 'reconnecting', variant: 'warning' as const }
        : socket.status === 'connecting'
          ? { label: 'connecting', variant: 'warning' as const }
          : socket.status === 'error'
            ? { label: 'error', variant: 'destructive' as const }
            : { label: 'offline', variant: 'outline' as const };
  const sessionError = sessionsQuery.error as Error | null;

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
            if (value === null || value === undefined) return;
            if (typeof value === 'object') return;
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
              if (value.includes(term)) {
                score += 1.25;
                matched = true;
                break;
              }
            }
            if (!matched) {
              const corpus = normalizeText(JSON.stringify(row));
              if (corpus.includes(term)) {
                score += 0.35;
              }
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
    section,
    action,
    itemId,
    data,
    quiet,
    target,
    contextQuery,
  }: IntelligenceCrudRequest): Promise<unknown> {
    const config = INTELLIGENCE_SECTION_BY_KEY[section];
    const basePath = `/research-jobs/${jobId}/intelligence/${section}`;
    let response: unknown = null;

    if (action === 'read') {
      response = await apiFetch(basePath);
    } else if (action === 'create') {
      response = await apiFetch(basePath, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      });
    } else if (action === 'update') {
      const resolvedItemId = await resolveCrudItemId(section, itemId, data, target, contextQuery);
      if (!resolvedItemId) {
        throw new Error(`Unable to identify which ${config.label} record to update. Mention a unique handle/title/url in chat.`);
      }
      response = await apiFetch(`${basePath}/${resolvedItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ data: data || {} }),
      });
    } else if (action === 'delete') {
      const resolvedItemId = await resolveCrudItemId(section, itemId, data, target, contextQuery);
      if (!resolvedItemId) {
        throw new Error(`Unable to identify which ${config.label} record to delete. Mention a unique handle/title/url in chat.`);
      }
      response = await apiFetch(`${basePath}/${resolvedItemId}`, {
        method: 'DELETE',
      });
    } else if (action === 'clear') {
      response = await apiFetch(basePath, {
        method: 'DELETE',
      });
    }

    if (action !== 'read') {
      queryClient.invalidateQueries({ queryKey: ['researchJob', jobId] });
      queryClient.invalidateQueries({ queryKey: ['chatSessions', jobId] });
      queryClient.invalidateQueries({ queryKey: ['chatSession', jobId, activeSessionId] });
      if (!quiet) {
        toast({
          title: `${config.label}: ${action}`,
          description: `Successfully ran ${action.toUpperCase()} on ${config.label}.`,
        });
      }
    }

    return response;
  }

  function openIntelligenceSection(sectionKey?: IntelligenceSectionKey) {
    const nextParams = new URLSearchParams(searchParamsString);
    nextParams.set('module', 'intelligence');
    if (sectionKey) {
      nextParams.set('intelSection', sectionKey);
    }
    router.push(`${pathname}?${nextParams.toString()}`);
  }

  async function handleActionIntent(action?: string, href?: string, payload?: Record<string, unknown>) {
    const normalizedAction = String(action || '').toLowerCase();

    if (normalizedAction === 'open_module') {
      const fallbackTarget = `/research/${jobId}?module=intelligence`;
      const target = href || fallbackTarget;
      if (target.startsWith('http')) {
        window.open(target, '_blank');
      } else if (target.includes('module=intelligence')) {
        const section = resolveIntelligenceSection(payload?.section || payload?.sectionKey);
        openIntelligenceSection(section || undefined);
      } else {
        router.push(target);
      }
      return;
    }

    if (
      normalizedAction === 'run_intel' ||
      normalizedAction === 'run_orchestrator' ||
      normalizedAction === 'run_intelligence'
    ) {
      const target = href || `/api/research-jobs/${jobId}/brand-intelligence/orchestrate`;
      await fetch(target, { method: 'POST' }).catch(() => { });
      toast({
        title: 'Intelligence run started',
        description: 'Queued orchestration for brand mentions and community insights.',
      });
      return;
    }

    if (normalizedAction.startsWith('intel_')) {
      const hrefParams = parseHrefParams(href);
      const section = resolveIntelligenceSection(
        payload?.section || payload?.sectionKey || hrefParams.section || hrefParams.sectionKey
      );
      const actionFromButton =
        normalizedAction === 'intel_crud' ? null : resolveIntelligenceCrudAction(normalizedAction.replace('intel_', ''));
      const resolvedAction =
        actionFromButton ||
        resolveIntelligenceCrudAction(payload?.operation || payload?.action || hrefParams.operation || hrefParams.action);
      if (!section || !resolvedAction) {
        toast({
          title: 'Invalid CRUD action',
          description: 'The assistant action is missing a valid section or operation.',
          variant: 'destructive',
        });
        return;
      }
      const itemId =
        (typeof payload?.itemId === 'string' && payload.itemId) ||
        (typeof payload?.id === 'string' && payload.id) ||
        hrefParams.itemId ||
        hrefParams.id ||
        undefined;
      const targetCandidate =
        payload?.target ||
        payload?.where ||
        payload?.match ||
        payload?.record ||
        payload?.item ||
        hrefParams.target ||
        hrefParams.lookup ||
        undefined;
      const fallbackPayloadData =
        payload && typeof payload === 'object'
          ? Object.fromEntries(
            Object.entries(payload).filter(
              ([key]) =>
                ![
                  'section',
                  'sectionKey',
                  'operation',
                  'action',
                  'itemId',
                  'id',
                  'target',
                  'where',
                  'match',
                  'record',
                  'item',
                  'href',
                  'label',
                  'intent',
                  'method',
                  'data',
                ].includes(key)
            )
          )
          : {};
      const body =
        payload && typeof payload.data === 'object' && payload.data !== null
          ? (payload.data as Record<string, unknown>)
          : (fallbackPayloadData as Record<string, unknown>);
      const lastUserText =
        [...messages].reverse().find((message) => message.role === 'USER' && String(message.content || '').trim())?.content ||
        lastUserCommandRef.current;
      await runIntelligenceCrud({
        section,
        action: resolvedAction,
        itemId,
        data: body,
        target:
          typeof targetCandidate === 'string' || asRecord(targetCandidate)
            ? (targetCandidate as Record<string, unknown> | string)
            : undefined,
        contextQuery: lastUserText,
      });
      if (resolvedAction !== 'read') {
        openIntelligenceSection(section);
      }
      return;
    }

    if (href) {
      window.open(href, href.startsWith('http') ? '_blank' : '_self');
    }
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
      const message = error instanceof Error ? error.message : 'Unable to start a new chat session';
      toast({
        title: 'Failed to create session',
        description: message,
        variant: 'destructive',
      });
      return null;
    }
  }

  async function submitMessage(rawContent: string, attachmentIds: string[] = []) {
    const trimmed = rawContent.trim();
    if (!trimmed && attachmentIds.length === 0) return;
    if (trimmed) {
      lastUserCommandRef.current = trimmed;
    }
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await handleNewSession();
    }
    if (!sessionId) return;
    const clientMessageId = `client-${Date.now()}`;
    setMessages((prev) => [
      ...prev.map((message) => sanitizeChatMessage(message)),
      sanitizeChatMessage({
        id: clientMessageId,
        role: 'USER',
        content: trimmed,
        createdAt: new Date().toISOString(),
        pending: true,
        attachments: attachmentIds.map((id) => ({
          id,
          storagePath: '',
          mimeType: '',
          aiSummary: 'Uploading…',
        })),
      }),
    ]);
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

  async function recordEvent(
    message: ChatMessage,
    block: ChatBlock,
    eventType: 'VIEW' | 'PIN' | 'UNPIN'
  ) {
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
    if (eventType === 'PIN' || eventType === 'UNPIN') {
      void savedBlocksQuery.refetch();
    }
  }

  async function handleSelectDesign(message: ChatMessage, designId: string) {
    if (!activeSessionId) return;
    if (socket.status === 'open') {
      socket.sendDesignSelection({ messageId: message.id, designId });
    } else {
      await apiFetch(`/research-jobs/${jobId}/chat/sessions/${activeSessionId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          messageId: message.id,
          blockId: designId,
          eventType: 'SELECT_DESIGN',
          payload: { designId },
        }),
      });
    }
  }

  async function handleFormSubmit(message: ChatMessage, block: ChatBlock, answer: string) {
    if (!activeSessionId) return;
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) return;
    const payload = {
      answer: trimmedAnswer,
      type: block.type,
      title: block.title || null,
      autoSent: true,
      timestamp: new Date().toISOString(),
    };
    if (socket.status === 'open') {
      socket.sendBlockEvent({
        messageId: message.id,
        blockId: block.blockId,
        eventType: 'FORM_SUBMIT',
        payload,
      });
    } else {
      await apiFetch(`/research-jobs/${jobId}/chat/sessions/${activeSessionId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          messageId: message.id,
          blockId: block.blockId,
          eventType: 'FORM_SUBMIT',
          payload,
        }),
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
        body: JSON.stringify({
          messageId: message.id,
          blockId: attachmentId,
          eventType: 'ATTACH_VIEW',
          payload,
        }),
      });
    }
  }

  async function handleUnpinSavedBlock(block: ChatSavedBlock) {
    if (!activeSessionId) return;
    await recordEvent(
      {
        id: block.messageId,
        role: 'ASSISTANT',
        content: '',
        createdAt: block.createdAt,
      },
      { ...block.blockData, blockId: block.blockId },
      'UNPIN'
    );
    queryClient.invalidateQueries({ queryKey: ['chatSavedBlocks', jobId, activeSessionId] });
  }

  return (
    <div className="relative flex flex-col h-[calc(100vh-12rem)] min-h-[600px] overflow-hidden rounded-2xl border border-emerald-500/20 bg-background/40 shadow-2xl backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.1),transparent_70%)]" />

      {/* Global Header */}
      <div className="flex-shrink-0 border-b border-border/40 bg-card/60 px-6 py-4 flex items-center justify-between backdrop-blur-md z-10">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-cyan-500 text-[10px] font-bold text-white shadow-sm">
              BAT
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Intelligence Studio</h2>
          </div>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-widest text-[9px] font-medium opacity-80">Command Center</span>
            <span>&bull;</span>
            <span>Session-persistent guided workflows</span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={connectionBadge.variant} className="text-[10px] uppercase shadow-sm">
            {connectionBadge.label}
          </Badge>
          <div className="h-4 w-px bg-border/60" />
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium">
            <span>{messages.length + (streamingMessage ? 1 : 0)} msgs</span>
            <span>{pinnedBlockIds.size} pinned</span>
          </div>
        </div>
      </div>

      {sessionError ? (
        <div className="flex-shrink-0 border-b border-destructive/20 bg-destructive/10 px-6 py-2 text-xs font-medium text-destructive">
          Failed to load chat sessions. {sessionError.message || 'Please retry.'}
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div className="flex-shrink-0 w-72 border-r border-border/40 bg-card/30 p-4 overflow-y-auto custom-scrollbar">
          <ChatSessionList
            sessions={sessionsQuery.data?.sessions || []}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onNewSession={handleNewSession}
            isLoading={sessionsQuery.isLoading}
          />
        </div>

        {/* Main Thread */}
        <div className="flex-1 min-w-0 bg-background/20 relative">
          <div className="absolute inset-0">
            <ChatThread
              messages={messages}
              streamingMessage={streamingMessage}
              sessionTitle={activeSession?.title || 'Untitled session'}
              sessionUpdatedAt={activeSession?.lastActiveAt || activeSession?.createdAt}
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
              connectionStatus={socket.status}
              researchJobId={jobId}
            />
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="flex-shrink-0 w-[340px] border-l border-border/40 bg-card/30 p-4 space-y-6 overflow-y-auto custom-scrollbar">
          <ChatSavedPanel
            blocks={savedBlocksQuery.data?.blocks || []}
            onUnpin={handleUnpinSavedBlock}
            isLoading={savedBlocksQuery.isLoading}
            messageCount={messages.length + (streamingMessage ? 1 : 0)}
          />
          <ChatIntelligenceCrudPanel
            onRunCrud={runIntelligenceCrud}
            onOpenSection={openIntelligenceSection}
          />
        </div>
      </div>
    </div>
  );
}
