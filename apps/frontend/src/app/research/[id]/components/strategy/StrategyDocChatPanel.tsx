'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/http';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type StrategySectionKey =
  | 'businessUnderstanding'
  | 'targetAudience'
  | 'industryOverview'
  | 'priorityCompetitor'
  | 'contentAnalysis'
  | 'contentPillars'
  | 'formatRecommendations'
  | 'buyerJourney'
  | 'platformStrategy';

type StrategyChatScope = 'ALL' | 'SECTION';

type StrategyChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: string;
};

type StrategyChatSession = {
  id: string;
  scope: StrategyChatScope;
  sectionKey?: string | null;
  title?: string | null;
};

interface StrategyDocChatPanelProps {
  jobId: string;
  sections: Partial<Record<StrategySectionKey, string>>;
}

const SECTION_LABELS: Record<StrategySectionKey, string> = {
  businessUnderstanding: 'Business Understanding',
  targetAudience: 'Target Audience',
  industryOverview: 'Industry Overview',
  priorityCompetitor: 'Priority Competitor',
  contentAnalysis: 'Content Analysis',
  contentPillars: 'Content Pillars',
  formatRecommendations: 'Format Recommendations',
  buyerJourney: 'Buyer Journey',
  platformStrategy: 'Platform Strategy',
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function StrategyDocChatPanel({ jobId, sections }: StrategyDocChatPanelProps) {
  const availableSections = useMemo(
    () =>
      (Object.keys(SECTION_LABELS) as StrategySectionKey[])
        .filter((key) => typeof sections[key] === 'string' && String(sections[key]).trim().length > 0)
        .map((key) => ({ key, label: SECTION_LABELS[key] })),
    [sections]
  );

  const [scope, setScope] = useState<StrategyChatScope>('ALL');
  const [sectionKey, setSectionKey] = useState<StrategySectionKey>('businessUnderstanding');
  const [session, setSession] = useState<StrategyChatSession | null>(null);
  const [messages, setMessages] = useState<StrategyChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingSession, setLoadingSession] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentStatus, setDocumentStatus] = useState<'FINAL' | 'DRAFT' | 'NONE' | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (availableSections.length === 0 && scope === 'SECTION') {
      setScope('ALL');
      return;
    }
    if (!availableSections.some((entry) => entry.key === sectionKey) && availableSections[0]) {
      setSectionKey(availableSections[0].key);
    }
  }, [availableSections, scope, sectionKey]);

  useEffect(() => {
    let cancelled = false;

    async function initializeSession() {
      if (scope === 'SECTION' && availableSections.length === 0) return;
      setLoadingSession(true);
      setError(null);
      try {
        const response = await apiFetch<{
          success: boolean;
          session?: StrategyChatSession;
          messages?: StrategyChatMessage[];
        }>(`/strategy/${jobId}/chat/sessions`, {
          method: 'POST',
          body: JSON.stringify({
            scope,
            sectionKey: scope === 'SECTION' ? sectionKey : null,
          }),
        });

        if (cancelled) return;
        if (!response?.success || !response.session) {
          throw new Error('Failed to initialize chat session');
        }
        setSession(response.session);
        setMessages(Array.isArray(response.messages) ? response.messages : []);
      } catch (sessionError: any) {
        if (cancelled) return;
        setError(sessionError?.message || 'Failed to initialize doc chat');
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    }

    void initializeSession();

    return () => {
      cancelled = true;
    };
  }, [jobId, scope, sectionKey, availableSections.length]);

  useEffect(() => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [messages]);

  async function handleSendMessage() {
    const trimmed = draft.trim();
    if (!trimmed || !session?.id) return;

    setSendingMessage(true);
    setError(null);

    try {
      const response = await apiFetch<{
        success: boolean;
        messages?: StrategyChatMessage[];
        documentStatus?: 'FINAL' | 'DRAFT' | 'NONE';
      }>(`/strategy/${jobId}/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: trimmed }),
      });
      if (!response?.success) {
        throw new Error('Failed to send message');
      }
      setDraft('');
      setMessages(Array.isArray(response.messages) ? response.messages : []);
      setDocumentStatus(response.documentStatus || null);
    } catch (chatError: any) {
      setError(chatError?.message || 'Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  }

  return (
    <section className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Doc Chat</h3>
          <p className="text-xs text-muted-foreground">
            Chat with the full strategy or a specific section.
          </p>
        </div>
        {documentStatus ? (
          <Badge variant={documentStatus === 'FINAL' ? 'success' : documentStatus === 'DRAFT' ? 'warning' : 'outline'} className="text-[10px] uppercase">
            {documentStatus}
          </Badge>
        ) : null}
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Scope</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as StrategyChatScope)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="ALL">All sections</option>
            <option value="SECTION" disabled={availableSections.length === 0}>
              Single section
            </option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Section</span>
          <select
            value={sectionKey}
            onChange={(event) => setSectionKey(event.target.value as StrategySectionKey)}
            disabled={scope !== 'SECTION'}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
          >
            {(availableSections.length > 0 ? availableSections : [{ key: 'businessUnderstanding', label: 'No generated sections yet' }]).map((section) => (
              <option key={section.key} value={section.key}>
                {section.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        ref={messagesContainerRef}
        className="max-h-[340px] space-y-2 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2 custom-scrollbar"
      >
        {loadingSession ? (
          <p className="text-xs text-muted-foreground">Loading chat session...</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No messages yet. Ask BAT to refine this strategy.</p>
        ) : (
          messages.map((message) => {
            const mine = message.role === 'USER';
            return (
              <article
                key={message.id}
                className={`rounded-md border px-3 py-2 text-xs ${
                  mine
                    ? 'ml-6 border-primary/35 bg-primary/10 text-foreground'
                    : 'mr-6 border-border/60 bg-card/80 text-foreground'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold uppercase tracking-wide text-[10px]">
                    {mine ? 'You' : message.role === 'ASSISTANT' ? 'BAT' : 'System'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{formatTimestamp(message.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              </article>
            );
          })
        )}
      </div>

      <div className="mt-3 space-y-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            scope === 'SECTION'
              ? 'Ask about this section only (edits, clarity, missing evidence...)'
              : 'Ask about the full strategy document...'
          }
          className="min-h-[90px]"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleSendMessage} disabled={sendingMessage || loadingSession || !session?.id || !draft.trim()}>
            {sendingMessage ? 'Sending...' : 'Send'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft(
                scope === 'SECTION'
                  ? 'Give me 3 concrete edits to improve this section without changing the intent.'
                  : 'What are the biggest gaps across the full strategy and how should we fix them?'
              )
            }
          >
            Prompt Idea
          </Button>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}
