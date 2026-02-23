import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { createAgentLinkHelpers, type AgentContext } from '../services/ai/chat/agent-context';
import { getTool } from '../services/ai/chat/tools/tool-registry';

async function run(): Promise<void> {
  const suffix = Date.now().toString(36);
  const client = await prisma.client.create({
    data: {
      name: `Evidence Tool Test ${suffix}`,
    },
  });

  try {
    const researchJob = await prisma.researchJob.create({
      data: {
        clientId: client.id,
        status: 'PENDING',
      },
    });

    await prisma.clientAccount.create({
      data: {
        clientId: client.id,
        platform: 'instagram',
        handle: `client_${suffix}`,
      },
    });

    await prisma.discoveredCompetitor.create({
      data: {
        researchJobId: researchJob.id,
        handle: `competitor_${suffix}`,
        platform: 'instagram',
      },
    });

    const clientProfile = await prisma.socialProfile.create({
      data: {
        researchJobId: researchJob.id,
        platform: 'instagram',
        handle: `client_${suffix}`,
      },
    });

    const competitorProfile = await prisma.socialProfile.create({
      data: {
        researchJobId: researchJob.id,
        platform: 'instagram',
        handle: `competitor_${suffix}`,
      },
    });

    await prisma.socialPost.createMany({
      data: [
        {
          socialProfileId: clientProfile.id,
          externalId: `post-client-${suffix}`,
          caption: 'Client post for evidence validation.',
          likesCount: 10,
          commentsCount: 1,
        },
        {
          socialProfileId: competitorProfile.id,
          externalId: `post-competitor-${suffix}`,
          caption: 'Competitor post with stronger engagement.',
          likesCount: 75,
          commentsCount: 15,
        },
      ],
    });

    await prisma.ddgVideoResult.create({
      data: {
        researchJobId: researchJob.id,
        query: 'competitor content',
        title: 'Video evidence sample',
        url: 'https://example.com/video',
        description: 'Video snippet',
      },
    });

    await prisma.ddgNewsResult.create({
      data: {
        researchJobId: researchJob.id,
        query: 'competitor news',
        title: 'News evidence sample',
        url: 'https://example.com/news',
        body: 'News snippet',
      },
    });

    const context: AgentContext = {
      researchJobId: researchJob.id,
      sessionId: `session-${suffix}`,
      userMessage: 'test evidence tools',
      chatRag: {} as AgentContext['chatRag'],
      userContexts: [],
      links: createAgentLinkHelpers('https://brand-strategy-manager-frontend.vercel.app', researchJob.id),
      runtime: {
        nowIso: new Date().toISOString(),
        requestId: `req-${suffix}`,
      },
    };

    const postsTool = getTool('evidence.posts');
    assert.ok(postsTool, 'evidence.posts should be registered');

    const postsResult = await postsTool!.execute(context, {
      includeClient: false,
      includeCompetitors: true,
      sort: 'engagement',
      limit: 5,
    });

    const postItems = Array.isArray(postsResult.items) ? postsResult.items : [];
    assert.equal(postItems.length, 1, 'expected only competitor posts when includeClient=false');
    assert.ok(String(postItems[0].internalLink || '').includes('module=intelligence'));

    const videosTool = getTool('evidence.videos');
    assert.ok(videosTool, 'evidence.videos should be registered');
    const videosResult = await videosTool!.execute(context, { query: 'video evidence', limit: 1 });
    assert.ok(Array.isArray(videosResult.items));
    assert.equal(videosResult.items.length, 1);

    const newsTool = getTool('evidence.news');
    assert.ok(newsTool, 'evidence.news should be registered');
    const newsResult = await newsTool!.execute(context, { query: 'news evidence', limit: 1 });
    assert.ok(Array.isArray(newsResult.items));
    assert.equal(newsResult.items.length, 1);

    console.log('Evidence tool tests passed.');
  } finally {
    await prisma.client.delete({ where: { id: client.id } }).catch(() => undefined);
  }
}

run()
  .catch((error) => {
    console.error('Evidence tool tests failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
