'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/http';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { useChatSocket } from '@/lib/ws/useChatSocket';
import { ChatSessionList } from './ChatSessionList';
import { ChatThread } from './ChatThread';
import { ChatSavedPanel } from './ChatSavedPanel';
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

export default function ChatWorkspace({ jobId }: { jobId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [draft, setDraft] = useState('');

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
    if (!activeSessionId && sessionsQuery.data?.sessions?.length) {
      setActiveSessionId(sessionsQuery.data.sessions[0].id);
    }
  }, [sessionsQuery.data?.sessions, activeSessionId]);

  useEffect(() => {
    if (sessionDetailQuery.data?.messages) {
      setMessages(sessionDetailQuery.data.messages);
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

  const socket = useChatSocket({
    researchJobId: jobId,
    sessionId: activeSessionId,
    onEvent: (event) => {
      switch (event.type) {
        case 'AUTH_OK': {
          if (event.sessionId && event.sessionId !== activeSessionId) {
            setActiveSessionId(event.sessionId);
            void sessionsQuery.refetch();
          }
          break;
        }
        case 'HISTORY': {
          if (Array.isArray(event.messages)) {
            setMessages(event.messages);
            setStreamingMessage(null);
          }
          break;
        }
        case 'ASSISTANT_START': {
          setStreamingMessage({
            id: event.messageId,
            role: 'ASSISTANT',
            content: '',
            createdAt: new Date().toISOString(),
          });
          break;
        }
        case 'ASSISTANT_DELTA': {
          setStreamingMessage((prev) =>
            prev && prev.id === event.messageId
              ? { ...prev, content: `${prev.content}${event.delta || ''}` }
              : prev
          );
          break;
        }
        case 'ASSISTANT_BLOCKS': {
          setStreamingMessage((prev) =>
            prev && prev.id === event.messageId
              ? {
                  ...prev,
                  blocks: event.blocks || [],
                  designOptions: event.designOptions || [],
                }
              : prev
          );
          break;
        }
        case 'ASSISTANT_DONE': {
          setStreamingMessage(null);
          void sessionDetailQuery.refetch();
          void savedBlocksQuery.refetch();
          break;
        }
        case 'ERROR': {
          toast({
            title: 'Chat error',
            description: event.details || event.error || 'Chat connection failed',
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
      : socket.status === 'connecting'
        ? { label: 'connecting', variant: 'warning' as const }
        : socket.status === 'error'
          ? { label: 'error', variant: 'destructive' as const }
          : { label: 'offline', variant: 'outline' as const };
  const sessionError = sessionsQuery.error as Error | null;

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
    } catch (error: any) {
      toast({
        title: 'Failed to create session',
        description: error?.message || 'Unable to start a new chat session',
        variant: 'destructive',
      });
      return null;
    }
  }

  async function handleSendMessage(attachmentIds: string[] = []) {
    const trimmed = draft.trim();
    if (!trimmed && attachmentIds.length === 0) return;
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await handleNewSession();
    }
    if (!sessionId) return;
    const clientMessageId = `client-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
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
      },
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
    <div className="relative space-y-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.25),transparent_65%)] blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_bottom,rgba(251,191,36,0.22),transparent_65%)] blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">BAT Workspace</p>
            <h2 className="text-lg font-semibold">Chat Studio</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Grounded strategy collaboration with interactive components and saved context.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connectionBadge.variant} className="text-[10px] uppercase">
              {connectionBadge.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              {messages.length + (streamingMessage ? 1 : 0)} messages
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              {pinnedBlockIds.size} pinned
            </Badge>
          </div>
        </div>
      </motion.div>

      {sessionError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to load chat sessions. {sessionError.message || 'Please retry.'}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        <ChatSessionList
          sessions={sessionsQuery.data?.sessions || []}
          activeSessionId={activeSessionId}
          onSelect={setActiveSessionId}
          onNewSession={handleNewSession}
          isLoading={sessionsQuery.isLoading}
        />

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
          onSelectDesign={handleSelectDesign}
          isStreaming={socket.status === 'open' && Boolean(streamingMessage)}
          connectionStatus={socket.status}
          researchJobId={jobId}
        />

        <ChatSavedPanel
          blocks={savedBlocksQuery.data?.blocks || []}
          onUnpin={handleUnpinSavedBlock}
          isLoading={savedBlocksQuery.isLoading}
        />
      </div>
    </div>
  );
}
