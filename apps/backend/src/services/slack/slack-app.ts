import { App, ExpressReceiver } from '@slack/bolt';
import type { Router } from 'express';
import { approveAttentionItemAndReply, dismissAttentionItem, snoozeAttentionItem } from '../attention/attention-service';
import { enqueueIntegrationJob } from '../integrations/integration-job-queue';
import { linkSlackChannelToWorkspace } from './slack-channel-service';
import { reserveSlackEventReceipt } from './slack-event-dedupe';
import {
  getDecryptedSlackBotToken,
  getSlackInstallationByTeam,
  parseSlackInstallationSettings,
} from './slack-installation-repo';
import { ingestSlackMessageEvent } from './slack-message-ingest';

type SlackBootstrap = {
  enabled: boolean;
  reason?: string;
  receiver?: ExpressReceiver;
  app?: App;
};

let runtime: SlackBootstrap | null = null;

function isSlackConfigured(): { ok: boolean; reason?: string } {
  const signingSecret = String(process.env.SLACK_SIGNING_SECRET || '').trim();
  const clientId = String(process.env.SLACK_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SLACK_CLIENT_SECRET || '').trim();
  if (!signingSecret) return { ok: false, reason: 'SLACK_SIGNING_SECRET is missing.' };
  if (!clientId || !clientSecret) return { ok: false, reason: 'Slack OAuth client credentials are missing.' };
  return { ok: true };
}

function parseActionValue(action: any): string {
  return String(action?.value || '').trim();
}

function shouldIngestConversationType(
  channelTypeRaw: unknown,
  settings: { dmIngestionEnabled: boolean; mpimIngestionEnabled: boolean }
): boolean {
  const channelType = String(channelTypeRaw || '').trim().toLowerCase();
  if (channelType === 'im') return settings.dmIngestionEnabled;
  if (channelType === 'mpim') return settings.mpimIngestionEnabled;
  return true;
}

function buildWorkspaceHintMessage(): string {
  return [
    'BAT Slack commands:',
    '`/bat link <workspace-id>` to link this channel to a BAT workspace and trigger full backfill.',
    '`/bat backfill` to restart full history backfill for the current linked workspace.',
  ].join('\n');
}

function buildSlackApp(): SlackBootstrap {
  const configured = isSlackConfigured();
  if (!configured.ok) {
    return {
      enabled: false,
      reason: configured.reason,
    };
  }

  const receiver = new ExpressReceiver({
    signingSecret: String(process.env.SLACK_SIGNING_SECRET || '').trim(),
    processBeforeResponse: true,
    endpoints: {
      events: '/api/slack/events',
      commands: '/api/slack/commands',
      actions: '/api/slack/interactive',
    },
  });

  const app = new App({
    receiver,
    authorize: async ({ teamId }) => {
      const resolvedTeamId = String(teamId || '').trim();
      if (!resolvedTeamId) throw new Error('Missing Slack team id.');
      const installation = await getSlackInstallationByTeam(resolvedTeamId);
      if (!installation || installation.status !== 'ACTIVE') {
        throw new Error(`No active Slack installation for team ${resolvedTeamId}`);
      }
      const botToken = await getDecryptedSlackBotToken(resolvedTeamId);
      if (!botToken) throw new Error(`Slack bot token unavailable for team ${resolvedTeamId}`);
      return {
        botToken,
        botUserId: installation.botUserId,
      };
    },
  });

  app.command('/bat', async ({ ack, body, respond }) => {
    await ack();
    const text = String(body.text || '').trim();
    const channelId = String(body.channel_id || '').trim();
    const slackTeamId = String(body.team_id || '').trim();
    if (!channelId || !slackTeamId) {
      await respond({ response_type: 'ephemeral', text: 'Could not resolve Slack channel/team metadata.' });
      return;
    }

    if (!text) {
      await respond({ response_type: 'ephemeral', text: buildWorkspaceHintMessage() });
      return;
    }

    const [command, ...rest] = text.split(/\s+/);
    if (command === 'link') {
      const researchJobId = String(rest[0] || '').trim();
      if (!researchJobId) {
        await respond({ response_type: 'ephemeral', text: 'Usage: `/bat link <workspace-id>`' });
        return;
      }
      try {
        await linkSlackChannelToWorkspace({
          slackTeamId,
          slackChannelId: channelId,
          researchJobId,
          enabled: true,
        });
        await enqueueIntegrationJob({
          type: 'SLACK_BACKFILL_CHANNEL',
          slackTeamId,
          researchJobId,
          payload: { slackTeamId, slackChannelId: channelId },
        });
        await respond({
          response_type: 'ephemeral',
          text: `Linked this channel to workspace \`${researchJobId}\` and queued full-history backfill.`,
        });
      } catch (error: any) {
        await respond({
          response_type: 'ephemeral',
          text: `Failed to link workspace: ${String(error?.message || error)}`,
        });
      }
      return;
    }

    if (command === 'backfill') {
      await enqueueIntegrationJob({
        type: 'SLACK_BACKFILL_CHANNEL',
        slackTeamId,
        payload: { slackTeamId, slackChannelId: channelId },
      });
      await respond({
        response_type: 'ephemeral',
        text: 'Queued full-history backfill for this channel.',
      });
      return;
    }

    await respond({ response_type: 'ephemeral', text: buildWorkspaceHintMessage() });
  });

  app.event('message', async ({ event, body, logger }) => {
    const eventAny = event as any;
    const slackTeamId = String((body as any).team_id || (body as any).team?.id || eventAny.team || '').trim();
    const eventId = String((body as any).event_id || '').trim();
    if (!slackTeamId || !eventId) return;
    const installation = await getSlackInstallationByTeam(slackTeamId);
    if (!installation || installation.status !== 'ACTIVE') return;
    const settings = parseSlackInstallationSettings(installation.settingsJson);
    const channelType = String(eventAny.channel_type || (body as any)?.event?.channel_type || '').trim().toLowerCase();
    if (!shouldIngestConversationType(channelType, settings)) return;

    const reserved = await reserveSlackEventReceipt({
      slackTeamId,
      eventId,
      eventType: String((body as any).event?.type || 'message'),
      payload: {
        subtype: String(eventAny.subtype || ''),
        channel: String(eventAny.channel || ''),
      },
    });
    if (!reserved) return;
    if (eventAny.subtype === 'bot_message') return;

    try {
      const result = await ingestSlackMessageEvent({
        slackTeamId,
        rawEvent: eventAny as Record<string, unknown>,
      });
      if (result.message?.id && result.shouldTriage) {
        await enqueueIntegrationJob({
          type: 'SLACK_TRIAGE_MESSAGE',
          slackTeamId,
          researchJobId: result.message.researchJobId || null,
          payload: { slackMessageId: result.message.id },
        });
      }
    } catch (error: any) {
      logger.error(`Failed to process Slack message event: ${error?.message || error}`);
    }
  });

  app.action('attention_approve', async ({ ack, body, action, respond }) => {
    await ack();
    const attentionItemId = parseActionValue(action);
    const actorSlackUserId = String((body as any).user?.id || '').trim();
    try {
      await approveAttentionItemAndReply({
        attentionItemId,
        actorSlackUserId,
      });
      await respond({ response_type: 'ephemeral', text: 'Draft approved and posted to Slack thread.' });
    } catch (error: any) {
      await respond({ response_type: 'ephemeral', text: `Approval failed: ${String(error?.message || error)}` });
    }
  });

  app.action('attention_snooze', async ({ ack, action, respond }) => {
    await ack();
    const attentionItemId = parseActionValue(action);
    await snoozeAttentionItem({ attentionItemId });
    await respond({ response_type: 'ephemeral', text: 'Snoozed for 4 hours.' });
  });

  app.action('attention_dismiss', async ({ ack, action, respond }) => {
    await ack();
    const attentionItemId = parseActionValue(action);
    await dismissAttentionItem({ attentionItemId });
    await respond({ response_type: 'ephemeral', text: 'Dismissed.' });
  });

  app.action('attention_edit', async ({ ack, body, action, client, respond }) => {
    await ack();
    const attentionItemId = parseActionValue(action);
    const triggerId = String((body as any).trigger_id || '').trim();
    if (!attentionItemId || !triggerId) {
      await respond({ response_type: 'ephemeral', text: 'Could not open editor for this draft.' });
      return;
    }

    try {
      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'attention_edit_submit',
          private_metadata: attentionItemId,
          title: {
            type: 'plain_text',
            text: 'Edit draft reply',
          },
          submit: {
            type: 'plain_text',
            text: 'Send',
          },
          close: {
            type: 'plain_text',
            text: 'Cancel',
          },
          blocks: [
            {
              type: 'input',
              block_id: 'reply_block',
              label: {
                type: 'plain_text',
                text: 'Reply',
              },
              element: {
                type: 'plain_text_input',
                action_id: 'reply_text',
                multiline: true,
              },
            },
          ],
        } as any,
      });
    } catch (error: any) {
      await respond({
        response_type: 'ephemeral',
        text: `Failed to open edit modal: ${String(error?.message || error)}`,
      });
    }
  });

  app.view('attention_edit_submit', async ({ ack, body, view }) => {
    const attentionItemId = String(view.private_metadata || '').trim();
    const actorSlackUserId = String((body as any).user?.id || '').trim();
    const values = (view.state?.values || {}) as Record<string, Record<string, { value?: string }>>;
    const replyText = String(values.reply_block?.reply_text?.value || '').trim();
    if (!attentionItemId || !replyText) {
      await ack({
        response_action: 'errors',
        errors: {
          reply_block: 'Reply text is required.',
        },
      });
      return;
    }

    try {
      await approveAttentionItemAndReply({
        attentionItemId,
        actorSlackUserId,
        overrideReplyText: replyText,
      });
      await ack({
        response_action: 'clear',
      });
    } catch (error: any) {
      await ack({
        response_action: 'errors',
        errors: {
          reply_block: String(error?.message || 'Failed to post reply.'),
        },
      });
    }
  });

  return {
    enabled: true,
    receiver,
    app,
  };
}

function ensureSlackRuntime(): SlackBootstrap {
  if (runtime) return runtime;
  runtime = buildSlackApp();
  if (runtime.enabled) {
    console.log('[Slack] Bolt receiver initialized.');
  } else {
    console.warn(`[Slack] Integration disabled: ${runtime.reason}`);
  }
  return runtime;
}

export function getSlackReceiverRouter(): Router | null {
  const resolved = ensureSlackRuntime();
  if (!resolved.enabled || !resolved.receiver) return null;
  return resolved.receiver.router;
}

export function getSlackBootstrapStatus() {
  const resolved = ensureSlackRuntime();
  return {
    enabled: resolved.enabled,
    reason: resolved.reason || null,
  };
}
