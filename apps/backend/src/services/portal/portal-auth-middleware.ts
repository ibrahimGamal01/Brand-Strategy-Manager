import type { NextFunction, Request, Response } from 'express';
import { getPortalSessionFromRequest, touchPortalSession } from './portal-auth';

export type AuthedPortalRequest = Request & {
  portalSession?: NonNullable<Awaited<ReturnType<typeof getPortalSessionFromRequest>>>;
};

export async function requirePortalAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await getPortalSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    (req as AuthedPortalRequest).portalSession = session;
    void touchPortalSession(session.id).catch(() => {
      // Best effort; do not block requests on touch failures.
    });
    return next();
  } catch (error: any) {
    return res.status(500).json({ error: 'AUTH_CHECK_FAILED', details: error?.message || String(error) });
  }
}

export function requireWorkspaceMembership(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authed = req as AuthedPortalRequest;
  const session = authed.portalSession;
  if (!session) {
    return res.status(401).json({ error: 'AUTH_REQUIRED' });
  }

  const workspaceId = String(req.params.id || req.params.workspaceId || '').trim();
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (session.user.isAdmin) {
    return next();
  }

  const hasAccess = session.user.memberships.some(
    (membership: { researchJobId: string }) => membership.researchJobId === workspaceId
  );
  if (!hasAccess) {
    return res.status(403).json({ error: 'FORBIDDEN_WORKSPACE' });
  }

  return next();
}
