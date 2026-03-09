import {
  __enrichInstagramProfileMetadataForTest,
  InstagramProfileData,
} from '../services/scraper/instagram-service';
import {
  __resetInstagramSessionPoolForTests,
  acquireInstagramSession,
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
  const prevGateCooldown = process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;

  process.env.INSTAGRAM_SESSION_COOKIES = 'sessionid=test; csrftoken=testcsrf';
  delete process.env.INSTAGRAM_SESSION_COOKIE;
  process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = '120000';
  __resetInstagramSessionPoolForTests();

  const session = acquireInstagramSession();
  if (!session) {
    throw new Error('Expected a test session from env');
  }
  recordInstagramSessionFailure(session.id, 'LOGIN_GATE');

  let graphQLCalls = 0;
  let htmlCalls = 0;

  try {
    const payload: InstagramProfileData = {
      handle: 'test_handle',
      follower_count: 0,
      following_count: 0,
      bio: '',
      profile_pic: '',
      is_verified: false,
      is_private: false,
      total_posts: 0,
      posts: [],
      discovered_competitors: [],
    };

    const enriched = await __enrichInstagramProfileMetadataForTest('test_handle', payload, {
      createGraphQLScraperFn: (() => {
        graphQLCalls += 1;
        return {
          scrapeProfile: async () => {
            throw new Error('GraphQL should be skipped while gate is active');
          },
        } as any;
      }) as any,
      scrapeMetadataViaPublicHtmlFn: async () => {
        htmlCalls += 1;
        return {
          follower_count: 321,
          following_count: 42,
          total_posts: 12,
          bio: 'Recovered from HTML',
          profile_pic: 'https://cdn.example.com/pic.jpg',
          is_verified: false,
          is_private: false,
        };
      },
    });

    assert(graphQLCalls === 0, `Expected GraphQL enrichment to be skipped, got ${graphQLCalls} calls`);
    assert(htmlCalls > 0, 'Expected HTML fallback enrichment to run');
    assert(enriched.follower_count === 321, `Expected follower_count=321, got ${enriched.follower_count}`);
    assert(enriched.following_count === 42, `Expected following_count=42, got ${enriched.following_count}`);
    assert(enriched.total_posts === 12, `Expected total_posts=12, got ${enriched.total_posts}`);
    assert(enriched.bio === 'Recovered from HTML', `Expected HTML bio enrichment, got: ${enriched.bio}`);

    console.log('instagram-service-graphql-cooldown tests passed');
  } finally {
    if (typeof prevCookies === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIES;
    else process.env.INSTAGRAM_SESSION_COOKIES = prevCookies;
    if (typeof prevCookie === 'undefined') delete process.env.INSTAGRAM_SESSION_COOKIE;
    else process.env.INSTAGRAM_SESSION_COOKIE = prevCookie;
    if (typeof prevGateCooldown === 'undefined') delete process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS;
    else process.env.INSTAGRAM_GLOBAL_LOGIN_GATE_COOLDOWN_MS = prevGateCooldown;
    __resetInstagramSessionPoolForTests();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
