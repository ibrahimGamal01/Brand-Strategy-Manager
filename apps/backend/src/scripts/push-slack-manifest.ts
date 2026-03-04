import { WebClient } from '@slack/web-api';
import { loadBackendEnv } from '../lib/load-env';
import { buildSlackManifestBundle } from '../services/slack/slack-manifest';

function safeString(value: unknown): string {
  return String(value || '').trim();
}

async function run() {
  loadBackendEnv();
  const token = safeString(process.env.SLACK_ADMIN_USER_TOKEN || process.env.SLACK_MANIFEST_PUSH_TOKEN);
  if (!token) {
    throw new Error('SLACK_ADMIN_USER_TOKEN (or SLACK_MANIFEST_PUSH_TOKEN) is required to push manifest.');
  }

  const appId = safeString(process.env.SLACK_APP_ID);
  const teamId = safeString(process.env.SLACK_MANIFEST_TEAM_ID);
  const client = new WebClient(token);
  const bundle = buildSlackManifestBundle();
  const manifestRaw = JSON.stringify(bundle.manifest);

  if (bundle.warnings.length > 0) {
    console.warn(`[SlackManifestPush] warnings: ${bundle.warnings.join(' | ')}`);
  }

  if (appId) {
    const response = await client.apiCall('apps.manifest.update', {
      app_id: appId,
      manifest: manifestRaw,
      ...(teamId ? { team_id: teamId } : {}),
    });
    console.log(
      `[SlackManifestPush] updated app_id=${appId} ok=${String((response as any)?.ok === true)}`
    );
    return;
  }

  const response = await client.apiCall('apps.manifest.create', {
    manifest: manifestRaw,
      ...(teamId ? { team_id: teamId } : {}),
  });
  const createdAppId =
    safeString((response as any)?.app_id) ||
    safeString((response as any)?.app?.id) ||
    safeString((response as any)?.app?.app_id);

  console.log(
    `[SlackManifestPush] created app_id=${createdAppId || 'unknown'} ok=${String((response as any)?.ok === true)}`
  );
  if (createdAppId) {
    console.log('[SlackManifestPush] set SLACK_APP_ID in env to enable future updates in-place.');
  }
}

run().catch((error: any) => {
  console.error(`[SlackManifestPush] failed: ${String(error?.message || error)}`);
  process.exit(1);
});
