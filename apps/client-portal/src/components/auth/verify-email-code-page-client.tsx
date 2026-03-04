"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getPortalMe, resendPortalVerification, verifyPortalEmailCode } from "@/lib/auth-api";
import { Badge, Button, Input } from "@/components/ui";

export function VerifyEmailCodePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => email.trim().length > 0 && code.trim().length > 0 && !submitting,
    [email, code, submitting]
  );

  useEffect(() => {
    let active = true;
    getPortalMe()
      .then(() => {
        if (!active) return;
        router.replace("/app");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await verifyPortalEmailCode({ email, code });
      setNotice("Email verified. You can now log in.");
      router.push(`/login?verified=1&email=${encodeURIComponent(email)}`);
    } catch (submitError: any) {
      const message = String(submitError?.message || "Verification failed");
      if (message.includes("INVALID_VERIFICATION_CODE")) {
        setError("Invalid verification code.");
      } else if (message.includes("VERIFICATION_CHALLENGE_EXPIRED")) {
        setError("Code expired. Please resend verification.");
      } else if (message.includes("INVALID_EMAIL")) {
        setError("Please enter a valid email.");
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const payload = await resendPortalVerification(email.trim());
      if (payload.alreadyVerified) {
        setNotice("Email already verified. You can log in now.");
      } else if (payload.delivery?.provider === "console") {
        setNotice("Verification email is in console mode. Use code 00000 in this environment.");
      } else {
        setNotice("Verification code sent. Check your inbox.");
      }
    } catch (resendError: any) {
      setError(String(resendError?.message || "Failed to resend verification."));
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="bat-shell grid min-h-[70vh] place-items-center py-12">
      <div className="bat-panel w-full max-w-md p-7">
        <Badge className="mb-4">Verification</Badge>
        <h1 className="bat-heading-md">Verify your email code</h1>
        <p className="mt-2 text-sm bat-text-muted">Enter the code from your inbox to activate login.</p>

        {error ? <p className="bat-panel-muted bat-status-danger mt-3 rounded-xl px-3 py-2 text-sm">{error}</p> : null}
        {notice ? <p className="bat-panel-muted mt-3 rounded-xl px-3 py-2 text-sm">{notice}</p> : null}

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            Work email
            <Input
              className="mt-1"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Verification code
            <Input
              className="mt-1"
              type="text"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="00000"
            />
          </label>
          <Button type="submit" disabled={!canSubmit} className="w-full">
            {submitting ? "Verifying..." : "Verify code"}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Button variant="secondary" disabled={resending} onClick={onResend}>
            {resending ? "Sending..." : "Resend code"}
          </Button>
          <Link href="/login" className="bat-button bat-button-secondary">
            Back to login
          </Link>
        </div>
      </div>
    </section>
  );
}
