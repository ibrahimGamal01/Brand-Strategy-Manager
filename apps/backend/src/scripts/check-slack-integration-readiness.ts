import { loadBackendEnv } from '../lib/load-env';
import { getSlackBootstrapStatus } from '../services/slack/slack-app';

const REQUIRED_ENV = [
  'BACKEND_PUBLIC_ORIGIN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'SLACK_TOKEN_ENCRYPTION_KEY',
];

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function isValidUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return Boolean(url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function run(): void {
  const envLoad = loadBackendEnv();
  const missingEnv = REQUIRED_ENV.filter((name) => !safeString(process.env[name]));
  const backendOrigin = safeString(process.env.BACKEND_PUBLIC_ORIGIN);
  const callbackUrl = backendOrigin ? `${backendOrigin.replace(/\/+$/, '')}/api/slack/oauth/callback` : '';
  const bootstrap = getSlackBootstrapStatus();

  console.log(
    `[SlackConfig] profile=${envLoad.profile} backendEnvOverride=${String(envLoad.backendEnvOverride)} shellOpenAiPreSet=${String(
      envLoad.hadPreexistingOpenAiKey
    )}`
  );
  console.log(`[SlackConfig] requiredEnvPresent=${missingEnv.length === 0} missing=${missingEnv.join(',') || 'none'}`);
  console.log(`[SlackConfig] backendOriginValid=${isValidUrl(backendOrigin)} callbackUrl=${callbackUrl || 'n/a'}`);
  console.log(
    `[SlackConfig] boltEnabled=${bootstrap.enabled} reason=${safeString(bootstrap.reason) || 'none'}`
  );
  console.log('[SlackConfig] installUrlEndpoint=/api/slack/install');
  console.log('[SlackConfig] portalSetupUi=/app/integrations/slack');

  if (missingEnv.length > 0 || !isValidUrl(backendOrigin) || !bootstrap.enabled) {
    process.exit(1);
  }
}

run();
