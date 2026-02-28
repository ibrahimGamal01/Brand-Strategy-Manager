"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPortalMe, signupPortal } from "@/lib/auth-api";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [additionalWebsites, setAdditionalWebsites] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

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

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setEmailNotice(null);
    setLoading(true);
    try {
      const payload = await signupPortal({
        email,
        password,
        fullName,
        companyName,
        website,
        websites: additionalWebsites
          .split(/[\n,]+/)
          .map((entry) => entry.trim())
          .filter(Boolean)
          .slice(0, 5),
      });

      if (payload.emailDelivery?.provider === "console") {
        setEmailNotice("Verification email is in console mode. Use code 00000 to continue in this environment.");
      } else {
        setEmailNotice("Verification code sent. Check your inbox and continue to verification.");
      }

      router.push(`/verify-email-code?email=${encodeURIComponent(email)}`);
    } catch (submitError: any) {
      const message = String(submitError?.message || "Sign up failed");
      if (message.includes("EMAIL_ALREADY_EXISTS")) {
        setError("An account with this email already exists.");
      } else if (message.includes("INVALID_EMAIL")) {
        setError("Please enter a valid email.");
      } else if (message.includes("INVALID_PASSWORD")) {
        setError("Password must be at least 8 characters.");
      } else if (message.includes("website")) {
        setError("Please enter at least one valid website.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
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
        <h1 className="text-2xl font-semibold">Create your BAT workspace</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Start free and launch onboarding directly in chat.
        </p>
        {error ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
            {error}
          </p>
        ) : null}
        {emailNotice ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
            {emailNotice}
          </p>
        ) : null}
        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            Full name
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)" }}
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="block text-sm">
            Work email
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
            Company name
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)" }}
              type="text"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              autoComplete="organization"
            />
          </label>
          <label className="block text-sm">
            Website
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)" }}
              type="url"
              placeholder="https://yourcompany.com"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              required
              autoComplete="url"
            />
          </label>
          <label className="block text-sm">
            Additional websites (optional)
            <textarea
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", minHeight: 76 }}
              placeholder="One per line, e.g. https://subdomain.yourcompany.com"
              value={additionalWebsites}
              onChange={(event) => setAdditionalWebsites(event.target.value)}
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
              autoComplete="new-password"
              minLength={8}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-70"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            {loading ? "Creating workspace..." : "Create workspace"}
          </button>
        </form>
        <p className="mt-4 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Already onboarded? <Link href="/login">Log in</Link>
        </p>
      </div>
    </section>
  );
}
