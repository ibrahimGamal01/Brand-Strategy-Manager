import assert from 'node:assert/strict';
import type { ProcessEvent } from '@prisma/client';
import { serializeRuntimeProcessEvent } from '../services/chat/runtime/event-contract';
import {
  buildPlanFromMessage,
  sanitizeClientResponse,
  stripLegacyBoilerplateResponse,
} from '../services/chat/runtime/run-engine';
import { normalizeProcessEventCursor } from '../services/chat/runtime/repository';
import {
  __setPortalIntakeEventsRepositoryForTests,
  getPortalIntakeEventStoreDiagnostics,
  listPortalIntakeEvents,
  publishPortalIntakeEvent,
  subscribePortalIntakeEvents,
} from '../services/portal/portal-intake-events';

async function testDetailedDefaultDepth() {
  const plan = buildPlanFromMessage('What do you see in this workspace?');
  assert.equal(plan.responseStyle.depth, 'deep', 'Plan depth should default to deep when concise is not requested.');

  const concisePlan = buildPlanFromMessage('Give me a brief summary.');
  assert.equal(concisePlan.responseStyle.depth, 'fast', 'Plan depth should switch to fast when concise is requested.');
}

function testClientSanitizer() {
  const raw = [
    'Fork from here',
    'This is the real answer.',
    '',
    'Tool execution trace:',
    '1. intel.list (done)',
    '',
    'Validation note: missing evidence',
    '',
    'No tools executed in this run.',
  ].join('\n');

  const stripped = stripLegacyBoilerplateResponse(raw);
  const sanitized = sanitizeClientResponse(raw);

  assert.ok(stripped.includes('This is the real answer.'), 'Expected core response to survive legacy stripping.');
  assert.ok(!/tool execution trace/i.test(sanitized), 'Sanitizer should remove tool execution trace text.');
  assert.ok(!/validation note/i.test(sanitized), 'Sanitizer should remove validation-note text.');
  assert.ok(!/no tools executed/i.test(sanitized), 'Sanitizer should remove no-tools text.');
}

function testEventSeqSerialization() {
  const event = {
    id: 'evt-1',
    branchId: 'branch-1',
    type: 'PROCESS_LOG',
    level: 'INFO',
    message: 'hello',
    agentRunId: 'run-1',
    toolRunId: null,
    payloadJson: null,
    createdAt: new Date(),
    eventSeq: BigInt(123),
  } as unknown as ProcessEvent & { eventSeq: bigint };

  const serialized = serializeRuntimeProcessEvent(event);
  assert.equal(serialized.eventSeq, '123', 'Serialized runtime event should include eventSeq string.');
}

async function testPortalIntakeMemoryMode() {
  const previousMode = process.env.PORTAL_INTAKE_EVENT_STORE_MODE;
  process.env.PORTAL_INTAKE_EVENT_STORE_MODE = 'memory';

  try {
    const workspaceId = `ws-r1-${Date.now()}`;
    const runA = `scan-a-${Date.now()}`;
    const runB = `scan-b-${Date.now()}`;
    let observed = 0;
    const unsubscribe = subscribePortalIntakeEvents(workspaceId, () => {
      observed += 1;
    });

    const event1 = await publishPortalIntakeEvent(
      workspaceId,
      'SCAN_STARTED',
      'run a started',
      { marker: 'a' },
      { scanRunId: runA },
    );
    const event2 = await publishPortalIntakeEvent(
      workspaceId,
      'SCAN_DONE',
      'run b done',
      { marker: 'b' },
      { scanRunId: runB },
    );

    const all = await listPortalIntakeEvents(workspaceId, { afterId: 0, limit: 20 });
    const onlyRunA = await listPortalIntakeEvents(workspaceId, { scanRunId: runA, limit: 20 });
    const afterFirst = await listPortalIntakeEvents(workspaceId, { afterId: event1.id, limit: 20 });

    unsubscribe();

    assert.equal(observed, 2, 'Expected portal intake listeners to receive published events.');
    assert.ok(all.length >= 2, 'Expected list to return published memory events.');
    assert.equal(onlyRunA.length, 1, 'Expected scanRunId filter to return one event.');
    assert.equal(onlyRunA[0]?.scanRunId, runA, 'Expected scanRunId filtered event to match requested run.');
    assert.ok(afterFirst.some((entry) => entry.id === event2.id), 'Expected afterId filter to include second event.');
  } finally {
    if (previousMode === undefined) {
      delete process.env.PORTAL_INTAKE_EVENT_STORE_MODE;
    } else {
      process.env.PORTAL_INTAKE_EVENT_STORE_MODE = previousMode;
    }
  }
}

async function testPortalIntakeDualModeDbFallback() {
  const previousMode = process.env.PORTAL_INTAKE_EVENT_STORE_MODE;
  process.env.PORTAL_INTAKE_EVENT_STORE_MODE = 'dual';
  const workspaceId = `ws-r1-dual-${Date.now()}`;
  const scanRunId = `scan-r1-dual-${Date.now()}`;

  __setPortalIntakeEventsRepositoryForTests({
    createPortalIntakeScanEvent: async () => {
      throw new Error('simulated db write outage');
    },
    listPortalIntakeScanEvents: async () => {
      throw new Error('simulated db read outage');
    },
  });

  try {
    const published = await publishPortalIntakeEvent(
      workspaceId,
      'SCAN_STARTED',
      'dual mode publish should fallback to memory',
      { simulated: true },
      { scanRunId }
    );
    assert.equal(published.workspaceId, workspaceId, 'Dual mode should still publish event from fallback path.');

    const listed = await listPortalIntakeEvents(workspaceId, { afterId: 0, limit: 30, scanRunId });
    assert.ok(listed.length >= 1, 'Dual mode should list fallback memory events when DB reads fail.');

    const diagnostics = getPortalIntakeEventStoreDiagnostics();
    assert.ok(diagnostics.counters.dbWriteFailure >= 1, 'Expected DB write failures to be counted.');
    assert.ok(diagnostics.counters.dbReadFailure >= 1, 'Expected DB read failures to be counted.');
    assert.ok(
      diagnostics.counters.dbReadFallbackToMemory >= 1,
      'Expected DB read fallback count to increase in dual mode.'
    );
  } finally {
    __setPortalIntakeEventsRepositoryForTests(null);
    if (previousMode === undefined) {
      delete process.env.PORTAL_INTAKE_EVENT_STORE_MODE;
    } else {
      process.env.PORTAL_INTAKE_EVENT_STORE_MODE = previousMode;
    }
  }
}

async function testPortalIntakeDbModeRequiresDb() {
  const previousMode = process.env.PORTAL_INTAKE_EVENT_STORE_MODE;
  process.env.PORTAL_INTAKE_EVENT_STORE_MODE = 'db';

  __setPortalIntakeEventsRepositoryForTests({
    createPortalIntakeScanEvent: async () => {
      throw new Error('hard db outage');
    },
    listPortalIntakeScanEvents: async () => {
      throw new Error('hard db outage');
    },
  });

  try {
    await assert.rejects(
      publishPortalIntakeEvent(
        `ws-r1-db-${Date.now()}`,
        'SCAN_STARTED',
        'db mode should throw when DB write fails',
        {},
        { scanRunId: `scan-r1-db-${Date.now()}` }
      ),
      /hard db outage/i
    );
  } finally {
    __setPortalIntakeEventsRepositoryForTests(null);
    if (previousMode === undefined) {
      delete process.env.PORTAL_INTAKE_EVENT_STORE_MODE;
    } else {
      process.env.PORTAL_INTAKE_EVENT_STORE_MODE = previousMode;
    }
  }
}

function testCursorPrefersAfterSeq() {
  const cursor = normalizeProcessEventCursor({
    afterId: 'evt-id-123',
    afterSeq: '456',
    limit: 25,
  });
  assert.equal(cursor.afterSeq, '456', 'Expected afterSeq to be retained when provided.');
  assert.equal(cursor.afterId, 'evt-id-123', 'Expected afterId fallback to remain available.');
  assert.equal(cursor.limit, 25, 'Expected cursor limit to be preserved.');
}

async function main() {
  await testDetailedDefaultDepth();
  testClientSanitizer();
  testEventSeqSerialization();
  await testPortalIntakeMemoryMode();
  await testPortalIntakeDualModeDbFallback();
  await testPortalIntakeDbModeRequiresDb();
  testCursorPrefersAfterSeq();
  console.log('[R1 Reliability] Core regression checks passed.');
}

void main().catch((error) => {
  console.error('[R1 Reliability] Failed:', error);
  process.exit(1);
});
