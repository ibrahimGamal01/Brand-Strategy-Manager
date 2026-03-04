import crypto from 'node:crypto';
import { WebClient } from '@slack/web-api';
import { upsertSlackInstallationFromOAuth, upsertSlackUserLink } from './slack-installation-repo';

type SlackInstallStatePayload = {
  portalUserId?: string;
  nonce: string;
  issuedAt: number;
};

const DEFAULT_BOT_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'chat:write',
  'users:read',
  'users:read.email',
  'commands',
];

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for Slack integration.`);
  return value;
}

function getBaseOrigin(): string {
  return String(process.env.BACKEND_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
}

function getRedirectUri(): string {
  const origin = getBaseOrigin();
  if (!origin) {
    throw new Error('BACKEND_PUBLIC_ORIGIN must be set for Slack OAuth.');
  }
  return `${origin}/api/slack/oauth/callback`;
}

function getStateSecret(): string {
  return String(process.env.SLACK_STATE_SECRET || process.env.RUNTIME_WS_SIGNING_SECRET || '').trim();
}

function stateSignature(payload: string): string {
  const secret = getStateSecret();
  if (!secret) {
    throw new Error('SLACK_STATE_SECRET or RUNTIME_WS_SIGNING_SECRET is required for Slack OAuth state.');
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 20);
}

function encodeState(payload: SlackInstallStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = stateSignature(body);
  return `${body}.${signature}`;
}

function decodeState(raw: string): SlackInstallStatePayload {
  const value = String(raw || '').trim();
  const [body, signature] = value.split('.');
  if (!body || !signature) throw new Error('Invalid OAuth state.');
  if (stateSignature(body) !== signature) throw new Error('Invalid OAuth state signature.');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SlackInstallStatePayload;
  const issuedAt = Number(parsed?.issuedAt || 0);
  const ageMs = Date.now() - issuedAt;
  if (!Number.isFinite(issuedAt) || ageMs < -60_000 || ageMs > 15 * 60_000) {
    throw new Error('Slack OAuth state expired.');
  }
  return parsed;
}

function resolveScopes(): string[] {
  const explicit = String(process.env.SLACK_BOT_SCOPES || '').trim();
  if (!explicit) return DEFAULT_BOT_SCOPES;
  return Array.from(
    new Set(
      explicit
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

export function createSlackInstallState(portalUserId?: string | null): string {
  return encodeState({
    portalUserId: portalUserId ? String(portalUserId).trim() : undefined,
    nonce: crypto.randomUUID(),
    issuedAt: Date.now(),
  });
}

export function buildSlackInstallUrl(state: string): string {
  const clientId = requireEnv('SLACK_CLIENT_ID');
  const scopes = resolveScopes().join(',');
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: getRedirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function completeSlackOAuthCallback(input: {
  code: string;
  state: string;
}) {
  const statePayload = decodeState(input.state);
  const clientId = requireEnv('SLACK_CLIENT_ID');
  const clientSecret = requireEnv('SLACK_CLIENT_SECRET');
  const redirectUri = getRedirectUri();
  const client = new WebClient();

  const result = await client.oauth.v2.access({
    client_id: clientId,
    client_secret: clientSecret,
    code: input.code,
    redirect_uri: redirectUri,
  });

  const teamId = String(result.team?.id || '').trim();
  const teamName = String(result.team?.name || '').trim() || null;
  const accessToken = String(result.access_token || '').trim();
  const botUserId = String(result.bot_user_id || '').trim();
  const installedBySlackUserId = String(result.authed_user?.id || '').trim();
  if (!teamId || !accessToken || !botUserId || !installedBySlackUserId) {
    throw new Error('Slack OAuth response was missing team/token metadata.');
  }

  const scopes = String(result.scope || '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  const installation = await upsertSlackInstallationFromOAuth({
    slackTeamId: teamId,
    enterpriseId: String(result.enterprise?.id || '').trim() || null,
    teamName,
    botUserId,
    botToken: accessToken,
    botScopes: scopes,
    installedBySlackUserId,
    installedByPortalUserId: statePayload.portalUserId || null,
  });

  await upsertSlackUserLink({
    slackTeamId: teamId,
    slackUserId: installedBySlackUserId,
    ...(statePayload.portalUserId ? { portalUserId: statePayload.portalUserId } : {}),
  });

  return {
    installation,
    statePayload,
  };
}
