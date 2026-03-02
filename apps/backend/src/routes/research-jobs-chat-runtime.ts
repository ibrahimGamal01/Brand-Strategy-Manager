import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import {
  cancelQueueItem,
  createBranch,
  createThreadWithMainBranch,
  getThread,
  listBranchMessages,
  listBranches,
  listProcessEvents,
  listQueue,
  listThreads,
  pinThreadBranch,
  reorderQueue,
} from '../services/chat/runtime/repository';
import { runtimeRunEngine } from '../services/chat/runtime/run-engine';
import {
  AuthedPortalRequest,
  requirePortalAuth,
  requireWorkspaceMembership,
} from '../services/portal/portal-auth-middleware';
import { serializeRuntimeProcessEvent } from '../services/chat/runtime/event-contract';
import { listWorkspaceEvidence } from '../services/evidence/workspace-evidence-service';
import { getLatestKnowledgeLedgerVersion } from '../services/knowledge/knowledge-ledger-service';
import { issueRuntimeWsToken } from '../services/chat/runtime/runtime-ws-auth';
import {
  applyRuntimeDocumentEdit,
  compareRuntimeDocumentVersions,
  exportRuntimeDocumentVersion,
  getRuntimeDocumentDetail,
  listRuntimeDocuments,
  maxUploadBytes,
  maxUploadFiles,
  proposeRuntimeDocumentEdit,
  searchRuntimeDocument,
  uploadRuntimeDocuments,
} from '../services/documents/workspace-document-service';

const router = Router();
const documentUpload = multer({
  limits: {
    fileSize: maxUploadBytes(),
    files: maxUploadFiles(),
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

router.use('/:id/runtime', requirePortalAuth, requireWorkspaceMembership);

router.get('/:id/runtime/threads', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const includeArchived = String(req.query.includeArchived || 'false').toLowerCase() === 'true';
    const threads = await listThreads(researchJobId, includeArchived);
    return res.json({ threads });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to list runtime threads', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/threads', async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const sessionUserId = String(authedReq.portalSession?.user?.id || '').trim();
    if (!sessionUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const researchJobId = String(req.params.id || '').trim();
    const title = String(req.body?.title || 'Main workspace thread').trim().slice(0, 180);
    const createdBy = `portal_user:${sessionUserId.slice(0, 120)}`;

    const job = await prisma.researchJob.findUnique({ where: { id: researchJobId }, select: { id: true } });
    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }

    const result = await createThreadWithMainBranch({
      researchJobId,
      title: title || 'Main workspace thread',
      createdBy: createdBy || 'system',
    });

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to create runtime thread', details: error?.message || String(error) });
  }
});

router.get('/:id/runtime/threads/:threadId', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const threadId = String(req.params.threadId || '').trim();
    const thread = await getThread(researchJobId, threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const branches = await listBranches(thread.id, true);
    return res.json({ thread, branches });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch runtime thread', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/threads/:threadId/branches', async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const sessionUserId = String(authedReq.portalSession?.user?.id || '').trim();
    if (!sessionUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const researchJobId = String(req.params.id || '').trim();
    const threadId = String(req.params.threadId || '').trim();
    const thread = await getThread(researchJobId, threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const name = String(req.body?.name || '').trim().slice(0, 120);
    const createdBy = `portal_user:${sessionUserId.slice(0, 120)}`;
    const forkedFromBranchId = req.body?.forkedFromBranchId ? String(req.body.forkedFromBranchId).trim() : null;
    const forkedFromMessageId = req.body?.forkedFromMessageId ? String(req.body.forkedFromMessageId).trim() : null;

    if (!name) {
      return res.status(400).json({ error: 'Branch name is required' });
    }

    if (forkedFromBranchId && !thread.branches.some((branch: { id: string }) => branch.id === forkedFromBranchId)) {
      return res.status(400).json({ error: 'forkedFromBranchId does not belong to this thread' });
    }

    if (forkedFromMessageId) {
      if (!forkedFromBranchId) {
        return res.status(400).json({ error: 'forkedFromBranchId is required when forkedFromMessageId is provided' });
      }

      const sourceMessage = await prisma.chatBranchMessage.findUnique({
        where: { id: forkedFromMessageId },
        select: { id: true, branchId: true },
      });

      if (!sourceMessage || sourceMessage.branchId !== forkedFromBranchId) {
        return res.status(400).json({ error: 'forkedFromMessageId does not belong to forkedFromBranchId' });
      }
    }

    const branch = await createBranch({
      threadId,
      name,
      createdBy: createdBy || 'system',
      forkedFromBranchId,
      forkedFromMessageId,
    });

    return res.status(201).json({ branch });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to create branch', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/threads/:threadId/pin-branch', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const threadId = String(req.params.threadId || '').trim();
    const branchId = String(req.body?.branchId || '').trim();
    if (!branchId) {
      return res.status(400).json({ error: 'branchId is required' });
    }

    const thread = await getThread(researchJobId, threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const branchBelongs = thread.branches.some((branch: { id: string }) => branch.id === branchId);
    if (!branchBelongs) {
      return res.status(400).json({ error: 'branchId does not belong to thread' });
    }

    const updated = await pinThreadBranch(threadId, branchId);
    return res.json({ thread: updated });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to pin branch', details: error?.message || String(error) });
  }
});

router.get('/:id/runtime/branches/:branchId/messages', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const limit = Number(req.query.limit || 200);
    const messages = await listBranchMessages(branchId, Number.isFinite(limit) ? limit : 200);
    return res.json({ messages });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to list branch messages', details: error?.message || String(error) });
  }
});

router.get('/:id/runtime/branches/:branchId/events', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });

    const afterId = typeof req.query.afterId === 'string' ? req.query.afterId : undefined;
    const afterSeq = typeof req.query.afterSeq === 'string' ? req.query.afterSeq : undefined;
    const limit = Number(req.query.limit || 100);

    const events = await listProcessEvents(branchId, {
      afterId,
      afterSeq,
      limit: Number.isFinite(limit) ? limit : 100,
    });

    return res.json({ events: events.map((event) => serializeRuntimeProcessEvent(event)) });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to list process events', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/ws-token', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const portalReq = req as AuthedPortalRequest;
    const userId = String(portalReq.portalSession?.user?.id || '').trim();

    if (!userId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    await runtimeRunEngine.getBranchState({ researchJobId, branchId });

    const issued = issueRuntimeWsToken({
      researchJobId,
      branchId,
      userId,
    });

    return res.json({
      token: issued.token,
      expiresAt: issued.expiresAt,
    });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({
      error: 'Failed to issue runtime websocket token',
      details: error?.message || String(error),
    });
  }
});

router.get('/:id/runtime/branches/:branchId/evidence', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });

    const runId = typeof req.query.runId === 'string' ? req.query.runId.trim() : '';
    const limit = Number(req.query.limit || 120);
    const rows = await listWorkspaceEvidence({
      researchJobId,
      ...(runId ? { runId } : {}),
      limit: Number.isFinite(limit) ? limit : 120,
    });

    return res.json({
      evidence: rows.map((row: any) => ({
        id: row.id,
        researchJobId: row.researchJobId,
        kind: row.kind,
        refId: row.refId,
        url: row.url,
        label: row.label,
        snippet: row.snippet,
        contentHash: row.contentHash,
        provider: row.provider,
        runId: row.runId,
        status: row.status,
        confidence: row.confidence,
        metadata: row.metadata,
        fetchedAt: row.fetchedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        links: row.links.map((link: any) => ({
          id: link.id,
          entityType: link.entityType,
          entityId: link.entityId,
          role: link.role,
          createdAt: link.createdAt,
        })),
      })),
    });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to list runtime evidence', details: error?.message || String(error) });
  }
});

router.get('/:id/runtime/branches/:branchId/ledger/latest', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });

    const runId = typeof req.query.runId === 'string' ? req.query.runId.trim() : '';
    const ledger = await getLatestKnowledgeLedgerVersion({
      researchJobId,
      ...(runId ? { runId } : {}),
    });

    return res.json({
      ledger: ledger
        ? {
            id: ledger.id,
            researchJobId: ledger.researchJobId,
            runId: ledger.runId,
            source: ledger.source,
            payloadJson: ledger.payloadJson,
            createdAt: ledger.createdAt,
          }
        : null,
    });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to fetch latest runtime ledger', details: error?.message || String(error) });
  }
});

router.get('/:id/runtime/branches/:branchId/queue', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const queue = await listQueue(branchId);
    return res.json({ queue });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to list message queue', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/messages', async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const session = authedReq.portalSession;
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const content = String(req.body?.content || '').trim();

    const userId = `portal_user:${String(session.user.id).trim().slice(0, 120)}`;
    const modeRaw = String(req.body?.mode || 'send').trim().toLowerCase();
    const mode = modeRaw === 'queue' || modeRaw === 'interrupt' ? modeRaw : 'send';
    const inputOptions = isRecord(req.body?.inputOptions) ? req.body.inputOptions : undefined;
    const attachmentIds = Array.isArray(req.body?.attachmentIds)
      ? req.body.attachmentIds.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const documentIds = Array.isArray(req.body?.documentIds)
      ? req.body.documentIds.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
      : undefined;
    if (!content && !attachmentIds?.length && !documentIds?.length) {
      return res.status(400).json({ error: 'content is required when no attachments/documents are provided' });
    }

    const result = await runtimeRunEngine.sendMessage({
      researchJobId,
      branchId,
      userId,
      content,
      mode,
      policy:
        req.body?.policy && typeof req.body.policy === 'object' && !Array.isArray(req.body.policy)
          ? req.body.policy
          : undefined,
      ...(inputOptions ? { inputOptions } : {}),
      ...(attachmentIds ? { attachmentIds } : {}),
      ...(documentIds ? { documentIds } : {}),
    });

    return res.status(202).json(result);
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to process branch message', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/decisions/resolve', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const decisionId = String(req.body?.decisionId || '').trim();
    const option = String(req.body?.option || '').trim();
    if (!decisionId || !option) {
      return res.status(400).json({ error: 'decisionId and option are required' });
    }

    const portalReq = req as AuthedPortalRequest;
    const actorUserId = String(portalReq.portalSession?.user?.id || 'portal_user').trim() || 'portal_user';

    const result = await runtimeRunEngine.resolveDecision({
      researchJobId,
      branchId,
      decisionId,
      option,
      actorUserId,
    });

    return res.json({
      ok: result.ok,
      runId: result.runId,
      retriedToolRuns: result.retriedToolRuns,
      skippedToolRuns: result.skippedToolRuns,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status =
      message.includes('not found')
        ? 404
        : message.toLowerCase().includes('required') || message.toLowerCase().includes('no waiting decision')
          ? 400
          : 500;
    return res.status(status).json({ error: 'Failed to resolve decision', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/steer', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!note) {
      return res.status(400).json({ error: 'note is required' });
    }

    const portalReq = req as AuthedPortalRequest;
    const userId = String(portalReq.portalSession?.user?.id || 'portal_user').trim() || 'portal_user';

    const result = await runtimeRunEngine.steerActiveRun({
      researchJobId,
      branchId,
      userId,
      note,
    });

    return res.status(202).json(result);
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to steer active run', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/bootstrap', async (req, res) => {
  try {
    const portalReq = req as AuthedPortalRequest;
    const sessionUserId = String(portalReq.portalSession?.user?.id || '').trim();
    if (!sessionUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const policy =
      req.body?.policy && typeof req.body.policy === 'object' && !Array.isArray(req.body.policy)
        ? req.body.policy
        : undefined;
    const initiatedBy = `portal_user:${sessionUserId.slice(0, 120)}`;

    const result = await runtimeRunEngine.bootstrapBranch({
      researchJobId,
      branchId,
      policy,
      initiatedBy,
    });

    return res.status(result.started ? 202 : 200).json(result);
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to bootstrap branch', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/interrupt', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const reason = String(req.body?.reason || 'Interrupted by user').trim();

    const result = await runtimeRunEngine.cancelBranchRuns({
      researchJobId,
      branchId,
      reason,
    });

    return res.json(result);
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to interrupt branch run', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/queue/reorder', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
      : [];

    const queue = await reorderQueue(branchId, ids);
    return res.json({ queue });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to reorder queue', details: error?.message || String(error) });
  }
});

router.patch('/:id/runtime/branches/:branchId/queue/:itemId', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const itemId = String(req.params.itemId || '').trim();
    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const content = req.body?.content === undefined ? undefined : String(req.body?.content || '').trim();
    const inputOptions = isRecord(req.body?.inputOptions) ? req.body.inputOptions : undefined;
    const steerNote = req.body?.steerNote === undefined ? undefined : String(req.body?.steerNote || '').trim();
    const attachmentIds = Array.isArray(req.body?.attachmentIds)
      ? req.body.attachmentIds.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const documentIds = Array.isArray(req.body?.documentIds)
      ? req.body.documentIds.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
      : undefined;

    if (
      content === undefined &&
      inputOptions === undefined &&
      steerNote === undefined &&
      attachmentIds === undefined &&
      documentIds === undefined
    ) {
      return res.status(400).json({
        error: 'At least one field is required: content, inputOptions, steerNote, attachmentIds, or documentIds',
      });
    }

    await runtimeRunEngine.updateQueuedMessage({
      researchJobId,
      branchId,
      itemId,
      ...(content !== undefined ? { content } : {}),
      ...(inputOptions ? { inputOptions } : {}),
      ...(steerNote !== undefined ? { steerNote } : {}),
      ...(attachmentIds !== undefined ? { attachmentIds } : {}),
      ...(documentIds !== undefined ? { documentIds } : {}),
    });

    const queue = await listQueue(branchId);
    return res.json({ queue });
  } catch (error: any) {
    const message = String(error?.message || error || '');
    const status =
      message.includes('Queue item not found')
        ? 404
        : message.includes('cannot be empty')
          ? 400
        : message.includes('can only be updated while queued')
          ? 409
          : message.includes('not found')
            ? 404
            : 500;
    return res.status(status).json({
      error: 'Failed to update queue item',
      details: message,
    });
  }
});

router.delete('/:id/runtime/branches/:branchId/queue/:itemId', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const itemId = String(req.params.itemId || '').trim();
    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const queue = await cancelQueueItem(branchId, itemId);
    return res.json({ queue });
  } catch (error: any) {
    const message = error?.message || String(error);
    if (String(message).includes('Queue item not found')) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    const status = String(message).includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to cancel queue item', details: message });
  }
});

router.post('/:id/runtime/runs/:runId/retry', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const runId = String(req.params.runId || '').trim();
    if (!runId) {
      return res.status(400).json({ error: 'runId is required' });
    }

    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        branch: {
          include: {
            thread: true,
          },
        },
      },
    });

    if (!run || run.branch.thread.researchJobId !== researchJobId) {
      return res.status(404).json({ error: 'Run not found' });
    }

    await runtimeRunEngine.executeRun(runId);
    return res.json({ ok: true, runId });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to retry run', details: error?.message || String(error) });
  }
});

router.get('/:id/runtime/branches/:branchId/state', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const state = await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    return res.json(state);
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to fetch branch state', details: error?.message || String(error) });
  }
});

router.post(
  '/:id/runtime/branches/:branchId/documents/upload',
  documentUpload.array('files', maxUploadFiles()),
  async (req, res) => {
    try {
      const researchJobId = String(req.params.id || '').trim();
      const branchId = String(req.params.branchId || '').trim();
      await runtimeRunEngine.getBranchState({ researchJobId, branchId });

      const filesRaw = Array.isArray(req.files) ? req.files : [];
      if (!filesRaw.length) {
        return res.status(400).json({ error: 'files[] is required' });
      }

      const portalReq = req as AuthedPortalRequest;
      const userId = String(portalReq.portalSession?.user?.id || 'portal_user').trim() || 'portal_user';
      const title = typeof req.body?.title === 'string' ? req.body.title : undefined;

      const files = filesRaw.map((file) => ({
        originalname: String((file as any).originalname || 'document'),
        mimetype: String((file as any).mimetype || 'application/octet-stream'),
        size: Number((file as any).size || 0),
        buffer: Buffer.from((file as any).buffer || Buffer.from('')),
      }));

      const uploaded = await uploadRuntimeDocuments({
        researchJobId,
        branchId,
        userId,
        files,
        ...(title ? { title } : {}),
      });

      return res.status(202).json({
        ok: true,
        documents: uploaded.documents,
      });
    } catch (error: any) {
      const message = String(error?.message || error || 'Upload failed');
      const status =
        message.includes('Workspace not found') || message.includes('not found')
          ? 404
          : message.includes('Unsupported file type') ||
              message.includes('No files uploaded') ||
              message.includes('up to') ||
              message.includes('25MB')
            ? 400
            : 500;
      return res.status(status).json({ error: 'Failed to upload runtime documents', details: message });
    }
  }
);

router.get('/:id/runtime/branches/:branchId/documents', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });

    const limit = Number(req.query.limit || 40);
    const documents = await listRuntimeDocuments({
      researchJobId,
      branchId,
      ...(Number.isFinite(limit) ? { limit } : {}),
    });

    return res.json({ documents });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to list runtime documents', details: error?.message || String(error) });
  }
});

router.get('/:id/runtime/branches/:branchId/documents/:documentId', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const documentId = String(req.params.documentId || '').trim();
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const document = await getRuntimeDocumentDetail({ researchJobId, branchId, documentId });
    return res.json({ document });
  } catch (error: any) {
    const status = String(error?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to load runtime document', details: error?.message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/documents/:documentId/propose-edit', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const documentId = String(req.params.documentId || '').trim();
    const instruction = String(req.body?.instruction || '').trim();
    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const portalReq = req as AuthedPortalRequest;
    const userId = String(portalReq.portalSession?.user?.id || 'portal_user').trim() || 'portal_user';
    const proposal = await proposeRuntimeDocumentEdit({
      researchJobId,
      branchId,
      documentId,
      instruction,
      userId,
    });
    return res.json({ proposal });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.includes('not found') ? 404 : message.includes('required') ? 400 : 500;
    return res.status(status).json({ error: 'Failed to propose runtime document edit', details: message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/documents/:documentId/apply-edit', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const documentId = String(req.params.documentId || '').trim();
    const proposedContentMd = String(req.body?.proposedContentMd || '').trim();
    if (!proposedContentMd) {
      return res.status(400).json({ error: 'proposedContentMd is required' });
    }
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const portalReq = req as AuthedPortalRequest;
    const userId = String(portalReq.portalSession?.user?.id || 'portal_user').trim() || 'portal_user';
    const applied = await applyRuntimeDocumentEdit({
      researchJobId,
      branchId,
      documentId,
      userId,
      proposedContentMd,
      changeSummary: typeof req.body?.changeSummary === 'string' ? req.body.changeSummary : undefined,
      baseVersionId: typeof req.body?.baseVersionId === 'string' ? req.body.baseVersionId : undefined,
      runId: typeof req.body?.runId === 'string' ? req.body.runId : undefined,
    });
    return res.json({ applied });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.includes('not found') ? 404 : message.includes('required') ? 400 : 500;
    return res.status(status).json({ error: 'Failed to apply runtime document edit', details: message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/documents/:documentId/export', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const documentId = String(req.params.documentId || '').trim();
    const format = String(req.body?.format || '').trim().toUpperCase() || 'PDF';
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const portalReq = req as AuthedPortalRequest;
    const userId = String(portalReq.portalSession?.user?.id || 'portal_user').trim() || 'portal_user';
    const exported = await exportRuntimeDocumentVersion({
      researchJobId,
      branchId,
      documentId,
      format: format as 'PDF' | 'DOCX' | 'MD',
      versionId: typeof req.body?.versionId === 'string' ? req.body.versionId : undefined,
      userId,
    });
    return res.json({ exported });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.includes('not found') ? 404 : message.includes('format') || message.includes('required') ? 400 : 500;
    return res.status(status).json({ error: 'Failed to export runtime document', details: message || String(error) });
  }
});

router.post('/:id/runtime/branches/:branchId/documents/:documentId/compare-versions', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const documentId = String(req.params.documentId || '').trim();
    const fromVersionId = String(req.body?.fromVersionId || '').trim();
    const toVersionId = String(req.body?.toVersionId || '').trim();
    if (!fromVersionId || !toVersionId) {
      return res.status(400).json({ error: 'fromVersionId and toVersionId are required' });
    }
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const comparison = await compareRuntimeDocumentVersions({
      researchJobId,
      branchId,
      documentId,
      fromVersionId,
      toVersionId,
    });
    return res.json({ comparison });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.includes('not found') ? 404 : message.includes('required') ? 400 : 500;
    return res.status(status).json({ error: 'Failed to compare runtime document versions', details: message || String(error) });
  }
});

router.get('/:id/runtime/branches/:branchId/documents/:documentId/search', async (req, res) => {
  try {
    const researchJobId = String(req.params.id || '').trim();
    const branchId = String(req.params.branchId || '').trim();
    const documentId = String(req.params.documentId || '').trim();
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'q is required' });
    }
    await runtimeRunEngine.getBranchState({ researchJobId, branchId });
    const results = await searchRuntimeDocument({
      researchJobId,
      documentId,
      query,
      limit: Number.isFinite(Number(req.query.limit || 8)) ? Number(req.query.limit) : undefined,
    });
    return res.json({ results });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.includes('not found') ? 404 : message.includes('required') ? 400 : 500;
    return res.status(status).json({ error: 'Failed to search runtime document', details: message || String(error) });
  }
});

export default router;
