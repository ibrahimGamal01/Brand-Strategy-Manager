import crypto from 'node:crypto';
import { Router, Request } from 'express';
import { prisma } from '../lib/prisma';
import {
  clearSessionCookie,
  consumeEmailVerificationToken,
  createPortalSession,
  createWorkspaceForNewSignup,
  findPortalUserByEmail,
  getPortalEmailVerifyCode,
  getPortalSessionFromRequest,
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
  verifyPortalEmailCode,
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
import { savePortalWorkspaceIntakeDraft } from '../services/portal/portal-intake-draft';
import {
  getPortalIntakeEventStoreDiagnostics,
  listPortalIntakeEvents,
  PortalIntakeEvent,
  subscribePortalIntakeEvents,
} from '../services/portal/portal-intake-events';
import {
  classifyIntakeUrlInputs,
  PortalIntakeScanMode,
  queuePortalIntakeWebsiteScan,
} from '../services/portal/portal-intake-websites';
import {
  getPortalLibraryFeatureFlags,
  getPortalWorkspaceLibraryDiagnostics,
  listPortalWorkspaceLibrary,
  resolvePortalWorkspaceLibraryRefs,
} from '../services/portal/portal-library';
import {
  listPortalUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications/notification-service';
import {
  getPortalIntakeScanRun,
  listPortalIntakeScanRunsWithEventCounts,
} from '../services/portal/portal-intake-events-repository';
import {
  startPortalSignupEnrichment,
  syncPortalIntakeContinuousEnrichment,
} from '../services/portal/portal-signup-enrichment';
import { buildSlackInstallUrl, createSlackInstallState } from '../services/slack/slack-oauth';
import {
  findPortalUserBySlackUser,
  listActiveSlackInstallations,
  parseSlackInstallationSettings,
  patchSlackInstallationSettings,
} from '../services/slack/slack-installation-repo';
import {
  linkSlackChannelToWorkspace,
  listSlackChannelsForTeam,
  setSlackChannelOwners,
} from '../services/slack/slack-channel-service';
import { listSlackUsersForTeam, syncSlackUsersFromApi } from '../services/slack/slack-user-service';
import { enqueueIntegrationJob } from '../services/integrations/integration-job-queue';
import { getSlackBootstrapStatus } from '../services/slack/slack-app';
import { buildSlackManifestBundle } from '../services/slack/slack-manifest';

const router = Router();
const authRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function hashEmailForLogs(email: string): string | null {
  const normalized = safeString(email).toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

function logPortalAuthEvent(input: {
  event:
    | 'PORTAL_SIGNUP_REQUESTED'
    | 'PORTAL_SIGNUP_CREATED'
    | 'PORTAL_SIGNUP_SESSION_CLEARED'
    | 'PORTAL_VERIFY_CODE_SUCCEEDED'
    | 'PORTAL_VERIFY_CODE_FAILED'
    | 'PORTAL_LOGIN_BLOCKED_UNVERIFIED'
    | 'PORTAL_RESEND_VERIFICATION_REQUESTED';
  workspaceId?: string | null;
  email?: string | null;
  status: string;
  durationMs?: number;
  errorCode?: string;
}) {
  const payload: Record<string, unknown> = {
    event: input.event,
    workspaceId: input.workspaceId || null,
    emailHash: hashEmailForLogs(input.email || '') || null,
    status: input.status,
    durationMs: Number.isFinite(input.durationMs as number) ? Math.max(0, Math.round(input.durationMs as number)) : 0,
    timestamp: new Date().toISOString(),
  };
  if (input.errorCode) {
    payload.errorCode = input.errorCode;
  }
  console.log(JSON.stringify(payload));
}

function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = authRateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    authRateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) {
    return false;
  }
  current.count += 1;
  authRateLimitStore.set(key, current);
  return true;
}

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

function parseStringArray(value: unknown, maxItems = 12): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }
  const text = safeString(value);
  if (!text) return [];
  return text
    .split(/[\n,;|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseIntakeScanMode(value: unknown): PortalIntakeScanMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'standard' || mode === 'deep') return mode;
  return 'quick';
}

function parseBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseLibraryCollection(value: unknown):
  | 'web'
  | 'competitors'
  | 'social'
  | 'community'
  | 'news'
  | 'deliverables'
  | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (
    raw === 'web' ||
    raw === 'competitors' ||
    raw === 'social' ||
    raw === 'community' ||
    raw === 'news' ||
    raw === 'deliverables'
  ) {
    return raw;
  }
  return undefined;
}

function parseLibraryVersion(value: unknown): 'v1' | 'v2' | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === '1' || raw === 'v1') return 'v1';
  if (raw === '2' || raw === 'v2') return 'v2';
  return undefined;
}

async function canAccessWorkspace(portalUserId: string, workspaceId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const membership = await prisma.portalWorkspaceMembership.findFirst({
    where: {
      userId: portalUserId,
      researchJobId: workspaceId,
    },
    select: { id: true },
  });
  return Boolean(membership?.id);
}

async function listAccessibleSlackTeamIds(portalUserId: string, isAdmin: boolean): Promise<string[]> {
  const installations = await listActiveSlackInstallations();
  if (isAdmin) {
    return Array.from(new Set(installations.map((installation) => installation.slackTeamId)));
  }

  const ownedInstallations = installations
    .filter((installation) => installation.installedByPortalUserId === portalUserId)
    .map((installation) => installation.slackTeamId);

  const linkedWorkspaceTeams = await prisma.slackChannelLink.findMany({
    where: {
      researchJob: {
        portalMemberships: {
          some: {
            userId: portalUserId,
          },
        },
      },
    },
    select: { slackTeamId: true },
    distinct: ['slackTeamId'],
  });

  return Array.from(new Set([...ownedInstallations, ...linkedWorkspaceTeams.map((row) => row.slackTeamId)]));
}

function buildSlackPreflightDiagnostics() {
  const required: string[] = [
    'BACKEND_PUBLIC_ORIGIN',
    'SLACK_CLIENT_ID',
    'SLACK_CLIENT_SECRET',
    'SLACK_SIGNING_SECRET',
    'SLACK_TOKEN_ENCRYPTION_KEY',
    'SLACK_STATE_SECRET_OR_RUNTIME_WS_SIGNING_SECRET',
  ];
  const missingEnv = required.filter((name) => {
    if (name === 'SLACK_STATE_SECRET_OR_RUNTIME_WS_SIGNING_SECRET') {
      return !safeString(process.env.SLACK_STATE_SECRET) && !safeString(process.env.RUNTIME_WS_SIGNING_SECRET);
    }
    return !safeString(process.env[name]);
  });
  const origin = safeString(process.env.BACKEND_PUBLIC_ORIGIN);
  const callbackUrl = origin ? `${origin.replace(/\/+$/, '')}/api/slack/oauth/callback` : null;
  return {
    configured: missingEnv.length === 0,
    required,
    missingEnv,
    callbackUrl,
    bootstrap: getSlackBootstrapStatus(),
  };
}

function buildSlackPreflightPublicMessage(configured: boolean): string {
  if (configured) {
    return 'BAT Slack platform is ready. You can connect your workspace now.';
  }
  return 'BAT Slack is being configured by BAT admins. Please contact your BAT admin or support and try again shortly.';
}

function buildSlackPreflightResponse(input: {
  isAdmin: boolean;
  teamIds: string[];
}) {
  const diagnostics = buildSlackPreflightDiagnostics();
  const common = {
    configured: diagnostics.configured,
    platformReady: diagnostics.configured,
    publicMessage: buildSlackPreflightPublicMessage(diagnostics.configured),
    teamIds: input.teamIds,
  };
  if (input.isAdmin) {
    return {
      ...common,
      isAdminView: true,
      required: diagnostics.required,
      missingEnv: diagnostics.missingEnv,
      callbackUrl: diagnostics.callbackUrl,
      bootstrap: diagnostics.bootstrap,
    };
  }
  return {
    ...common,
    isAdminView: false,
    bootstrap: {
      enabled: diagnostics.bootstrap.enabled,
    },
  };
}

function serializePortalIntakeEventSse(event: PortalIntakeEvent): string {
  return `id: ${event.id}\nevent: intake_event\ndata: ${JSON.stringify(event)}\n\n`;
}

router.post('/auth/signup', async (req, res) => {
  const startedAt = Date.now();
  const requestEmail = safeString(req.body?.email).toLowerCase();
  logPortalAuthEvent({
    event: 'PORTAL_SIGNUP_REQUESTED',
    email: requestEmail,
    status: 'received',
  });

  try {
    // Best-effort guard: if caller already has a portal session cookie, revoke and clear it.
    const existingSessionToken = readSessionTokenFromRequest(req);
    if (existingSessionToken) {
      try {
        await revokePortalSessionByToken(existingSessionToken);
        logPortalAuthEvent({
          event: 'PORTAL_SIGNUP_SESSION_CLEARED',
          email: requestEmail,
          status: 'revoked',
          durationMs: Date.now() - startedAt,
        });
      } catch (error: any) {
        logPortalAuthEvent({
          event: 'PORTAL_SIGNUP_SESSION_CLEARED',
          email: requestEmail,
          status: 'revoke_failed',
          durationMs: Date.now() - startedAt,
          errorCode: String(error?.message || 'SESSION_REVOKE_FAILED').slice(0, 120),
        });
      }
      clearSessionCookie(res);
    }

    const email = requestEmail;
    const password = safeString(req.body?.password);
    const fullName = safeString(req.body?.fullName);
    const companyName = safeString(req.body?.companyName);
    const websiteClassified = classifyIntakeUrlInputs(
      [req.body?.website, req.body?.websites, req.body?.socialReferences],
      5,
      12
    );
    const websites = websiteClassified.crawlWebsites;
    const socialReferences = Array.from(
      new Set([
        ...websiteClassified.socialReferences,
        ...parseStringArray(req.body?.socialReferences, 12),
      ])
    ).slice(0, 12);
    const handlesV2 =
      req.body?.handlesV2 && typeof req.body.handlesV2 === 'object' && !Array.isArray(req.body.handlesV2)
        ? (req.body.handlesV2 as Record<string, unknown>)
        : undefined;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'INVALID_EMAIL' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'INVALID_PASSWORD', details: 'Password must be at least 8 characters.' });
    }
    if (!websites.length) {
      return res.status(400).json({ error: 'WEBSITE_REQUIRED' });
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
          seedInputData: {
            website: websites[0] || '',
            websites,
            socialReferences,
            ...(handlesV2 ? { handlesV2 } : {}),
            source: 'portal_signup',
          },
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

      return { userId: user.id, workspaceId: workspace.id };
    });

    const verifyToken = await issuePortalEmailVerificationToken(created.userId);
    const emailDelivery = await sendVerificationEmail({
      email,
      token: verifyToken.token,
      fullName: fullName || null,
      req,
    });

    void startPortalSignupEnrichment({
      workspaceId: created.workspaceId,
      brandName: companyName || email.split('@')[0] || 'Brand',
      website: websites[0],
      websites,
      socialReferences,
      ...(handlesV2 ? { handlesV2 } : {}),
    }).catch((error) => {
      console.warn(
        `[PortalSignupEnrichment] Failed to start for workspace=${created.workspaceId}:`,
        (error as Error)?.message || String(error)
      );
    });

    logPortalAuthEvent({
      event: 'PORTAL_SIGNUP_CREATED',
      workspaceId: created.workspaceId,
      email,
      status: 'success',
      durationMs: Date.now() - startedAt,
    });

    return res.status(201).json({
      ok: true,
      email,
      workspaceId: created.workspaceId,
      requiresEmailVerification: true,
      emailDelivery,
      ...(process.env.NODE_ENV !== 'production' ? { debugVerificationCode: getPortalEmailVerifyCode() } : {}),
      ...(process.env.NODE_ENV !== 'production' ? { debugVerificationToken: verifyToken.token } : {}),
    });
  } catch (error: any) {
    logPortalAuthEvent({
      event: 'PORTAL_SIGNUP_REQUESTED',
      email: requestEmail,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorCode: 'SIGNUP_FAILED',
    });
    return res.status(500).json({ error: 'SIGNUP_FAILED', details: error?.message || String(error) });
  }
});

router.post('/auth/login', async (req, res) => {
  const startedAt = Date.now();
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

    if (!user.emailVerifiedAt) {
      const workspaceId =
        Array.isArray(user.memberships) && user.memberships.length > 0
          ? String(user.memberships[0]?.researchJobId || '')
          : '';
      logPortalAuthEvent({
        event: 'PORTAL_LOGIN_BLOCKED_UNVERIFIED',
        workspaceId: workspaceId || null,
        email,
        status: 'blocked',
        durationMs: Date.now() - startedAt,
        errorCode: 'EMAIL_NOT_VERIFIED',
      });
      return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
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

router.post('/auth/verify-email-code', async (req, res) => {
  const startedAt = Date.now();
  const requestEmail = safeString(req.body?.email).toLowerCase();
  try {
    const email = requestEmail;
    const code = safeString(req.body?.code);
    const ip = getRequestIp(req) || 'unknown';
    if (!consumeRateLimit(`verify:${ip}:${email || 'unknown'}`, 10, 10 * 60 * 1000)) {
      logPortalAuthEvent({
        event: 'PORTAL_VERIFY_CODE_FAILED',
        email,
        status: 'rate_limited',
        durationMs: Date.now() - startedAt,
        errorCode: 'RATE_LIMITED',
      });
      return res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
    }

    if (!email) {
      logPortalAuthEvent({
        event: 'PORTAL_VERIFY_CODE_FAILED',
        email: requestEmail,
        status: 'invalid_request',
        durationMs: Date.now() - startedAt,
        errorCode: 'EMAIL_REQUIRED',
      });
      return res.status(400).json({ error: 'EMAIL_REQUIRED' });
    }
    if (!code) {
      logPortalAuthEvent({
        event: 'PORTAL_VERIFY_CODE_FAILED',
        email,
        status: 'invalid_request',
        durationMs: Date.now() - startedAt,
        errorCode: 'CODE_REQUIRED',
      });
      return res.status(400).json({ error: 'CODE_REQUIRED' });
    }

    const result = await verifyPortalEmailCode({ email, code });
    if (!result.ok) {
      const message = String(result.error || '');
      const status =
        message === 'INVALID_EMAIL'
          ? 400
          : message === 'INVALID_VERIFICATION_CODE'
            ? 401
            : 410;
      logPortalAuthEvent({
        event: 'PORTAL_VERIFY_CODE_FAILED',
        email,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorCode: message || 'VERIFY_CODE_FAILED',
      });
      return res.status(status).json({ ok: false, error: message || 'VERIFY_CODE_FAILED' });
    }

    logPortalAuthEvent({
      event: 'PORTAL_VERIFY_CODE_SUCCEEDED',
      workspaceId: null,
      email,
      status: result.alreadyVerified ? 'already_verified' : 'verified',
      durationMs: Date.now() - startedAt,
    });

    return res.json({
      ok: true,
      userId: result.userId,
      alreadyVerified: Boolean(result.alreadyVerified),
    });
  } catch (error: any) {
    logPortalAuthEvent({
      event: 'PORTAL_VERIFY_CODE_FAILED',
      email: requestEmail,
      status: 'error',
      durationMs: Date.now() - startedAt,
      errorCode: 'VERIFY_EMAIL_CODE_FAILED',
    });
    return res.status(500).json({ error: 'VERIFY_EMAIL_CODE_FAILED', details: error?.message || String(error) });
  }
});

router.post('/auth/resend-verification', async (req, res) => {
  const startedAt = Date.now();
  try {
    const portalSession = await getPortalSessionFromRequest(req);
    const ip = getRequestIp(req) || 'unknown';

    let targetEmail = '';
    let targetFullName: string | null = null;
    let targetUserId = '';

    if (portalSession?.user) {
      if (portalSession.user.emailVerifiedAt) {
        return res.json({ ok: true, alreadyVerified: true });
      }
      targetEmail = portalSession.user.email;
      targetFullName = portalSession.user.fullName;
      targetUserId = portalSession.user.id;
    } else {
      targetEmail = safeString(req.body?.email).toLowerCase();
      if (!isValidEmail(targetEmail)) {
        return res.status(400).json({ error: 'INVALID_EMAIL' });
      }
      const user = await findPortalUserByEmail(targetEmail);
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
      }
      if (user.emailVerifiedAt) {
        return res.json({ ok: true, alreadyVerified: true });
      }
      targetUserId = user.id;
      targetFullName = user.fullName;
    }

    logPortalAuthEvent({
      event: 'PORTAL_RESEND_VERIFICATION_REQUESTED',
      workspaceId: null,
      email: targetEmail,
      status: 'received',
      durationMs: Date.now() - startedAt,
    });

    if (!consumeRateLimit(`resend:${ip}:${targetEmail}`, 5, 15 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
    }

    const token = await issuePortalEmailVerificationToken(targetUserId);
    const delivery = await sendVerificationEmail({
      email: targetEmail,
      token: token.token,
      fullName: targetFullName,
      req,
    });

    return res.json({
      ok: true,
      delivery,
      ...(process.env.NODE_ENV !== 'production' ? { debugVerificationCode: getPortalEmailVerifyCode() } : {}),
      ...(process.env.NODE_ENV !== 'production' ? { debugVerificationToken: token.token } : {}),
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'RESEND_FAILED', details: error?.message || String(error) });
  }
});

router.get('/notifications', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const workspaceId = safeString(Array.isArray(req.query.workspaceId) ? req.query.workspaceId[0] : req.query.workspaceId);
    const unreadOnly = parseBoolean(Array.isArray(req.query.unreadOnly) ? req.query.unreadOnly[0] : req.query.unreadOnly, false);
    const limit = Number.parseInt(
      String(Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit || ''),
      10
    );

    if (workspaceId && !(await canAccessWorkspace(portalUserId, workspaceId, Boolean(authedReq.portalSession?.user?.isAdmin)))) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const notifications = await listPortalUserNotifications({
      portalUserId,
      ...(workspaceId ? { workspaceId } : {}),
      unreadOnly,
      ...(Number.isFinite(limit) ? { limit } : {}),
    });
    return res.json({ ok: true, notifications });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'NOTIFICATIONS_LIST_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.post('/notifications/:id/read', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }
    const notificationId = safeString(req.params.id);
    if (!notificationId) return res.status(400).json({ error: 'notificationId is required' });
    const result = await markNotificationRead({ portalUserId, notificationId });
    return res.json({ ok: true, updated: result.count });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'NOTIFICATION_READ_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.post('/notifications/read-all', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }
    const workspaceId = safeString(req.body?.workspaceId);
    if (workspaceId && !(await canAccessWorkspace(portalUserId, workspaceId, Boolean(authedReq.portalSession?.user?.isAdmin)))) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const result = await markAllNotificationsRead({ portalUserId, ...(workspaceId ? { workspaceId } : {}) });
    return res.json({ ok: true, updated: result.count });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'NOTIFICATION_READ_ALL_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.get('/slack/install-url', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }
    const preflight = buildSlackPreflightDiagnostics();
    if (!preflight.configured) {
      const details = buildSlackPreflightPublicMessage(false);
      return res.status(503).json({
        ok: false,
        error: 'SLACK_PLATFORM_NOT_READY',
        code: 'SLACK_PLATFORM_NOT_READY',
        details: isAdmin
          ? `${details} Missing: ${preflight.missingEnv.join(', ')}.`
          : details,
      });
    }
    const state = createSlackInstallState(portalUserId);
    const installUrl = buildSlackInstallUrl(state);
    return res.json({ ok: true, installUrl });
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message) {
      const looksLikeConfigIssue =
        message.includes('is required for Slack integration') ||
        message.includes('must be set for Slack OAuth') ||
        message.includes('is required for Slack OAuth state');
      if (looksLikeConfigIssue) {
        return res.status(503).json({
          ok: false,
          error: 'SLACK_PLATFORM_NOT_READY',
          code: 'SLACK_PLATFORM_NOT_READY',
          details: buildSlackPreflightPublicMessage(false),
        });
      }
    }
    return res.status(500).json({
      ok: false,
      error: 'SLACK_INSTALL_URL_FAILED',
      details: message,
    });
  }
});

router.get('/slack/preflight', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const report = buildSlackPreflightResponse({
      isAdmin,
      teamIds: await listAccessibleSlackTeamIds(portalUserId, isAdmin),
    });
    return res.json({
      ok: true,
      ...report,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_PREFLIGHT_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.get('/slack/manifest', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }
    if (!isAdmin) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
      });
    }

    const bundle = buildSlackManifestBundle();
    return res.json({
      ok: true,
      ...bundle,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_MANIFEST_BUILD_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.get('/slack/status', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const installations = await listActiveSlackInstallations();
    const accessibleTeamIds = new Set(await listAccessibleSlackTeamIds(portalUserId, isAdmin));
    const visibleInstallations = isAdmin
      ? installations
      : installations.filter((installation) => accessibleTeamIds.has(installation.slackTeamId));

    return res.json({
      ok: true,
      installations: visibleInstallations.map((installation) => ({
        id: installation.id,
        slackTeamId: installation.slackTeamId,
        teamName: installation.teamName,
        enterpriseId: installation.enterpriseId,
        botUserId: installation.botUserId,
        defaultNotifyChannelId: installation.defaultNotifyChannelId,
        status: installation.status,
        settings: parseSlackInstallationSettings(installation.settingsJson),
        installedAt: installation.installedAt,
        updatedAt: installation.updatedAt,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_STATUS_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.get('/slack/users', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const teamIds = await listAccessibleSlackTeamIds(portalUserId, isAdmin);
    const teamSet = new Set(teamIds);
    const requestedTeamId = safeString(Array.isArray(req.query.slackTeamId) ? req.query.slackTeamId[0] : req.query.slackTeamId);
    if (requestedTeamId && !teamSet.has(requestedTeamId)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const slackTeamId = requestedTeamId || teamIds[0] || '';
    if (!slackTeamId) {
      return res.json({ ok: true, slackTeamId: null, users: [], synced: null });
    }

    let synced: Record<string, unknown> | null = null;
    const shouldSync = parseBoolean(Array.isArray(req.query.sync) ? req.query.sync[0] : req.query.sync, false);
    if (shouldSync) {
      synced = await syncSlackUsersFromApi({ slackTeamId });
    }

    const users = await listSlackUsersForTeam(slackTeamId);
    return res.json({
      ok: true,
      slackTeamId,
      synced,
      users,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_USERS_FETCH_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.get('/slack/channels', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const accessibleTeamIds = await listAccessibleSlackTeamIds(portalUserId, isAdmin);
    const accessibleTeamSet = new Set(accessibleTeamIds);
    const requestedTeamId = safeString(Array.isArray(req.query.slackTeamId) ? req.query.slackTeamId[0] : req.query.slackTeamId);
    if (requestedTeamId && !accessibleTeamSet.has(requestedTeamId)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const slackTeamId = requestedTeamId || accessibleTeamIds[0] || '';
    if (!slackTeamId) {
      return res.json({ ok: true, slackTeamId: null, channels: [], workspaces: [] });
    }

    const channels = await listSlackChannelsForTeam(slackTeamId);
    let workspaceRows: Array<{ id: string; name: string }> = [];
    if (isAdmin) {
      const workspaces = await prisma.researchJob.findMany({
        select: {
          id: true,
          client: { select: { name: true } },
        },
        orderBy: { startedAt: 'desc' },
        take: 200,
      });
      workspaceRows = workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.client?.name || workspace.id,
      }));
    } else {
      const memberships = await prisma.portalWorkspaceMembership.findMany({
        where: {
          userId: portalUserId,
        },
        include: {
          researchJob: {
            select: {
              id: true,
              client: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      workspaceRows = memberships.map((membership) => ({
        id: membership.researchJobId,
        name: membership.researchJob.client?.name || membership.researchJobId,
      }));
    }

    return res.json({
      ok: true,
      slackTeamId,
      channels,
      workspaces: workspaceRows,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_CHANNELS_FETCH_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.post('/slack/channels/:channelId/link', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }
    const slackChannelId = safeString(req.params.channelId);
    const slackTeamId = safeString(req.body?.slackTeamId);
    const workspaceId = safeString(req.body?.workspaceId);
    const enabled = parseBoolean(req.body?.enabled, true);
    if (!slackTeamId || !slackChannelId || !workspaceId) {
      return res.status(400).json({ error: 'slackTeamId, channelId and workspaceId are required' });
    }

    const installation = await prisma.slackInstallation.findUnique({
      where: { slackTeamId },
      select: { status: true },
    });
    if (!installation || installation.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'SLACK_INSTALLATION_NOT_FOUND' });
    }

    if (!(await canAccessWorkspace(portalUserId, workspaceId, isAdmin))) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const link = await linkSlackChannelToWorkspace({
      slackTeamId,
      slackChannelId,
      researchJobId: workspaceId,
      createdByPortalUserId: portalUserId,
      enabled,
    });

    await enqueueIntegrationJob({
      type: 'SLACK_BACKFILL_CHANNEL',
      slackTeamId,
      researchJobId: workspaceId,
      payload: {
        slackTeamId,
        slackChannelId,
      },
    });

    return res.json({ ok: true, link });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return res.status(status).json({
      ok: false,
      error: 'SLACK_CHANNEL_LINK_FAILED',
      details: message || 'Failed to link Slack channel to workspace',
    });
  }
});

router.post('/slack/channels/:channelId/owners', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }
    const slackChannelId = safeString(req.params.channelId);
    const slackTeamId = safeString(req.body?.slackTeamId);
    if (!slackTeamId || !slackChannelId) {
      return res.status(400).json({ error: 'slackTeamId and channelId are required' });
    }
    const installation = await prisma.slackInstallation.findUnique({
      where: { slackTeamId },
      select: { status: true },
    });
    if (!installation || installation.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'SLACK_INSTALLATION_NOT_FOUND' });
    }

    const link = await prisma.slackChannelLink.findUnique({
      where: {
        slackTeamId_slackChannelId: {
          slackTeamId,
          slackChannelId,
        },
      },
      select: { researchJobId: true },
    });
    if (!link?.researchJobId) {
      return res.status(404).json({ error: 'SLACK_CHANNEL_NOT_LINKED' });
    }
    if (!(await canAccessWorkspace(portalUserId, link.researchJobId, isAdmin))) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const ownersRaw = Array.isArray(req.body?.owners) ? req.body.owners : [];
    const requestedOwners = ownersRaw
      .map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const record = entry as Record<string, unknown>;
        const slackUserId = safeString(record.slackUserId);
        const ownerPortalUserId = safeString(record.portalUserId);
        if (!slackUserId) return null;
        return {
          slackUserId,
          ...(ownerPortalUserId ? { portalUserId: ownerPortalUserId } : {}),
        };
      })
      .filter(
        (entry: { slackUserId: string; portalUserId?: string } | null): entry is { slackUserId: string; portalUserId?: string } =>
          Boolean(entry)
      )
      .slice(0, 30);

    if (ownersRaw.length > 0 && requestedOwners.length === 0) {
      return res.status(400).json({ error: 'Each owner must include at least slackUserId.' });
    }

    const unresolvedSlackUserIds: string[] = [];
    const resolvedOwners: Array<{ slackUserId: string; portalUserId: string }> = [];
    const seenSlackUserIds = new Set<string>();

    for (const owner of requestedOwners) {
      if (seenSlackUserIds.has(owner.slackUserId)) continue;
      seenSlackUserIds.add(owner.slackUserId);

      let resolvedPortalUserId = owner.portalUserId ? safeString(owner.portalUserId) : '';
      if (!resolvedPortalUserId) {
        resolvedPortalUserId = (await findPortalUserBySlackUser({
          slackTeamId,
          slackUserId: owner.slackUserId,
        })) || '';
      }

      if (!resolvedPortalUserId) {
        const linkBySlackUser = await prisma.slackUserLink.findUnique({
          where: {
            slackTeamId_slackUserId: {
              slackTeamId,
              slackUserId: owner.slackUserId,
            },
          },
          select: { portalUserId: true, email: true },
        });
        if (linkBySlackUser?.portalUserId) {
          resolvedPortalUserId = linkBySlackUser.portalUserId;
        } else if (safeString(linkBySlackUser?.email)) {
          const memberByEmail = await prisma.portalWorkspaceMembership.findFirst({
            where: {
              researchJobId: link.researchJobId,
              user: {
                email: {
                  equals: safeString(linkBySlackUser?.email),
                  mode: 'insensitive',
                },
              },
            },
            select: { userId: true },
          });
          resolvedPortalUserId = memberByEmail?.userId || '';
        }
      }

      if (!resolvedPortalUserId) {
        unresolvedSlackUserIds.push(owner.slackUserId);
        continue;
      }

      resolvedOwners.push({
        slackUserId: owner.slackUserId,
        portalUserId: resolvedPortalUserId,
      });
    }

    if (unresolvedSlackUserIds.length > 0) {
      return res.status(400).json({
        error: 'Some Slack owners could not be mapped to workspace portal users.',
        unresolvedSlackUserIds,
        hint: 'Sync Slack users first, then ensure matched portal users are members of this workspace.',
      });
    }

    if (!isAdmin) {
      for (const owner of resolvedOwners) {
        const valid = await canAccessWorkspace(owner.portalUserId, link.researchJobId, false);
        if (!valid) {
          return res.status(400).json({
            error: `Owner portal user ${owner.portalUserId} is not a member of workspace ${link.researchJobId}.`,
          });
        }
      }
    }

    await setSlackChannelOwners({
      slackTeamId,
      slackChannelId,
      owners: resolvedOwners,
    });
    return res.json({ ok: true, ownersCount: resolvedOwners.length });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_CHANNEL_OWNERS_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.post('/slack/channels/:channelId/backfill', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }
    const slackChannelId = safeString(req.params.channelId);
    const slackTeamId = safeString(req.body?.slackTeamId);
    if (!slackTeamId || !slackChannelId) {
      return res.status(400).json({ error: 'slackTeamId and channelId are required' });
    }
    const installation = await prisma.slackInstallation.findUnique({
      where: { slackTeamId },
      select: { status: true },
    });
    if (!installation || installation.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'SLACK_INSTALLATION_NOT_FOUND' });
    }

    const link = await prisma.slackChannelLink.findUnique({
      where: {
        slackTeamId_slackChannelId: {
          slackTeamId,
          slackChannelId,
        },
      },
      select: { researchJobId: true },
    });
    if (!link?.researchJobId) return res.status(404).json({ error: 'SLACK_CHANNEL_NOT_LINKED' });
    if (!(await canAccessWorkspace(portalUserId, link.researchJobId, isAdmin))) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    await enqueueIntegrationJob({
      type: 'SLACK_BACKFILL_CHANNEL',
      slackTeamId,
      researchJobId: link.researchJobId,
      payload: { slackTeamId, slackChannelId },
    });
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_BACKFILL_QUEUE_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.post('/slack/settings', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const slackTeamId = safeString(req.body?.slackTeamId);
    if (!slackTeamId) {
      return res.status(400).json({ error: 'slackTeamId is required' });
    }
    const installation = await prisma.slackInstallation.findUnique({
      where: { slackTeamId },
      select: { installedByPortalUserId: true, status: true },
    });
    if (!installation || installation.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'SLACK_INSTALLATION_NOT_FOUND' });
    }
    if (!isAdmin && installation.installedByPortalUserId !== portalUserId) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const settingsPatch = req.body?.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings)
      ? req.body.settings
      : {};
    const updated = await patchSlackInstallationSettings({
      slackTeamId,
      ...(typeof req.body?.defaultNotifyChannelId !== 'undefined'
        ? { defaultNotifyChannelId: safeString(req.body.defaultNotifyChannelId) || null }
        : {}),
      settingsPatch: {
        ...(typeof settingsPatch.dmIngestionEnabled === 'boolean' ? { dmIngestionEnabled: settingsPatch.dmIngestionEnabled } : {}),
        ...(typeof settingsPatch.mpimIngestionEnabled === 'boolean' ? { mpimIngestionEnabled: settingsPatch.mpimIngestionEnabled } : {}),
        ...(typeof settingsPatch.notifyInSlack === 'boolean' ? { notifyInSlack: settingsPatch.notifyInSlack } : {}),
        ...(typeof settingsPatch.notifyInBat === 'boolean' ? { notifyInBat: settingsPatch.notifyInBat } : {}),
        ...(typeof settingsPatch.ownerDeliveryMode === 'string'
          ? { ownerDeliveryMode: settingsPatch.ownerDeliveryMode }
          : {}),
      } as any,
    });

    return res.json({
      ok: true,
      installation: {
        slackTeamId: updated.slackTeamId,
        teamName: updated.teamName,
        defaultNotifyChannelId: updated.defaultNotifyChannelId,
        settings: parseSlackInstallationSettings(updated.settingsJson),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_SETTINGS_UPDATE_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.post('/slack/purge/channel', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const slackTeamId = safeString(req.body?.slackTeamId);
    const slackChannelId = safeString(req.body?.slackChannelId);
    if (!slackTeamId || !slackChannelId) {
      return res.status(400).json({ error: 'slackTeamId and slackChannelId are required' });
    }

    const link = await prisma.slackChannelLink.findUnique({
      where: {
        slackTeamId_slackChannelId: {
          slackTeamId,
          slackChannelId,
        },
      },
      select: { researchJobId: true },
    });
    if (!isAdmin) {
      if (!link?.researchJobId) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
      const canAccess = await canAccessWorkspace(portalUserId, link.researchJobId, false);
      if (!canAccess) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const deliveries = await tx.notificationDelivery.deleteMany({
        where: {
          slackTeamId,
          slackChannelId,
        },
      });
      const attention = await tx.attentionItem.deleteMany({
        where: {
          slackTeamId,
          slackChannelId,
        },
      });
      const messages = await tx.slackMessage.deleteMany({
        where: {
          slackTeamId,
          slackChannelId,
        },
      });
      return {
        deliveries: deliveries.count,
        attentionItems: attention.count,
        messages: messages.count,
      };
    });

    return res.json({ ok: true, purged: result });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_PURGE_CHANNEL_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.post('/slack/purge/workspace', requirePortalAuth, async (req, res) => {
  try {
    const authedReq = req as AuthedPortalRequest;
    const portalUserId = String(authedReq.portalSession?.user?.id || '').trim();
    const isAdmin = Boolean(authedReq.portalSession?.user?.isAdmin);
    if (!portalUserId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    const workspaceId = safeString(req.body?.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    if (!(await canAccessWorkspace(portalUserId, workspaceId, isAdmin))) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const deliveries = await tx.notificationDelivery.deleteMany({
        where: {
          notification: {
            researchJobId: workspaceId,
          },
        },
      });
      const notifications = await tx.notification.deleteMany({
        where: {
          researchJobId: workspaceId,
        },
      });
      const attention = await tx.attentionItem.deleteMany({
        where: {
          researchJobId: workspaceId,
        },
      });
      const messages = await tx.slackMessage.deleteMany({
        where: {
          researchJobId: workspaceId,
        },
      });
      return {
        deliveries: deliveries.count,
        notifications: notifications.count,
        attentionItems: attention.count,
        messages: messages.count,
      };
    });

    return res.json({ ok: true, purged: result });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'SLACK_PURGE_WORKSPACE_FAILED',
      details: String(error?.message || error),
    });
  }
});

router.get('/workspaces', requirePortalAuth, async (req, res) => {
  const session = (req as AuthedPortalRequest).portalSession!;
  return res.json({
    workspaces: toPortalWorkspacePayload(session.user as any),
  });
});

router.get('/workspaces/:workspaceId/library', requirePortalAuth, requireWorkspaceMembership, async (req, res) => {
  try {
    const workspaceId = safeString(req.params.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const queryRaw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
    const collectionRaw = Array.isArray(req.query.collection) ? req.query.collection[0] : req.query.collection;
    const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const versionRaw = Array.isArray(req.query.v) ? req.query.v[0] : req.query.v;
    const limitParsed = Number.parseInt(String(limitRaw || ''), 10);

    const result = await listPortalWorkspaceLibrary(workspaceId, {
      query: safeString(queryRaw),
      collection: parseLibraryCollection(collectionRaw),
      limit: Number.isFinite(limitParsed) ? limitParsed : undefined,
      version: parseLibraryVersion(versionRaw),
    });

    return res.json(result);
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'LIBRARY_FETCH_FAILED', details: message || 'Failed to list workspace library' });
  }
});

router.post('/workspaces/:workspaceId/library/resolve-refs', requirePortalAuth, requireWorkspaceMembership, async (req, res) => {
  try {
    const workspaceId = safeString(req.params.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const refs = Array.isArray(req.body?.libraryRefs)
      ? req.body.libraryRefs.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 80)
      : [];
    const result = await resolvePortalWorkspaceLibraryRefs(workspaceId, refs);
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return res.status(status).json({
      ok: false,
      error: 'LIBRARY_REF_RESOLVE_FAILED',
      details: message || 'Failed to resolve library refs',
    });
  }
});

router.get('/workspaces/:workspaceId/library/diagnostics', requirePortalAuth, requireWorkspaceMembership, async (req, res) => {
  try {
    const workspaceId = safeString(req.params.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const diagnostics = await getPortalWorkspaceLibraryDiagnostics(workspaceId);
    return res.json({
      ok: true,
      diagnostics,
      flags: getPortalLibraryFeatureFlags(),
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return res.status(status).json({
      ok: false,
      error: 'LIBRARY_DIAGNOSTICS_FAILED',
      details: message || 'Failed to load library diagnostics',
    });
  }
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

router.post('/workspaces/:workspaceId/intake/draft', requirePortalAuth, requireWorkspaceMembership, async (req, res) => {
  try {
    const workspaceId = safeString(req.params.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const result = await savePortalWorkspaceIntakeDraft(workspaceId, payload);
    return res.json(result);
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: message || 'Failed to save workspace intake draft' });
  }
});

router.post(
  '/workspaces/:workspaceId/intake/enrichment/sync',
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
      const result = await syncPortalIntakeContinuousEnrichment({
        workspaceId,
        website: safeString(payload.website),
        websites: parseStringArray(payload.websites, 5),
        socialReferences: parseStringArray(payload.socialReferences, 12),
        handlesV2:
          payload.handlesV2 && typeof payload.handlesV2 === 'object'
            ? (payload.handlesV2 as Record<string, unknown>)
            : undefined,
        handles:
          payload.handles && typeof payload.handles === 'object'
            ? (payload.handles as Record<string, unknown>)
            : undefined,
        brandName: safeString(payload.name),
        trigger: safeString(payload.trigger) || 'manual_sync',
        force: parseBoolean(payload.force, false),
      });

      return res.json({
        ok: true,
        ...result,
      });
    } catch (error: any) {
      const message = String(error?.message || '');
      const status = message.toLowerCase().includes('not found') ? 404 : 500;
      return res.status(status).json({
        ok: false,
        error: message || 'Failed to sync intake enrichment',
      });
    }
  }
);

router.post(
  '/workspaces/:workspaceId/intake/websites/scan',
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
      const mode = parseIntakeScanMode(payload.mode);
      const includeSocialProfileCrawl = parseBoolean(payload.includeSocialProfileCrawl, false);
      const classified = classifyIntakeUrlInputs(
        [payload.websites, payload.website, payload.socialReferences],
        5,
        10
      );
      const websites = includeSocialProfileCrawl
        ? Array.from(new Set([...classified.crawlWebsites, ...classified.socialReferences])).slice(0, 5)
        : classified.crawlWebsites;
      if (!websites.length) {
        return res.status(400).json({ ok: false, error: 'At least one valid website is required to scan' });
      }

      const queued = await queuePortalIntakeWebsiteScan(workspaceId, websites, {
        mode,
        initiatedBy: 'USER',
      });

      return res.status(202).json({
        ok: true,
        workspaceId,
        mode: queued.mode,
        websites: queued.websites,
        socialReferences: classified.socialReferences,
        includeSocialProfileCrawl,
        scanRunId: queued.scanRunId,
        status: 'accepted',
      });
    } catch (error: any) {
      const message = String(error?.message || '');
      return res.status(500).json({ ok: false, error: message || 'Failed to start website scan' });
    }
  }
);

router.get(
  '/workspaces/:workspaceId/intake/websites/scan-runs/:scanRunId',
  requirePortalAuth,
  requireWorkspaceMembership,
  async (req, res) => {
    try {
      const workspaceId = safeString(req.params.workspaceId);
      const scanRunId = safeString(req.params.scanRunId);
      if (!workspaceId || !scanRunId) {
        return res.status(400).json({ error: 'workspaceId and scanRunId are required' });
      }

      const run = await getPortalIntakeScanRun(workspaceId, scanRunId);
      if (!run) {
        return res.status(404).json({ error: 'Scan run not found' });
      }

      return res.json({
        ok: true,
        scanRun: run,
      });
    } catch (error: any) {
      const message = String(error?.message || '');
      return res.status(500).json({ error: message || 'Failed to load intake scan run' });
    }
  }
);

router.get(
  '/workspaces/:workspaceId/intake/events',
  requirePortalAuth,
  requireWorkspaceMembership,
  async (req, res) => {
    try {
      const workspaceId = safeString(req.params.workspaceId);
      if (!workspaceId) {
        return res.status(400).json({ error: 'workspaceId is required' });
      }

      const afterIdRaw =
        (Array.isArray(req.query.afterId) ? req.query.afterId[0] : req.query.afterId) ||
        req.header('last-event-id') ||
        undefined;
      const afterIdParsed = afterIdRaw ? Number.parseInt(String(afterIdRaw), 10) : undefined;
      const afterId = Number.isFinite(afterIdParsed as number) ? (afterIdParsed as number) : undefined;
      const scanRunIdRaw = Array.isArray(req.query.scanRunId) ? req.query.scanRunId[0] : req.query.scanRunId;
      const scanRunId = safeString(scanRunIdRaw);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      res.write('retry: 3000\n\n');

      const backlog = await listPortalIntakeEvents(workspaceId, {
        afterId,
        limit: 200,
        ...(scanRunId ? { scanRunId } : {}),
      });
      for (const event of backlog) {
        res.write(serializePortalIntakeEventSse(event));
      }

      const unsubscribe = subscribePortalIntakeEvents(workspaceId, (event) => {
        if (scanRunId && event.scanRunId !== scanRunId) return;
        res.write(serializePortalIntakeEventSse(event));
      });

      const heartbeat = setInterval(() => {
        res.write(`event: ping\ndata: {"time":"${new Date().toISOString()}"}\n\n`);
      }, 25000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    } catch (error: any) {
      const message = String(error?.message || '');
      return res.status(500).json({ error: message || 'Failed to open intake events stream' });
    }
  }
);

router.get('/admin/intake/scan-runs', requirePortalAuth, async (req, res) => {
  try {
    const authed = req as AuthedPortalRequest;
    if (!authed.portalSession?.user?.isAdmin) {
      return res.status(403).json({ error: 'ADMIN_REQUIRED' });
    }

    const workspaceIdRaw = Array.isArray(req.query.workspaceId) ? req.query.workspaceId[0] : req.query.workspaceId;
    const workspaceId = safeString(workspaceIdRaw);
    const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limitParsed = Number.parseInt(String(limitRaw || ''), 10);
    const limit = Number.isFinite(limitParsed) ? Math.max(1, Math.min(200, limitParsed)) : 50;

    const scanRuns = await listPortalIntakeScanRunsWithEventCounts({
      ...(workspaceId ? { workspaceId } : {}),
      limit,
    });

    return res.json({
      ok: true,
      diagnostics: getPortalIntakeEventStoreDiagnostics(),
      scanRuns,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    return res.status(500).json({ error: message || 'Failed to load intake scan diagnostics' });
  }
});

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
