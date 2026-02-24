import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { createAgentLinkHelpers, type AgentContext } from '../services/ai/chat/agent-context';
import { getTool } from '../services/ai/chat/tools/tool-registry';

async function run(): Promise<void> {
  const suffix = Date.now().toString(36);
  const client = await prisma.client.create({ data: { name: `Mutation Test ${suffix}` } });

  try {
    const researchJob = await prisma.researchJob.create({
      data: {
        clientId: client.id,
        status: 'PENDING',
      },
    });

    const session = await prisma.chatSession.create({
      data: {
        researchJobId: researchJob.id,
        title: 'Mutation Test Session',
      },
    });

    await prisma.discoveredCompetitor.createMany({
      data: [
        {
          researchJobId: researchJob.id,
          handle: `target_${suffix}`,
          platform: 'instagram',
        },
        {
          researchJobId: researchJob.id,
          handle: `other_${suffix}`,
          platform: 'instagram',
        },
      ],
    });

    const context: AgentContext = {
      researchJobId: researchJob.id,
      sessionId: session.id,
      userMessage: 'stage mutations',
      chatRag: {} as AgentContext['chatRag'],
      userContexts: [],
      links: createAgentLinkHelpers('https://brand-strategy-manager-frontend.vercel.app', researchJob.id),
      runtime: {
        nowIso: new Date().toISOString(),
        requestId: `req-${suffix}`,
      },
    };

    const stageTool = getTool('intel.stageMutation');
    assert.ok(stageTool, 'intel.stageMutation should be registered');

    const preview = await stageTool!.execute(context, {
      section: 'competitors',
      kind: 'update',
      where: { handle: `target_${suffix}` },
      data: { selectionState: 'REJECTED', selectionReason: 'Not relevant' },
    });

    assert.ok(typeof preview.mutationId === 'string' && preview.mutationId.length > 10);
    assert.equal(preview.section, 'competitors');
    assert.equal(preview.kind, 'update');
    assert.equal(preview.matchedCount, 1);
    assert.ok(Array.isArray(preview.beforeSample));
    assert.ok(Array.isArray(preview.afterSample));

    const stored = await prisma.chatMutation.findUnique({ where: { id: String(preview.mutationId) } });
    assert.ok(stored, 'staged mutation should be persisted');
    assert.equal(stored?.researchJobId, researchJob.id);

    const deletePreview = await stageTool!.execute(context, {
      section: 'competitors',
      kind: 'delete',
      where: { handle: `missing_${suffix}` },
    });
    const warnings = Array.isArray(deletePreview.warnings) ? deletePreview.warnings.join(' ') : '';
    assert.ok(warnings.includes('No records matched'));

    const webPreview = await stageTool!.execute(context, {
      section: 'web_sources',
      kind: 'create',
      data: {
        url: `https://example-${suffix}.com`,
        sourceType: 'CLIENT_SITE',
        discoveredBy: 'CHAT_TOOL',
      },
    });
    assert.equal(webPreview.section, 'web_sources');
    assert.equal(webPreview.kind, 'create');
    assert.equal(webPreview.matchedCount, 0);

    console.log('Chat mutation staging tests passed.');
  } finally {
    await prisma.client.delete({ where: { id: client.id } }).catch(() => undefined);
  }
}

run()
  .catch((error) => {
    console.error('Chat mutation staging tests failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
