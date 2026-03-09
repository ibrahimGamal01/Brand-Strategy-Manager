import { AxiosError } from 'axios';
import { createGraphQLScraper } from '../services/scraper/instagram-graphql';
import {
  __resetInstagramSessionPoolForTests,
  getInstagramGlobalGateRemainingMs,
} from '../services/scraper/instagram-session-pool';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeAxiosError(status: number, data: unknown): AxiosError {
  return new AxiosError(
    `HTTP ${status}`,
    status === 401 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE',
    { headers: {} } as any,
    null,
    {
      status,
      statusText: status === 401 ? 'Unauthorized' : status === 429 ? 'Too Many Requests' : 'Forbidden',
      headers: {},
      config: { headers: {} } as any,
      data,
    } as any
  );
}

async function testSingleCookieStopsRetryLoop(): Promise<void> {
  const prevCookie = process.env.INSTAGRAM_SESSION_COOKIE;
  const prevCookies = process.env.INSTAGRAM_SESSION_COOKIES;
  const prevGateCooldown = process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;

  process.env.INSTAGRAM_SESSION_COOKIE = 'sessionid=single; csrftoken=singlecsrf';
  delete process.env.INSTAGRAM_SESSION_COOKIES;
  process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = '60000';
  __resetInstagramSessionPoolForTests();

  try {
    const scraper = createGraphQLScraper();
    let callCount = 0;

    (scraper as any).client = {
      defaults: { headers: { common: { Cookie: process.env.INSTAGRAM_SESSION_COOKIE } } },
      get: async () => {
        callCount += 1;
        throw makeAxiosError(401, {
          message: 'Please wait a few minutes before you try again.',
          require_login: true,
          status: 'fail',
        });
      },
    };

    let caughtError = '';
    try {
      await scraper.scrapeProfile('single_cookie_user');
    } catch (error: any) {
      caughtError = String(error?.message || error);
    }

    assert(
      caughtError.includes('INSTAGRAM_LOGIN_GATE_ACTIVE'),
      `Expected login gate terminal error, got: ${caughtError}`
    );
    assert(callCount === 1, `Expected one request attempt, got ${callCount}`);
  } finally {
    if (typeof prevCookie === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIE;
    else process.env.INSTAGRAM_SESSION_COOKIE = prevCookie;
    if (typeof prevCookies === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIES;
    else process.env.INSTAGRAM_SESSION_COOKIES = prevCookies;
    if (typeof prevGateCooldown === 'undefined') delete process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;
    else process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = prevGateCooldown;
    __resetInstagramSessionPoolForTests();
  }
}

async function testRotatesToAlternateSession(): Promise<void> {
  const prevCookie = process.env.INSTAGRAM_SESSION_COOKIE;
  const prevCookies = process.env.INSTAGRAM_SESSION_COOKIES;
  __resetInstagramSessionPoolForTests();

  delete process.env.INSTAGRAM_SESSION_COOKIE;
  process.env.INSTAGRAM_SESSION_COOKIES =
    'sessionid=first; csrftoken=firstcsrf, sessionid=second; csrftoken=secondcsrf';

  try {
    const scraper = createGraphQLScraper();
    let callCount = 0;

    (scraper as any).client = {
      defaults: { headers: { common: { Cookie: 'sessionid=first; csrftoken=firstcsrf' } } },
      get: async () => {
        callCount += 1;
        const activeCookie = String((scraper as any).client?.defaults?.headers?.common?.Cookie || '');
        if (activeCookie.includes('sessionid=first')) {
          throw makeAxiosError(429, {
            message: 'Rate limit hit.',
            require_login: false,
            status: 'fail',
          });
        }
        return {
          data: {
            data: {
              user: {
                id: '123',
                username: 'rotated_user',
                full_name: 'Rotated User',
                biography: 'Bio',
                edge_followed_by: { count: 50 },
                edge_follow: { count: 10 },
                is_verified: false,
                is_private: false,
                profile_pic_url: 'https://example.com/pic.jpg',
              },
            },
          },
        };
      },
    };

    const profile = await scraper.scrapeProfile('rotated_user');
    assert(profile.username === 'rotated_user', 'Expected profile fetch to succeed after session rotation');
    assert(callCount === 2, `Expected one retry on alternate session, got ${callCount} attempts`);
  } finally {
    if (typeof prevCookie === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIE;
    else process.env.INSTAGRAM_SESSION_COOKIE = prevCookie;
    if (typeof prevCookies === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIES;
    else process.env.INSTAGRAM_SESSION_COOKIES = prevCookies;
    __resetInstagramSessionPoolForTests();
  }
}

async function testCrossInstanceGateSkipsNetwork(): Promise<void> {
  const prevCookies = process.env.INSTAGRAM_SESSION_COOKIES;
  const prevGateCooldown = process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;
  process.env.INSTAGRAM_SESSION_COOKIES =
    'sessionid=first; csrftoken=firstcsrf, sessionid=second; csrftoken=secondcsrf';
  process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = '180000';
  __resetInstagramSessionPoolForTests();

  try {
    const scraperA = createGraphQLScraper();
    (scraperA as any).client = {
      defaults: { headers: { common: { Cookie: 'sessionid=first; csrftoken=firstcsrf' } } },
      get: async () => {
        throw makeAxiosError(401, {
          message: 'Please wait a few minutes before you try again.',
          require_login: true,
          status: 'fail',
        });
      },
    };

    try {
      await scraperA.scrapeProfile('seed_gate');
    } catch {
      // expected
    }

    assert(getInstagramGlobalGateRemainingMs() > 0, 'Expected global gate to be active after first scraper failure');

    const scraperB = createGraphQLScraper();
    let networkCalls = 0;
    (scraperB as any).client = {
      defaults: { headers: { common: { Cookie: 'sessionid=second; csrftoken=secondcsrf' } } },
      get: async () => {
        networkCalls += 1;
        return { data: {} };
      },
    };

    let caught = '';
    try {
      await scraperB.scrapeProfile('blocked_now');
    } catch (error: any) {
      caught = String(error?.message || '');
    }

    assert(caught.includes('INSTAGRAM_LOGIN_GATE_ACTIVE'), 'Expected second scraper to fail fast on active gate');
    assert(networkCalls === 0, `Expected zero network calls under active gate, got ${networkCalls}`);
  } finally {
    if (typeof prevCookies === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIES;
    else process.env.INSTAGRAM_SESSION_COOKIES = prevCookies;
    if (typeof prevGateCooldown === 'undefined') delete process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;
    else process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = prevGateCooldown;
    __resetInstagramSessionPoolForTests();
  }
}

async function main(): Promise<void> {
  await testSingleCookieStopsRetryLoop();
  await testRotatesToAlternateSession();
  await testCrossInstanceGateSkipsNetwork();
  console.log('instagram-graphql-retry-guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
