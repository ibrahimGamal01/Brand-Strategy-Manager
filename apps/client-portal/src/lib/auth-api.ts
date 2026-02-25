import { RuntimeWorkspace } from "@/types/chat";

export interface PortalUser {
  id: string;
  email: string;
  fullName?: string | null;
  companyName?: string | null;
  emailVerified: boolean;
  emailVerifiedAt?: string | null;
  isAdmin: boolean;
}

export interface PortalMeResponse {
  user: PortalUser;
  workspaces: RuntimeWorkspace[];
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.details === "string"
          ? payload.details
          : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export async function signupPortal(input: {
  email: string;
  password: string;
  fullName?: string;
  companyName?: string;
}) {
  const response = await fetch("/api/portal/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return parseJson<PortalMeResponse & { emailDelivery?: { provider: string; id?: string } }>(response);
}

export async function loginPortal(input: { email: string; password: string }) {
  const response = await fetch("/api/portal/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return parseJson<PortalMeResponse>(response);
}

export async function logoutPortal() {
  const response = await fetch("/api/portal/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  return parseJson<{ ok: boolean }>(response);
}

export async function getPortalMe() {
  const response = await fetch("/api/portal/auth/me", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<PortalMeResponse>(response);
}

export async function verifyPortalEmail(token: string) {
  const response = await fetch(`/api/portal/auth/verify-email?token=${encodeURIComponent(token)}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{ ok: boolean; userId: string }>(response);
}

export async function resendPortalVerification() {
  const response = await fetch("/api/portal/auth/resend-verification", {
    method: "POST",
    credentials: "include",
  });
  return parseJson<{ ok: boolean; alreadyVerified?: boolean; delivery?: { provider: string; id?: string } }>(response);
}
