import { AxiosError } from 'axios';
import { createGraphQLScraper } from '../services/scraper/instagram-graphql';

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
      statusText: status === 401 ? 'Unauthorized' : 'Too Many Requests',
      headers: {},
      config: { headers: {} } as any,
      data,
    } as any
  );
}

async function testSingleCookieStopsRetryLoop(): Promise<void> {
  const prevCookie = process.env.INSTAGRAM_SESSION_COOKIE;
  const prevCookies = process.env.INSTAGRAM_SESSION_COOKIES;

  process.env.INSTAGRAM_SESSION_COOKIE = 'sessionid=single; csrftoken=singlecsrf';
  delete process.env.INSTAGRAM_SESSION_COOKIES;

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

    assert(caughtError.includes('temporarily blocked'), `Expected login gate error, got: ${caughtError}`);
    assert(callCount === 1, `Expected one request attempt, got ${callCount}`);
  } finally {
    if (typeof prevCookie === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIE;
    else process.env.INSTAGRAM_SESSION_COOKIE = prevCookie;
    if (typeof prevCookies === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIES;
    else process.env.INSTAGRAM_SESSION_COOKIES = prevCookies;
  }
}

async function testRotatesToAlternateSession(): Promise<void> {
  const prevCookie = process.env.INSTAGRAM_SESSION_COOKIE;
  const prevCookies = process.env.INSTAGRAM_SESSION_COOKIES;

  delete process.env.INSTAGRAM_SESSION_COOKIE;
  process.env.INSTAGRAM_SESSION_COOKIES =
    'sessionid=first; csrftoken=firstcsrf,sessionid=second; csrftoken=secondcsrf';

  try {
    const scraper = createGraphQLScraper();
    let callCount = 0;

    (scraper as any).client = {
      defaults: { headers: { common: { Cookie: 'sessionid=first; csrftoken=firstcsrf' } } },
      get: async () => {
        callCount += 1;
        const activeCookie = String((scraper as any).client?.defaults?.headers?.common?.Cookie || '');
        if (activeCookie.includes('sessionid=first')) {
          throw makeAxiosError(401, {
            message: 'Please wait a few minutes before you try again.',
            require_login: true,
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
  }
}

async function main(): Promise<void> {
  await testSingleCookieStopsRetryLoop();
  await testRotatesToAlternateSession();
  console.log('instagram-graphql-retry-guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
