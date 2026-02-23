import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { createAgentLinkHelpers, type AgentContext } from '../services/ai/chat/agent-context';
import { getTool } from '../services/ai/chat/tools/tool-registry';

async function run(): Promise<void> {
  const suffix = Date.now().toString(36);
  const client = await prisma.client.create({ data: { name: `Mutation Apply Undo ${suffix}` } });

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
        title: 'Mutation Apply/Undo Session',
      },
    });

    const competitor = await prisma.discoveredCompetitor.create({
      data: {
        researchJobId: researchJob.id,
        handle: `apply_target_${suffix}`,
        platform: 'instagram',
        selectionState: 'SHORTLISTED',
      },
    });

    const context: AgentContext = {
      researchJobId: researchJob.id,
      sessionId: session.id,
      userMessage: 'apply mutation',
      chatRag: {} as AgentContext['chatRag'],
      userContexts: [],
      links: createAgentLinkHelpers('https://brand-strategy-manager-frontend.vercel.app', researchJob.id),
      runtime: {
        nowIso: new Date().toISOString(),
        requestId: `req-${suffix}`,
      },
    };

    const stageTool = getTool('intel.stageMutation');
    const applyTool = getTool('intel.applyMutation');
    const undoTool = getTool('intel.undoMutation');
    assert.ok(stageTool && applyTool && undoTool, 'Mutation tools should be registered');

    const preview = await stageTool!.execute(context, {
      section: 'competitors',
      kind: 'update',
      where: { id: competitor.id },
      data: { selectionState: 'REJECTED', selectionReason: 'Out of scope' },
    });

    assert.ok(typeof preview.confirmToken === 'string' && preview.confirmToken.length > 20);

    const applied = await applyTool!.execute(context, {
      mutationId: String(preview.mutationId),
      confirmToken: String(preview.confirmToken),
    });

    assert.equal(applied.changedCount, 1);
    assert.ok(typeof applied.undoToken === 'string' && applied.undoToken.length > 20);

    const afterApply = await prisma.discoveredCompetitor.findUnique({ where: { id: competitor.id } });
    assert.equal(afterApply?.selectionState, 'REJECTED');

    const undone = await undoTool!.execute(context, {
      mutationId: String(preview.mutationId),
      undoToken: String(applied.undoToken),
    });

    assert.equal(undone.restoredCount, 1);

    const afterUndo = await prisma.discoveredCompetitor.findUnique({ where: { id: competitor.id } });
    assert.equal(afterUndo?.selectionState, 'SHORTLISTED');

    console.log('Chat mutation apply/undo tests passed.');
  } finally {
    await prisma.client.delete({ where: { id: client.id } }).catch(() => undefined);
  }
}

run()
  .catch((error) => {
    console.error('Chat mutation apply/undo tests failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
