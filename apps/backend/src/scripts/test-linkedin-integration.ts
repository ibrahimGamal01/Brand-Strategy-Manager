import assert from 'node:assert/strict';
import {
  buildLinkedInAuthUrlForTests,
  decodeLinkedInOauthCookieForTests,
  encodeLinkedInOauthCookieForTests,
  getLinkedInCapabilitiesForTests,
  getLinkedInStatusForTests,
} from '../services/portal/portal-linkedin';

async function main() {
  process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY || 'linkedin-test-secret-key';

  const authUrl = buildLinkedInAuthUrlForTests({
    clientId: 'client-123',
    redirectUri: 'http://localhost:3001/api/portal/integrations/linkedin/callback',
    state: 'state-123',
    verifier: 'verifier-abc',
    scopes: ['openid', 'profile', 'email'],
  });

  const parsed = new URL(authUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(parsed.searchParams.get('client_id'), 'client-123');
  assert.equal(parsed.searchParams.get('state'), 'state-123');
  assert.equal(parsed.searchParams.get('scope'), 'openid profile email');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(parsed.searchParams.get('code_challenge'));

  const encoded = encodeLinkedInOauthCookieForTests({
    state: 'state-123',
    codeVerifier: 'verifier-abc',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    createdAt: 123,
  });
  const decoded = decodeLinkedInOauthCookieForTests(encoded);
  assert.deepEqual(decoded, {
    state: 'state-123',
    codeVerifier: 'verifier-abc',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    createdAt: 123,
  });

  assert.equal(getLinkedInStatusForTests({ status: 'active', featureEnabled: true, configured: true }), 'connected');
  assert.equal(getLinkedInStatusForTests({ status: 'syncing', featureEnabled: true, configured: true }), 'syncing');
  assert.equal(getLinkedInStatusForTests({ status: 'error', featureEnabled: true, configured: true }), 'error');
  assert.equal(getLinkedInStatusForTests({ status: 'active', featureEnabled: false, configured: false }), 'unavailable');

  const limitedCapabilities = getLinkedInCapabilitiesForTests(['openid', 'profile', 'email']);
  assert.equal(limitedCapabilities.canFetchIdentity, true);
  assert.equal(limitedCapabilities.canReadPosts, false);
  assert.equal(limitedCapabilities.canReadPostAnalytics, false);
  assert.ok(limitedCapabilities.noticeMessage);

  const fullCapabilities = getLinkedInCapabilitiesForTests([
    'openid',
    'profile',
    'email',
    'r_member_social',
    'r_member_postAnalytics',
  ]);
  assert.equal(fullCapabilities.canReadPosts, true);
  assert.equal(fullCapabilities.canReadPostAnalytics, true);
  assert.equal(fullCapabilities.noticeMessage, undefined);

  console.log('LinkedIn integration helper tests passed');
}

void main();
