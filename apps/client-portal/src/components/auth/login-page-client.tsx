"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getPortalMe, loginPortal, resendPortalVerification } from "@/lib/auth-api";

export function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const next = searchParams.get("next") || "/app";
  const verified = searchParams.get("verified");
  const emailFromQuery = searchParams.get("email") || "";
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPortalMe()
      .then(() => {
        if (!active) return;
        router.replace("/app");
      })
      .catch(() => undefined)
      .finally(() => {
        if (!active) return;
        setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (emailFromQuery) {
      setEmail(emailFromQuery);
    }
  }, [emailFromQuery]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await loginPortal({ email, password });
      router.push(next);
    } catch (submitError: any) {
      const message = String(submitError?.message || "Login failed");
      if (message.includes("INVALID_CREDENTIALS")) {
        setError("Invalid email or password.");
      } else if (message.includes("EMAIL_NOT_VERIFIED")) {
        setError("Email not verified yet.");
        setNotice("Verify your email code to continue.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim()) {
      setError("Enter your email to resend verification.");
      return;
    }

    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const payload = await resendPortalVerification(email.trim());
      if (payload.alreadyVerified) {
        setNotice("Email is already verified. Try logging in again.");
      } else if (payload.delivery?.provider === "console") {
        setNotice("Verification email is in console mode. Use code 00000 in this environment.");
      } else {
        setNotice("Verification code sent. Check your inbox.");
      }
    } catch (resendError: any) {
      setError(String(resendError?.message || "Failed to resend verification code."));
    } finally {
      setResending(false);
    }
  };

  if (checking) {
    return (
      <section className="bat-shell grid min-h-[70vh] place-items-center py-12">
        <div className="bat-surface w-full max-w-md p-7 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Checking session...
        </div>
      </section>
    );
  }

  return (
    <section className="bat-shell grid min-h-[70vh] place-items-center py-12">
      <div className="bat-surface w-full max-w-md p-7">
        <h1 className="text-2xl font-semibold">Log in to BAT</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Continue to your workspaces and live activity stream.
        </p>
        {verified ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
            Your email is verified. You can log in now.
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
            {notice}
          </p>
        ) : null}
        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            Email
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)" }}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)" }}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-70"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/verify-email-code${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`}
            className="rounded-full border px-4 py-2"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Verify email code
          </Link>
          <button
            type="button"
            className="rounded-full border px-4 py-2"
            style={{ borderColor: "var(--bat-border)" }}
            disabled={resending}
            onClick={handleResend}
          >
            {resending ? "Sending..." : "Resend code"}
          </button>
        </div>
        <p className="mt-4 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          No account? <Link href="/signup">Create one</Link>
        </p>
      </div>
    </section>
  );
}
