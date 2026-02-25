import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { promisify } from 'node:util';
import { Prisma, ResearchJobStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const scryptAsync = promisify(crypto.scrypt);

export const PORTAL_SESSION_COOKIE_NAME = 'portal_session';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const VERIFY_EMAIL_TTL_MS = 1000 * 60 * 60 * 48; // 48 hours

type PortalUserWithMemberships = {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  emailVerifiedAt: Date | null;
  isAdmin: boolean;
  memberships: Array<{
    role: string;
    researchJobId: string;
    createdAt: Date;
    researchJob: {
      id: string;
      status: string;
      startedAt: Date | null;
      inputData: Prisma.JsonValue | null;
      client: {
        id: string;
        name: string;
      } | null;
    };
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.split('=');
    const name = rawName?.trim();
    if (!name) continue;
    const value = rest.join('=').trim();
    out[name] = decodeURIComponent(value || '');
  }
  return out;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function makeToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getBasePortalUrl(req?: Request): string {
  const configured = String(process.env.PORTAL_BASE_URL || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const originHeader = String(req?.headers.origin || '').trim();
  if (/^https?:\/\//i.test(originHeader)) {
    return originHeader.replace(/\/+$/, '');
  }

  const host = String(req?.headers.host || 'localhost:3000');
  const proto = String(req?.headers['x-forwarded-proto'] || '').trim() || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

async function sendPortalEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ provider: 'resend' | 'console'; id?: string }> {
  const resendKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.PORTAL_EMAIL_FROM || process.env.EMAIL_FROM || '').trim();

  if (!resendKey || !from) {
    console.log('[PortalEmail:console]', {
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { provider: 'console' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Email send failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const id = isRecord(payload) && typeof payload.id === 'string' ? payload.id : undefined;
  return { provider: 'resend', id };
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (expectedBuffer.length !== derived.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, derived);
}

export function readSessionTokenFromRequest(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[PORTAL_SESSION_COOKIE_NAME];
  if (!token) return null;
  return token.trim() || null;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(PORTAL_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(PORTAL_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

export async function createPortalSession(input: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  const token = makeToken(32);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.portalSession.create({
    data: {
      userId: input.userId,
      tokenHash,
      expiresAt,
      userAgent: input.userAgent || null,
      ipAddress: input.ipAddress || null,
    },
  });

  return { token, expiresAt };
}

export async function revokePortalSessionByToken(token: string) {
  const tokenHash = sha256(token);
  await prisma.portalSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function revokeAllPortalSessionsForUser(userId: string) {
  await prisma.portalSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function getPortalSessionFromToken(token: string) {
  const tokenHash = sha256(token);
  const session = await prisma.portalSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: {
            include: {
              researchJob: {
                include: { client: true },
              },
            },
          },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return session;
}

export async function getPortalSessionFromRequest(req: Request) {
  const token = readSessionTokenFromRequest(req);
  if (!token) return null;
  return getPortalSessionFromToken(token);
}

export function toPortalUserPayload(user: PortalUserWithMemberships) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    companyName: user.companyName,
    emailVerifiedAt: user.emailVerifiedAt,
    emailVerified: Boolean(user.emailVerifiedAt),
    isAdmin: user.isAdmin,
  };
}

export function toPortalWorkspacePayload(user: PortalUserWithMemberships) {
  function intakeReadyFromInputData(value: Prisma.JsonValue | null): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;

    const handlesRaw = record.handles;
    if (!handlesRaw || typeof handlesRaw !== 'object' || Array.isArray(handlesRaw)) return false;

    return Object.values(handlesRaw).some((handle) => String(handle || '').trim().length > 0);
  }

  return user.memberships.map((membership) => ({
    id: membership.researchJob.id,
    status: membership.researchJob.status,
    startedAt: membership.researchJob.startedAt,
    createdAt: membership.researchJob.startedAt || membership.createdAt,
    intakeReady: intakeReadyFromInputData(membership.researchJob.inputData),
    role: membership.role,
    client: membership.researchJob.client
      ? {
          id: membership.researchJob.client.id,
          name: membership.researchJob.client.name,
        }
      : undefined,
  }));
}

export async function touchPortalSession(sessionId: string) {
  await prisma.portalSession.update({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() },
  });
}

export async function createWorkspaceForNewSignup(input: {
  companyName?: string | null;
  fallbackEmail: string;
}, db: Pick<Prisma.TransactionClient, 'client' | 'researchJob'> = prisma) {
  const companyName = String(input.companyName || '').trim();
  const fallbackName = input.fallbackEmail.split('@')[0] || 'New Workspace';
  const client = await db.client.create({
    data: {
      name: companyName || fallbackName,
    },
  });

  const researchJob = await db.researchJob.create({
    data: {
      clientId: client.id,
      status: ResearchJobStatus.PENDING,
      startedAt: new Date(),
      inputData: {
        source: 'portal_signup',
      },
    },
    include: {
      client: true,
    },
  });

  return researchJob;
}

export async function issuePortalEmailVerificationToken(userId: string) {
  const token = makeToken(28);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + VERIFY_EMAIL_TTL_MS);

  await prisma.portalEmailToken.create({
    data: {
      userId,
      type: 'VERIFY_EMAIL',
      tokenHash,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function consumeEmailVerificationToken(token: string): Promise<string | null> {
  const tokenHash = sha256(token);
  const tokenRow = await prisma.portalEmailToken.findUnique({
    where: { tokenHash },
  });

  if (!tokenRow) return null;
  if (tokenRow.type !== 'VERIFY_EMAIL') return null;
  if (tokenRow.usedAt) return null;
  if (tokenRow.expiresAt.getTime() <= Date.now()) return null;

  await prisma.$transaction(async (tx) => {
    await tx.portalEmailToken.update({
      where: { id: tokenRow.id },
      data: { usedAt: new Date() },
    });

    await tx.portalUser.update({
      where: { id: tokenRow.userId },
      data: { emailVerifiedAt: new Date() },
    });
  });

  return tokenRow.userId;
}

export async function sendVerificationEmail(input: {
  email: string;
  token: string;
  fullName?: string | null;
  req?: Request;
}) {
  const base = getBasePortalUrl(input.req);
  const verifyUrl = `${base}/verify-email?token=${encodeURIComponent(input.token)}`;
  const salutation = input.fullName ? `Hi ${input.fullName},` : 'Hi there,';
  const subject = 'Verify your BAT account';
  const text = `${salutation}\n\nVerify your account by opening this link:\n${verifyUrl}\n\nIf you did not create this account, you can ignore this email.`;
  const html = `<p>${salutation}</p><p>Verify your account by clicking the link below:</p><p><a href=\"${verifyUrl}\">${verifyUrl}</a></p><p>If you did not create this account, you can ignore this email.</p>`;

  return sendPortalEmail({
    to: input.email,
    subject,
    text,
    html,
  });
}
