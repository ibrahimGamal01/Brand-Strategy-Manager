import { IntegrationJob } from '@prisma/client';
import { WebClient } from '@slack/web-api';
import {
  claimNextIntegrationJob,
  enqueueIntegrationJobs,
  markIntegrationJobDone,
  markIntegrationJobFailed,
  markIntegrationJobRetry,
} from './integration-job-queue';
import {
  processSlackBackfillChannelJob,
  processSlackBackfillThreadJob,
  SlackBackfillFollowUp,
  SlackRetryAfterError,
} from '../slack/slack-backfill-service';
import {
  processSlackTriageJob,
  runAttentionReminderScan,
  runWaitingInputScan,
} from '../attention/attention-service';
import {
  getDecryptedSlackBotToken,
  getSlackInstallationByTeam,
  parseSlackInstallationSettings,
} from '../slack/slack-installation-repo';
import { syncSlackChannelsFromApi } from '../slack/slack-channel-service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function followUpsToJobs(followUps: SlackBackfillFollowUp[]) {
  return followUps.map((item) => ({
    type: item.type,
    payload: item.payload,
    runAt: item.runAt,
    researchJobId: typeof item.payload.researchJobId === 'string' ? item.payload.researchJobId : null,
    slackTeamId: typeof item.payload.slackTeamId === 'string' ? item.payload.slackTeamId : null,
  }));
}

async function processSlackSyncChannels(job: IntegrationJob) {
  const slackTeamId = String(job.slackTeamId || '').trim();
  if (!slackTeamId) {
    throw new Error('SLACK_SYNC_CHANNELS requires slackTeamId.');
  }
  const installation = await getSlackInstallationByTeam(slackTeamId);
  if (!installation) {
    throw new Error(`Slack installation not found for team ${slackTeamId}`);
  }
  const token = await getDecryptedSlackBotToken(slackTeamId);
  if (!token) {
    throw new Error(`Slack token missing for team ${slackTeamId}`);
  }
  const settings = parseSlackInstallationSettings(installation.settingsJson);
  const client = new WebClient(token);
  const result = await syncSlackChannelsFromApi({
    slackTeamId,
    client,
    includeDirectMessages: settings.dmIngestionEnabled || settings.mpimIngestionEnabled,
  });
  return result;
}

async function processIntegrationJob(job: IntegrationJob): Promise<void> {
  const payload = asRecord(job.payloadJson);
  switch (job.type) {
    case 'SLACK_SYNC_CHANNELS': {
      await processSlackSyncChannels(job);
      return;
    }
    case 'SLACK_BACKFILL_CHANNEL': {
      const result = await processSlackBackfillChannelJob({
        slackTeamId: String(payload.slackTeamId || job.slackTeamId || '').trim(),
        slackChannelId: String(payload.slackChannelId || '').trim(),
        cursor: String(payload.cursor || '').trim() || null,
      });
      if (result.followUps.length) {
        await enqueueIntegrationJobs(followUpsToJobs(result.followUps) as any);
      }
      return;
    }
    case 'SLACK_BACKFILL_THREAD': {
      const result = await processSlackBackfillThreadJob({
        slackTeamId: String(payload.slackTeamId || job.slackTeamId || '').trim(),
        slackChannelId: String(payload.slackChannelId || '').trim(),
        threadTs: String(payload.threadTs || '').trim(),
        cursor: String(payload.cursor || '').trim() || null,
      });
      if (result.followUps.length) {
        await enqueueIntegrationJobs(followUpsToJobs(result.followUps) as any);
      }
      return;
    }
    case 'SLACK_TRIAGE_MESSAGE': {
      await processSlackTriageJob(payload);
      return;
    }
    case 'ATTENTION_REMINDER_SCAN': {
      await runAttentionReminderScan();
      return;
    }
    case 'BAT_WAITING_INPUT_SCAN': {
      await runWaitingInputScan();
      return;
    }
    default:
      throw new Error(`Unhandled integration job type: ${job.type}`);
  }
}

export async function runIntegrationWorkerBatch(input: {
  workerId: string;
  maxJobs?: number;
}): Promise<{ processed: number; failed: number }> {
  const maxJobs = Math.max(1, Math.min(Number(input.maxJobs || 8), 40));
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < maxJobs; i += 1) {
    const job = await claimNextIntegrationJob(input.workerId);
    if (!job) break;
    try {
      await processIntegrationJob(job);
      await markIntegrationJobDone(job.id);
      processed += 1;
    } catch (error: any) {
      failed += 1;
      if (error instanceof SlackRetryAfterError) {
        await markIntegrationJobRetry(job, error.message, error.retryAfterMs);
      } else {
        await markIntegrationJobFailed(job, String(error?.message || error));
      }
    }
  }

  return { processed, failed };
}
