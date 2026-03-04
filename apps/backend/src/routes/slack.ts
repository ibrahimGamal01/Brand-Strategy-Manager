import { Router } from 'express';
import { enqueueIntegrationJob } from '../services/integrations/integration-job-queue';
import { buildSlackInstallUrl, completeSlackOAuthCallback, createSlackInstallState } from '../services/slack/slack-oauth';
import { syncSlackUsersFromApi } from '../services/slack/slack-user-service';

const router = Router();

function getPortalRedirectBase(): string {
  const origin = String(
    process.env.CLIENT_PORTAL_ORIGIN ||
      process.env.APP_ORIGIN ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000'
  )
    .trim()
    .replace(/\/+$/, '');
  return origin;
}

router.get('/install', async (req, res) => {
  try {
    const portalUserId = String(req.query.portalUserId || '').trim() || undefined;
    const state = createSlackInstallState(portalUserId);
    const installUrl = buildSlackInstallUrl(state);
    if (String(req.query.mode || '').trim().toLowerCase() === 'json') {
      return res.json({ ok: true, installUrl });
    }
    return res.redirect(302, installUrl);
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_INSTALL_URL_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.get('/oauth/callback', async (req, res) => {
  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  if (!code || !state) {
    return res.status(400).send('Slack OAuth callback is missing code/state.');
  }

  try {
    const result = await completeSlackOAuthCallback({ code, state });
    await enqueueIntegrationJob({
      type: 'SLACK_SYNC_CHANNELS',
      slackTeamId: result.installation.slackTeamId,
      payload: { slackTeamId: result.installation.slackTeamId },
    });
    void syncSlackUsersFromApi({ slackTeamId: result.installation.slackTeamId }).catch((error: any) => {
      console.warn('[Slack OAuth] Failed to sync Slack users after install:', String(error?.message || error));
    });
    const redirect = `${getPortalRedirectBase()}/app/integrations/slack/setup?status=connected&team=${encodeURIComponent(
      result.installation.slackTeamId
    )}`;
    return res.redirect(302, redirect);
  } catch (error: any) {
    const redirect = `${getPortalRedirectBase()}/app/integrations/slack/setup?status=error&reason=${encodeURIComponent(
      String(error?.message || error)
    )}`;
    return res.redirect(302, redirect);
  }
});

export default router;
