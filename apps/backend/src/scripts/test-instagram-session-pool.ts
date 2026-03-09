import {
  __resetInstagramSessionPoolForTests,
  acquireInstagramSession,
  getInstagramGlobalGateRemainingMs,
  isInstagramGlobalGateActive,
  loadSessionsFromEnv,
  recordInstagramSessionFailure,
} from '../services/scraper/instagram-session-pool';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const prevCookies = process.env.INSTAGRAM_SESSION_COOKIES;
  const prevCookie = process.env.INSTAGRAM_SESSION_COOKIE;
  const prevMaxFailures = process.env.INSTAGRAM_SESSION_MAX_FAILURES;
  const prevCooldownMs = process.env.INSTAGRAM_SESSION_COOLDOWN_MS;
  const prevGateCooldownMs = process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;

  try {
    process.env.INSTAGRAM_SESSION_COOKIES =
      'sessionid=alpha; csrftoken=a, sessionid=beta; csrftoken=b || sessionid=gamma; csrftoken=c\nsessionid=delta; csrftoken=d';
    delete process.env.INSTAGRAM_SESSION_COOKIE;
    process.env.INSTAGRAM_SESSION_MAX_FAILURES = '2';
    process.env.INSTAGRAM_SESSION_COOLDOWN_MS = '120000';
    process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = '180000';

    __resetInstagramSessionPoolForTests();

    const loaded = loadSessionsFromEnv();
    assert(loaded.length === 4, `Expected 4 parsed sessions, got ${loaded.length}`);
    assert(loaded.every((entry) => entry.cookie.includes('sessionid=')), 'Expected every parsed entry to include sessionid');

    const first = acquireInstagramSession();
    assert(first?.id, 'Expected first session to be acquired');
    if (!first) throw new Error('Expected first session');

    recordInstagramSessionFailure(first.id, 'AUTH_401');
    recordInstagramSessionFailure(first.id, 'AUTH_401');

    const second = acquireInstagramSession();
    assert(second?.id, 'Expected fallback session to be acquired');
    assert(second?.id !== first.id, 'Expected cooled down session to be skipped');

    if (!second) throw new Error('Expected second session');
    recordInstagramSessionFailure(second.id, 'LOGIN_GATE');

    assert(isInstagramGlobalGateActive(), 'Expected global gate to become active after login gate failure');
    assert(getInstagramGlobalGateRemainingMs() > 0, 'Expected global gate remaining time to be positive');

    console.log('instagram-session-pool tests passed');
  } finally {
    if (typeof prevCookies === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIES;
    else process.env.INSTAGRAM_SESSION_COOKIES = prevCookies;
    if (typeof prevCookie === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIE;
    else process.env.INSTAGRAM_SESSION_COOKIE = prevCookie;
    if (typeof prevMaxFailures === 'undefined') delete process.env.INSTAGRAM_SESSION_MAX_FAILURES;
    else process.env.INSTAGRAM_SESSION_MAX_FAILURES = prevMaxFailures;
    if (typeof prevCooldownMs === 'undefined') delete process.env.INSTAGRAM_SESSION_COOLDOWN_MS;
    else process.env.INSTAGRAM_SESSION_COOLDOWN_MS = prevCooldownMs;
    if (typeof prevGateCooldownMs === 'undefined') delete process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;
    else process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = prevGateCooldownMs;
    __resetInstagramSessionPoolForTests();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
