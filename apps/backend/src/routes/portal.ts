import { Router, Request } from 'express';
import { prisma } from '../lib/prisma';
import {
  clearSessionCookie,
  consumeEmailVerificationToken,
  createPortalSession,
  createWorkspaceForNewSignup,
  hashPassword,
  isValidEmail,
  isValidPassword,
  issuePortalEmailVerificationToken,
  readSessionTokenFromRequest,
  revokePortalSessionByToken,
  sendVerificationEmail,
  setSessionCookie,
  toPortalUserPayload,
  toPortalWorkspacePayload,
  verifyPassword,
} from '../services/portal/portal-auth';
import {
  AuthedPortalRequest,
  requirePortalAuth,
  requireWorkspaceMembership,
} from '../services/portal/portal-auth-middleware';
import {
  getPortalWorkspaceIntakeStatus,
  submitPortalWorkspaceIntake,
  suggestPortalWorkspaceIntakeCompletion,
} from '../services/portal/portal-intake';

const router = Router();

function getRequestIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0] || '').trim() || null;
  }
  return req.socket?.remoteAddress || null;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.post('/auth/signup', async (req, res) => {
  try {
    const email = safeString(req.body?.email).toLowerCase();
    const password = safeString(req.body?.password);
    const fullName = safeString(req.body?.fullName);
    const companyName = safeString(req.body?.companyName);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'INVALID_EMAIL' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'INVALID_PASSWORD', details: 'Password must be at least 8 characters.' });
    }

    const existing = await prisma.portalUser.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS' });
    }

    const passwordHash = await hashPassword(password);
    const isFirstUser = (await prisma.portalUser.count()) === 0;

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.portalUser.create({
        data: {
          email,
          passwordHash,
          fullName: fullName || null,
          companyName: companyName || null,
          isAdmin: isFirstUser,
        },
      });

      const workspace = await createWorkspaceForNewSignup(
        {
          companyName: companyName || null,
          fallbackEmail: email,
        },
        tx
      );

      await tx.portalWorkspaceMembership.create({
        data: {
          userId: user.id,
          researchJobId: workspace.id,
          role: 'ADMIN',
        },
      });

      return { userId: user.id };
    });

    const verifyToken = await issuePortalEmailVerificationToken(created.userId);
    const emailDelivery = await sendVerificationEmail({
      email,
      token: verifyToken.token,
      fullName: fullName || null,
      req,
    });

    const session = await createPortalSession({
      userId: created.userId,
      userAgent: safeString(req.headers['user-agent']) || null,
      ipAddress: getRequestIp(req),
    });
    setSessionCookie(res, session.token, session.expiresAt);

    const hydrated = await prisma.portalUser.findUnique({
      where: { id: created.userId },
      include: {
        memberships: {
          include: {
            researchJob: {
              include: { client: true },
            },
          },
        },
      },
    });

    if (!hydrated) {
      return res.status(500).json({ error: 'SIGNUP_STATE_MISSING' });
    }

    return res.status(201).json({
      user: toPortalUserPayload(hydrated as any),
      workspaces: toPortalWorkspacePayload(hydrated as any),
      emailDelivery,
      ...(process.env.NODE_ENV !== 'production' ? { debugVerificationToken: verifyToken.token } : {}),
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'SIGNUP_FAILED', details: error?.message || String(error) });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const email = safeString(req.body?.email).toLowerCase();
    const password = safeString(req.body?.password);

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'INVALID_CREDENTIALS' });
    }

    const user = await prisma.portalUser.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            researchJob: {
              include: { client: true },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    const session = await createPortalSession({
      userId: user.id,
      userAgent: safeString(req.headers['user-agent']) || null,
      ipAddress: getRequestIp(req),
    });
    setSessionCookie(res, session.token, session.expiresAt);

    return res.json({
      user: toPortalUserPayload(user as any),
      workspaces: toPortalWorkspacePayload(user as any),
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'LOGIN_FAILED', details: error?.message || String(error) });
  }
});

router.post('/auth/logout', async (req, res) => {
  try {
    const token = readSessionTokenFromRequest(req);
    if (token) {
      await revokePortalSessionByToken(token);
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: 'LOGOUT_FAILED', details: error?.message || String(error) });
  }
});

router.get('/auth/me', requirePortalAuth, async (req, res) => {
  const session = (req as AuthedPortalRequest).portalSession!;
  return res.json({
    user: toPortalUserPayload(session.user as any),
    workspaces: toPortalWorkspacePayload(session.user as any),
  });
});

router.get('/auth/verify-email', async (req, res) => {
  try {
    const token = safeString(req.query.token);
    if (!token) {
      return res.status(400).json({ error: 'TOKEN_REQUIRED' });
    }

    const userId = await consumeEmailVerificationToken(token);
    if (!userId) {
      return res.status(400).json({ error: 'TOKEN_INVALID_OR_EXPIRED' });
    }

    return res.json({ ok: true, userId });
  } catch (error: any) {
    return res.status(500).json({ error: 'VERIFY_EMAIL_FAILED', details: error?.message || String(error) });
  }
});

router.post('/auth/resend-verification', requirePortalAuth, async (req, res) => {
  try {
    const session = (req as AuthedPortalRequest).portalSession!;
    if (session.user.emailVerifiedAt) {
      return res.json({ ok: true, alreadyVerified: true });
    }

    const token = await issuePortalEmailVerificationToken(session.user.id);
    const delivery = await sendVerificationEmail({
      email: session.user.email,
      token: token.token,
      fullName: session.user.fullName,
      req,
    });
    return res.json({
      ok: true,
      delivery,
      ...(process.env.NODE_ENV !== 'production' ? { debugVerificationToken: token.token } : {}),
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'RESEND_FAILED', details: error?.message || String(error) });
  }
});

router.get('/workspaces', requirePortalAuth, async (req, res) => {
  const session = (req as AuthedPortalRequest).portalSession!;
  return res.json({
    workspaces: toPortalWorkspacePayload(session.user as any),
  });
});

router.get('/workspaces/:workspaceId/intake', requirePortalAuth, requireWorkspaceMembership, async (req, res) => {
  try {
    const workspaceId = safeString(req.params.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const status = await getPortalWorkspaceIntakeStatus(workspaceId);
    if (!status) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    return res.json(status);
  } catch (error: any) {
    return res.status(500).json({ error: 'INTAKE_STATUS_FAILED', details: error?.message || String(error) });
  }
});

router.post(
  '/workspaces/:workspaceId/intake/suggest',
  requirePortalAuth,
  requireWorkspaceMembership,
  async (req, res) => {
    try {
      const workspaceId = safeString(req.params.workspaceId);
      if (!workspaceId) {
        return res.status(400).json({ error: 'workspaceId is required' });
      }

      const payload =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const result = await suggestPortalWorkspaceIntakeCompletion(workspaceId, payload);
      return res.json({ success: true, ...result });
    } catch (error: any) {
      const message = String(error?.message || '');
      const status = message.toLowerCase().includes('required') ? 400 : 500;
      return res.status(status).json({ success: false, error: message || 'Failed to suggest intake completion' });
    }
  }
);

router.post('/workspaces/:workspaceId/intake', requirePortalAuth, requireWorkspaceMembership, async (req, res) => {
  try {
    const workspaceId = safeString(req.params.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const result = await submitPortalWorkspaceIntake(workspaceId, payload);
    return res.json(result);
  } catch (error: any) {
    const message = String(error?.message || '');
    const isValidation =
      message.toLowerCase().includes('required') || message.toLowerCase().includes('at least one');
    const status = message.toLowerCase().includes('not found') ? 404 : isValidation ? 400 : 500;
    return res.status(status).json({ success: false, error: message || 'Failed to submit workspace intake' });
  }
});

export default router;
