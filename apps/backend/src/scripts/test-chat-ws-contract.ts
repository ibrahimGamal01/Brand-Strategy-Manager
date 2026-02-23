import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';

type ChatEvent = {
  type: string;
  [key: string]: unknown;
};

type EventCollector = {
  events: ChatEvent[];
  waitFor: (predicate: (event: ChatEvent) => boolean, timeoutMs: number, label: string) => Promise<ChatEvent>;
};

function createCollector(socket: WebSocket): EventCollector {
  const events: ChatEvent[] = [];
  const waiters: Array<{
    predicate: (event: ChatEvent) => boolean;
    resolve: (event: ChatEvent) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  socket.on('message', (raw: RawData) => {
    let payload: ChatEvent;
    try {
      payload = JSON.parse(raw.toString()) as ChatEvent;
    } catch {
      return;
    }
    events.push(payload);
    if (payload.type === 'ERROR') {
      const details = String(payload.details || payload.error || 'Unknown socket error');
      waiters.splice(0).forEach((waiter) => {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`Socket emitted ERROR: ${details}`));
      });
      return;
    }

    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i];
      if (!waiter.predicate(payload)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(i, 1);
      waiter.resolve(payload);
    }
  });

  const waitFor = (predicate: (event: ChatEvent) => boolean, timeoutMs: number, label: string) => {
    return new Promise<ChatEvent>((resolve, reject) => {
      for (const event of events) {
        if (predicate(event)) {
          resolve(event);
          return;
        }
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
      }, timeoutMs);

      waiters.push({ predicate, resolve, reject, timer });
    });
  };

  return { events, waitFor };
}

function toWsOrigin(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  throw new Error(`Invalid BACKEND_BASE_URL: ${baseUrl}`);
}

async function createSession(baseUrl: string, researchJobId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/research-jobs/${researchJobId}/chat/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'WS Contract Test' }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Session create failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { session?: { id?: string } };
  const sessionId = String(payload?.session?.id || '').trim();
  if (!sessionId) throw new Error('Session create response missing session.id');
  return sessionId;
}

async function runContractForJob(baseUrl: string, researchJobId: string): Promise<void> {
  const sessionId = await createSession(baseUrl, researchJobId);
  const wsUrl = `${toWsOrigin(baseUrl)}/api/ws/research-jobs/${researchJobId}/chat`;
  // Local ws.d.ts focuses on server usage, so client constructor is cast here.
  const socket = new (WebSocket as unknown as new (url: string) => WebSocket)(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out after 10s')), 10_000);
    socket.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  const collector = createCollector(socket);

  socket.send(
    JSON.stringify({
      type: 'AUTH',
      researchJobId,
      sessionId,
    }),
  );

  await collector.waitFor((event) => event.type === 'AUTH_OK', 10_000, 'AUTH_OK');
  await collector.waitFor((event) => event.type === 'HISTORY', 10_000, 'HISTORY');

  const clientMessageId = randomUUID();
  socket.send(
    JSON.stringify({
      type: 'USER_MESSAGE',
      sessionId,
      clientMessageId,
      content: 'Give me 3 examples and link the posts.',
    }),
  );

  await collector.waitFor((event) => event.type === 'ASSISTANT_START', 20_000, 'ASSISTANT_START');
  await collector.waitFor((event) => event.type === 'ASSISTANT_DELTA', 40_000, 'ASSISTANT_DELTA');
  await collector.waitFor((event) => event.type === 'ASSISTANT_BLOCKS', 40_000, 'ASSISTANT_BLOCKS');
  await collector.waitFor((event) => event.type === 'ASSISTANT_DONE', 45_000, 'ASSISTANT_DONE');

  const eventTypes = collector.events.map((event) => event.type);
  const startIndex = eventTypes.indexOf('ASSISTANT_START');
  const deltaIndex = eventTypes.indexOf('ASSISTANT_DELTA');
  const blocksIndex = eventTypes.indexOf('ASSISTANT_BLOCKS');
  const doneIndex = eventTypes.lastIndexOf('ASSISTANT_DONE');

  assert.ok(startIndex >= 0, 'ASSISTANT_START missing');
  assert.ok(deltaIndex > startIndex, 'ASSISTANT_DELTA must arrive after ASSISTANT_START');
  assert.ok(blocksIndex > startIndex, 'ASSISTANT_BLOCKS must arrive after ASSISTANT_START');
  assert.ok(doneIndex > blocksIndex, 'ASSISTANT_DONE must arrive after ASSISTANT_BLOCKS');

  socket.close();
  console.log(`[WS Contract] Passed for researchJobId=${researchJobId} sessionId=${sessionId}`);
}

async function main() {
  const baseUrl = (process.env.BACKEND_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const configured = String(
    process.env.CHAT_CONTRACT_JOB_IDS ||
      'f3f6ccd8-c995-4e9f-8d48-d1df90f80ba2,0d4c899a-ad2c-48f8-94df-576247fdbfd8',
  );
  const jobIds = configured
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!jobIds.length) throw new Error('No research job ids supplied for ws contract test.');
  for (const researchJobId of jobIds) {
    await runContractForJob(baseUrl, researchJobId);
  }
  console.log('[WS Contract] All jobs passed.');
}

main().catch((error) => {
  console.error('[WS Contract] Failed:', error);
  process.exit(1);
});
