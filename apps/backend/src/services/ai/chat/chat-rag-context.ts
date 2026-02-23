import { prisma } from '../../../lib/prisma';
import { getFullResearchContext, type ResearchContext } from '../rag';
import { findLatestDesignSelections } from '../../chat/chat-repository';
import type { ChatBlock } from '../../chat/chat-types';

export type ChatRagContext = {
  researchContext: ResearchContext;
  researchContextText: string;
  recentMessages: Array<{ role: string; content: string; createdAt: Date }>;
  historySummary: string | null;
  pinnedBlocks: Array<{ blockId: string; messageId: string; blockData: ChatBlock }>;
  viewedBlocks: Array<{ blockId: string; messageId: string; payload?: Record<string, unknown> | null }>;
  selectedDesigns: Array<{ messageId: string; designId: string }>;
  recentAttachments: Array<{ id: string; recordType: string | null; recordId: string | null; aiSummary: string | null; isAppScreenshot: boolean }>;
  sourceHandles: string[];
};

const MAX_HISTORY = 12;
const MAX_HISTORY_POOL = 40;
const MAX_PINNED = 12;
const MAX_VIEWED = 16;
const MAX_ATTACHMENTS = 12;
const MAX_CONTEXT_CHARS = 7000;

function buildSourceHandles(context: ResearchContext): string[] {
  const handles: string[] = ['business_profile', 'brain_profile', 'ai_insights', 'competitor_context'];
  if (context.contentIntelligence) handles.push('content_intelligence');
  if (context.mediaAnalysis?.hasData) handles.push('media_analysis');
  if (context.socialData?.posts?.length) handles.push('social_posts');
  if (context.socialData?.topPosts?.length) handles.push('top_posts');
  if (context.community?.insights?.length) handles.push('community_insights');
  if (context.community?.searchTrends?.length) handles.push('search_trends');
  return handles;
}

function summarizeBlock(block: ChatBlock): string {
  const title = block.title ? ` - ${block.title}` : '';
  if (block.type === 'table' && Array.isArray(block.columns)) {
    return `table${title} (${block.columns.length} cols, ${Array.isArray(block.rows) ? block.rows.length : 0} rows)`;
  }
  if (block.type === 'metric_cards' && Array.isArray(block.cards)) {
    return `metric_cards${title} (${block.cards.length} cards)`;
  }
  if (block.type === 'comparison') {
    return `comparison${title}`;
  }
  if (block.type === 'post_grid') {
    return `post_grid${title}`;
  }
  if (block.type === 'insight') {
    return `insight${title}`;
  }
  if (block.type === 'source_list') {
    return `source_list${title}`;
  }
  return `${block.type || 'block'}${title}`;
}

function compact(value: unknown, fallback = 'n/a'): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (text.length <= 140) return text;
  return `${text.slice(0, 137)}...`;
}

function formatCompetitorRows(context: ResearchContext): string {
  const rows = (context.competitors?.all10 || []) as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return '- none';
  return rows
    .slice(0, 8)
    .map((row, index) => {
      const handle = row?.handle ? `@${row.handle}` : 'unknown';
      const platform = compact(row?.platform, 'unknown');
      const followers = row?.followers ? Number(row.followers).toLocaleString() : 'unknown';
      const posts = compact(row?.postingFreq, 'unknown');
      const engagement = compact(row?.engagement, 'unknown');
      return `${index + 1}) ${handle} | ${platform} | followers=${followers} | posts/week=${posts} | engagement=${engagement}`;
    })
    .join('\n');
}

function formatTrends(context: ResearchContext): string {
  const trends = (context.community?.searchTrends || []) as Array<Record<string, unknown>>;
  if (!trends.length) return '- none';
  return trends
    .slice(0, 6)
    .map((trend, index) => `${index + 1}) ${compact(trend?.keyword || trend?.query || trend?.name)}`)
    .join('\n');
}

function formatCommunity(context: ResearchContext): string {
  const insights = (context.community?.insights || []) as Array<Record<string, unknown>>;
  if (!insights.length) return '- none';
  return insights
    .slice(0, 4)
    .map((item, index) => `${index + 1}) ${compact(item?.title || item?.source || 'insight')}: ${compact(item?.summary || item?.content || '')}`)
    .join('\n');
}

function formatWarnings(context: ResearchContext): string {
  const warnings = context.warnings || [];
  if (!warnings.length) return '- none';
  return warnings.slice(0, 4).map((warning) => `- ${compact(warning, '')}`).join('\n');
}

function formatChatResearchContext(context: ResearchContext): string {
  const businessName = compact(context.business?.name);
  const businessHandle = compact(context.business?.handle);
  const website = compact(context.business?.website || context.brainProfile?.websiteDomain);
  const primaryGoal = compact(context.brainProfile?.primaryGoal);
  const targetMarket = compact(context.brainProfile?.targetMarket);
  const channels = Array.isArray(context.brainProfile?.channels)
    ? context.brainProfile.channels
      .slice(0, 4)
      .map((entry) => `${compact(entry?.platform)}/${compact(entry?.handle)}`)
      .join(', ')
    : 'n/a';

  let output = `# Research Snapshot
Business: ${businessName}
Handle: ${businessHandle}
Website: ${website}
Primary Goal: ${primaryGoal}
Target Market: ${targetMarket}
Channels: ${channels}

Competitor Metrics (verified):
${formatCompetitorRows(context)}

Search Trends:
${formatTrends(context)}

Community Signals:
${formatCommunity(context)}

Data Quality: ${Number(context.overallQuality?.score || 0).toFixed(1)}/100
Warnings:
${formatWarnings(context)}
`;

  if (output.length > MAX_CONTEXT_CHARS) {
    output = `${output.slice(0, MAX_CONTEXT_CHARS)}\n...`;
  }
  return output;
}

export async function buildChatRagContext(researchJobId: string, sessionId: string): Promise<ChatRagContext> {
  const researchContext = await getFullResearchContext(researchJobId);
  const researchContextText = formatChatResearchContext(researchContext);

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_POOL,
  });
  const messageIds = messages.map((m) => m.id);
  const chronological = [...messages].reverse();
  const recentMessages = chronological.slice(-MAX_HISTORY).map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));

  const historySummary =
    chronological.length > MAX_HISTORY
      ? chronological
          .slice(0, Math.max(0, chronological.length - MAX_HISTORY))
          .map((message) => `${message.role}: ${String(message.content).slice(0, 180)}`)
          .join(' | ')
          .slice(0, 1200)
      : null;

  const pinnedBlocks = await prisma.chatSavedBlock.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: MAX_PINNED,
  });

  const viewedBlocks = await prisma.chatBlockEvent.findMany({
    where: { sessionId, eventType: 'VIEW' },
    orderBy: { createdAt: 'desc' },
    take: MAX_VIEWED,
  });

  const attachments = await prisma.screenshotAttachment.findMany({
    where: { chatMessageId: { in: messageIds } },
    orderBy: { createdAt: 'desc' },
    take: MAX_ATTACHMENTS,
  });

  const designSelections = await findLatestDesignSelections(sessionId);

  const selectedDesigns = Array.from(designSelections.entries()).map(([messageId, designId]) => ({
    messageId,
    designId,
  }));

  return {
    researchContext,
    researchContextText,
    recentMessages,
    historySummary,
    pinnedBlocks: pinnedBlocks.map((block) => ({
      blockId: block.blockId,
      messageId: block.messageId,
      blockData: block.blockData as ChatBlock,
    })),
    viewedBlocks: viewedBlocks.map((event) => ({
      blockId: event.blockId,
      messageId: event.messageId,
      payload: (event.payload as Record<string, unknown>) || null,
    })),
    selectedDesigns,
    recentAttachments: attachments.map((att) => ({
      id: att.id,
      recordType: att.recordType,
      recordId: att.recordId,
      aiSummary: (att.aiSummary as string) || null,
      isAppScreenshot: Boolean(att.isAppScreenshot),
    })),
    sourceHandles: buildSourceHandles(researchContext),
  };
}

export function formatChatContextForLLM(context: ChatRagContext): string {
  let output = `${context.researchContextText}\n\n`;

  output += `---\n## Recent Chat History\n`;
  if (context.historySummary) {
    output += `Summary of earlier messages: ${context.historySummary}\n\n`;
  }
  if (context.recentMessages.length === 0) {
    output += `No previous messages.\n\n`;
  } else {
    context.recentMessages.forEach((message, index) => {
      output += `${index + 1}. [${message.role}] ${message.content}\n`;
    });
    output += '\n';
  }

  output += `## Pinned Blocks (Saved by user)\n`;
  if (context.pinnedBlocks.length === 0) {
    output += `None.\n\n`;
  } else {
    context.pinnedBlocks.forEach((block, index) => {
      output += `${index + 1}. ${block.blockId}: ${summarizeBlock(block.blockData)}\n`;
    });
    output += '\n';
  }

  output += `## Recently Viewed Blocks\n`;
  if (context.viewedBlocks.length === 0) {
    output += `None.\n\n`;
  } else {
    context.viewedBlocks.forEach((event, index) => {
      const note =
        typeof event.payload?.title === 'string'
          ? ` (${event.payload?.title})`
          : typeof event.payload?.type === 'string'
            ? ` (${event.payload?.type})`
            : '';
      output += `${index + 1}. ${event.blockId}${note}\n`;
    });
    output += '\n';
  }

  output += `## Selected Design Choices\n`;
  if (context.selectedDesigns.length === 0) {
    output += `None.\n\n`;
  } else {
    context.selectedDesigns.forEach((selection, index) => {
      output += `${index + 1}. Message ${selection.messageId} -> Design ${selection.designId}\n`;
    });
    output += '\n';
  }

  output += `## Allowed Source Handles\n`;
  output += context.sourceHandles.map((handle) => `- ${handle}`).join('\n');
  output += '\n';

  output += `\n## Recent Screenshot Attachments\n`;
  if (context.recentAttachments.length === 0) {
    output += 'None.\n';
  } else {
    context.recentAttachments.forEach((att, idx) => {
      const parts = [
        att.recordType ? `${att.recordType}:${att.recordId || 'unknown'}` : 'external_image',
        att.isAppScreenshot ? 'app_screenshot' : 'uploaded',
      ];
      if (att.aiSummary) parts.push(`summary: ${att.aiSummary.slice(0, 140)}`);
      output += `${idx + 1}. ${parts.join(' | ')}\n`;
    });
  }
  output += '\n';

  return output;
}
