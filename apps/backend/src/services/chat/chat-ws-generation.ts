import type { WebSocket } from 'ws';
import type { ChatBlock, ChatDesignOption } from './chat-types';

const DEFAULT_GENERATION_WATCHDOG_MS = Number(process.env.CHAT_GENERATION_TIMEOUT_MS || 90_000);

function safeSend(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
}

function buildFallbackBlocks(messageId: string): ChatBlock[] {
  return [
    {
      blockId: `error_actions_${messageId}`,
      type: 'action_buttons',
      title: 'Choose next action',
      buttons: [
        { label: 'Retry last message', action: 'retry_last_message' },
        { label: 'Run orchestration', action: 'run_orchestration' },
        { label: 'Open Intelligence', action: 'open_module', payload: { module: 'intelligence' } },
      ],
    },
  ];
}

export type GenerationLifecycle = {
  onDelta: (delta: string) => void;
  onBlocks: (blocks: ChatBlock[], designOptions: ChatDesignOption[]) => void;
  finalizeAsSuccess: (result: {
    content: string;
    blocks: ChatBlock[];
    designOptions: ChatDesignOption[];
    followUp: string[];
  }) => Promise<void>;
  finalizeAsFailure: (errorCode: string, details: string) => Promise<void>;
  startWatchdog: () => void;
  isFinalized: () => boolean;
};

export function createGenerationLifecycle(params: {
  socket: WebSocket;
  assistantMessageId: string;
  onBusyChange: (isBusy: boolean) => void;
  onPersistPartial: (content: string) => void;
  onPersistFinal: (payload: {
    content: string;
    blocks: ChatBlock[];
    designOptions: ChatDesignOption[];
    followUp: string[];
  }) => Promise<void>;
  onSessionTouch: () => Promise<void>;
  watchdogMs?: number;
}): GenerationLifecycle {
  let generationFinalized = false;
  let fullContent = '';
  let lastFlushAt = Date.now();
  let lastFlushLength = 0;
  let watchdogTimer: NodeJS.Timeout | null = null;

  const clearWatchdog = () => {
    if (!watchdogTimer) return;
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  };

  const flushContent = () => {
    if (generationFinalized) return;
    const now = Date.now();
    const lengthDelta = fullContent.length - lastFlushLength;
    if (lengthDelta >= 400 || now - lastFlushAt > 1000) {
      lastFlushAt = now;
      lastFlushLength = fullContent.length;
      params.onPersistPartial(fullContent);
    }
  };

  const finalizeAsSuccess = async (result: {
    content: string;
    blocks: ChatBlock[];
    designOptions: ChatDesignOption[];
    followUp: string[];
  }) => {
    if (generationFinalized) return;
    generationFinalized = true;
    clearWatchdog();
    params.onBusyChange(false);

    safeSend(params.socket, {
      type: 'ASSISTANT_BLOCKS',
      messageId: params.assistantMessageId,
      blocks: result.blocks,
      designOptions: result.designOptions,
      followUp: result.followUp,
    });

    await params.onPersistFinal(result);
    await params.onSessionTouch();
    safeSend(params.socket, {
      type: 'ASSISTANT_DONE',
      messageId: params.assistantMessageId,
      followUp: result.followUp,
    });
  };

  const finalizeAsFailure = async (errorCode: string, details: string) => {
    if (generationFinalized) return;
    generationFinalized = true;
    clearWatchdog();
    params.onBusyChange(false);

    const fallbackContent =
      'I hit a runtime issue while generating this response. You can retry now or run orchestration to refresh data.';
    const fallbackFollowUp = ['Retry the request', 'Run orchestration', 'Open intelligence'];
    const fallbackBlocks = buildFallbackBlocks(params.assistantMessageId);
    const safeDetails = details?.trim() || 'The assistant failed while generating a response.';

    await params.onPersistFinal({
      content: fallbackContent,
      blocks: fallbackBlocks,
      designOptions: [],
      followUp: fallbackFollowUp,
    });
    await params.onSessionTouch();

    safeSend(params.socket, {
      type: 'ASSISTANT_BLOCKS',
      messageId: params.assistantMessageId,
      blocks: fallbackBlocks,
      designOptions: [],
      followUp: fallbackFollowUp,
    });
    safeSend(params.socket, { type: 'ERROR', error: errorCode, details: safeDetails });
    safeSend(params.socket, {
      type: 'ASSISTANT_DONE',
      messageId: params.assistantMessageId,
      followUp: ['Retry the request', 'Run orchestration'],
    });
  };

  const startWatchdog = () => {
    clearWatchdog();
    const timeoutMs = params.watchdogMs || DEFAULT_GENERATION_WATCHDOG_MS;
    watchdogTimer = setTimeout(() => {
      void finalizeAsFailure('GENERATION_TIMEOUT', `Assistant timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
  };

  return {
    onDelta: (delta: string) => {
      if (generationFinalized) return;
      fullContent += delta;
      safeSend(params.socket, { type: 'ASSISTANT_DELTA', messageId: params.assistantMessageId, delta });
      flushContent();
    },
    onBlocks: (blocks: ChatBlock[], designOptions: ChatDesignOption[]) => {
      if (generationFinalized) return;
      safeSend(params.socket, {
        type: 'ASSISTANT_BLOCKS',
        messageId: params.assistantMessageId,
        blocks,
        designOptions,
      });
    },
    finalizeAsSuccess,
    finalizeAsFailure,
    startWatchdog,
    isFinalized: () => generationFinalized,
  };
}
