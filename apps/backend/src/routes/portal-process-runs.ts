import { Request, Router } from 'express';
import {
  answerQuestionTask,
  createProcessRun,
  escalateProcessRun,
  getProcessRun,
  getProcessRunPlan,
  listProcessRuns,
  listProcessRunQuestions,
  listProcessRunSections,
  listRunEvents,
  listSectionRevisions,
  resumeProcessRun,
  reviseSection,
} from '../services/process-control/control-engine';
import {
  parseProcessRunCreateContract,
  parseQuestionAnswerContract,
  parseSectionRevisionContract,
} from '../services/process-control/contracts';

const router = Router({ mergeParams: true });
const SANITIZE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function safeString(value: unknown, max = 180): string {
  if (typeof value !== 'string') return '';
  return value.replace(SANITIZE_CONTROL_CHARS, '').trim().slice(0, Math.max(1, max));
}

function parseWorkspaceId(req: Request): string {
  return safeString(req.params.workspaceId, 120);
}

router.post('/process-runs', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const contract = parseProcessRunCreateContract(req.body);
    const idempotencyHeader = safeString(req.header('x-idempotency-key') || '', 120);
    const run = await createProcessRun({
      workspaceId,
      documentType: contract.documentType,
      objective: contract.objective,
      requestMode: contract.requestMode,
      targets: contract.targets,
      idempotencyKey: contract.idempotencyKey || idempotencyHeader || undefined,
      startedBy: 'portal_user',
    });

    return res.json({
      ok: true,
      run,
    });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to create process run');
    const status = /required|supports|disabled|limit/i.test(message) ? 400 : message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get('/process-runs', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const limit = Number(req.query?.limit);
    const runs = await listProcessRuns(workspaceId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    return res.json({
      ok: true,
      runs,
    });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to list process runs');
    const status = /required/i.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get('/process-runs/:runId', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const runId = safeString(req.params.runId, 120);
    if (!workspaceId || !runId) {
      return res.status(400).json({ error: 'workspaceId and runId are required' });
    }

    const [run, events] = await Promise.all([
      getProcessRun(workspaceId, runId),
      listRunEvents(workspaceId, runId),
    ]);

    return res.json({
      ok: true,
      run,
      events,
    });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to fetch process run');
    const status = message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get('/process-runs/:runId/plan', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const runId = safeString(req.params.runId, 120);
    if (!workspaceId || !runId) {
      return res.status(400).json({ error: 'workspaceId and runId are required' });
    }

    const payload = await getProcessRunPlan(workspaceId, runId);
    return res.json({
      ok: true,
      ...payload,
    });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to fetch process run plan');
    const status = message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.post('/process-runs/:runId/resume', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const runId = safeString(req.params.runId, 120);
    if (!workspaceId || !runId) {
      return res.status(400).json({ error: 'workspaceId and runId are required' });
    }

    const modeRaw = safeString(req.body?.mode, 40).toLowerCase();
    const mode = modeRaw === 'retry_with_new_evidence' ? 'retry_with_new_evidence' : 'retry';

    const run = await resumeProcessRun({
      workspaceId,
      runId,
      mode,
      requestedBy: 'portal_user',
    });

    return res.json({ ok: true, run });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to resume process run');
    const status = /required|limit|invalid/i.test(message) ? 400 : message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.post('/process-runs/:runId/escalate', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const runId = safeString(req.params.runId, 120);
    const reason = safeString(req.body?.reason, 400);
    const details = safeString(req.body?.details, 2000);

    if (!workspaceId || !runId) {
      return res.status(400).json({ error: 'workspaceId and runId are required' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const run = await escalateProcessRun({
      workspaceId,
      runId,
      reason,
      details,
      requestedBy: 'portal_user',
    });

    return res.json({ ok: true, run });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to escalate process run');
    const status = /required|invalid/i.test(message) ? 400 : message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get('/process-runs/:runId/questions', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const runId = safeString(req.params.runId, 120);
    if (!workspaceId || !runId) {
      return res.status(400).json({ error: 'workspaceId and runId are required' });
    }

    const questions = await listProcessRunQuestions(workspaceId, runId);
    return res.json({ ok: true, questions });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to fetch question tasks');
    const status = message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.post('/question-tasks/:taskId/answer', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const taskId = safeString(req.params.taskId, 120);
    if (!workspaceId || !taskId) {
      return res.status(400).json({ error: 'workspaceId and taskId are required' });
    }

    const contract = parseQuestionAnswerContract(req.body);
    const run = await answerQuestionTask({
      workspaceId,
      taskId,
      answer: contract.answer,
      answeredBy: 'portal_user',
    });

    return res.json({ ok: true, run });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to answer question');
    const status = /required/i.test(message) ? 400 : message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get('/process-runs/:runId/sections', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const runId = safeString(req.params.runId, 120);
    if (!workspaceId || !runId) {
      return res.status(400).json({ error: 'workspaceId and runId are required' });
    }

    const sections = await listProcessRunSections(workspaceId, runId);
    return res.json({ ok: true, sections });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to fetch sections');
    const status = message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get('/sections/:sectionId/revisions', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const sectionId = safeString(req.params.sectionId, 120);
    if (!workspaceId || !sectionId) {
      return res.status(400).json({ error: 'workspaceId and sectionId are required' });
    }

    const revisions = await listSectionRevisions(workspaceId, sectionId);
    return res.json({ ok: true, revisions });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to fetch revisions');
    const status = message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

router.post('/sections/:sectionId/revise', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const sectionId = safeString(req.params.sectionId, 120);
    if (!workspaceId || !sectionId) {
      return res.status(400).json({ error: 'workspaceId and sectionId are required' });
    }

    const contract = parseSectionRevisionContract(req.body);
    const run = await reviseSection({
      workspaceId,
      sectionId,
      markdown: contract.markdown,
      summary: contract.summary,
      createdByRole: contract.createdByRole || 'Editor',
    });

    return res.json({ ok: true, run });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to revise section');
    const status = /required|invalid/i.test(message) ? 400 : message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
});

export default router;
