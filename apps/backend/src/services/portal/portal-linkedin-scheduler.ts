import { syncDueLinkedInConnections } from './portal-linkedin';

const DEFAULT_POLL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

function parseBoolean(value: unknown, defaultValue = true): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

async function runOnce() {
  if (running) return;
  running = true;
  try {
    const result = await syncDueLinkedInConnections();
    if (result.attempted > 0) {
      console.log(
        `[LinkedInScheduler] attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`
      );
    }
  } catch (error) {
    console.error('[LinkedInScheduler] Sync loop failed:', error);
  } finally {
    running = false;
  }
}

export function startLinkedInSyncScheduler(pollMs = DEFAULT_POLL_MS) {
  if (!parseBoolean(process.env.LINKEDIN_SYNC_ENABLED, true)) {
    console.log('[LinkedInScheduler] Disabled by LINKEDIN_SYNC_ENABLED');
    return;
  }
  if (timer) {
    clearInterval(timer);
  }
  const interval = Math.max(60_000, Math.floor(pollMs));
  timer = setInterval(() => {
    void runOnce();
  }, interval);
  timer.unref?.();
  void runOnce();
  console.log(`[LinkedInScheduler] Started (${interval}ms poll)`);
}

export function stopLinkedInSyncScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
