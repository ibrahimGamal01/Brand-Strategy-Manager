"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPortalMe, signupPortal } from "@/lib/auth-api";
import { Badge, Button, Input } from "@/components/ui";

type SignupFieldKey = "email" | "password" | "website";

function parseMultiLineEntries(value: string, limit: number): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function validateClientFields(input: { email: string; password: string; website: string }): Partial<Record<SignupFieldKey, string>> {
  const next: Partial<Record<SignupFieldKey, string>> = {};

  if (!input.email.trim()) {
    next.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    next.email = "Enter a valid email address.";
  }

  if (!input.password.trim()) {
    next.password = "Password is required.";
  } else if (input.password.trim().length < 8) {
    next.password = "Password must be at least 8 characters.";
  }

  if (!input.website.trim()) {
    next.website = "Website is required.";
  }

  return next;
}

function firstInvalidFieldKey(errors: Partial<Record<SignupFieldKey, string>>): SignupFieldKey | null {
  const order: SignupFieldKey[] = ["email", "password", "website"];
  return order.find((field) => Boolean(errors[field])) || null;
}

const baseFieldClass = "mt-1";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [additionalWebsites, setAdditionalWebsites] = useState("");
  const [socialReferences, setSocialReferences] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignupFieldKey, string>>>({});
  const inputRefs = useRef<Partial<Record<SignupFieldKey, HTMLInputElement | null>>>({});

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

    const nextFieldErrors = validateClientFields({ email, password, website });
    setFieldErrors(nextFieldErrors);

    const firstInvalid = firstInvalidFieldKey(nextFieldErrors);
    if (firstInvalid) {
      setError("Please review the highlighted fields before continuing.");
      window.setTimeout(() => {
        const target = inputRefs.current[firstInvalid];
        target?.focus();
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
      return;
    }

    setLoading(true);
    try {
      const payload = await signupPortal({
        email,
        password,
        fullName,
        companyName,
        website,
        websites: parseMultiLineEntries(additionalWebsites, 5),
        socialReferences: parseMultiLineEntries(socialReferences, 12),
      });

      if (payload.emailDelivery?.provider === "console") {
        setEmailNotice("Verification email is in console mode. Use code 00000 to continue in this environment.");
      } else {
        setEmailNotice("Verification code sent. Check your inbox and continue to verification.");
      }

      router.replace(`/verify-email-code?email=${encodeURIComponent(email)}`);
    } catch (submitError: any) {
      const message = String(submitError?.message || "Sign up failed");
      if (message.includes("EMAIL_ALREADY_EXISTS")) {
        setError("An account with this email already exists.");
      } else if (message.includes("INVALID_EMAIL")) {
        setFieldErrors((current) => ({ ...current, email: "Please enter a valid email." }));
        setError("Please enter a valid email.");
      } else if (message.includes("INVALID_PASSWORD")) {
        setFieldErrors((current) => ({ ...current, password: "Password must be at least 8 characters." }));
        setError("Password must be at least 8 characters.");
      } else if (message.includes("website") || message.includes("WEBSITE_REQUIRED")) {
        setFieldErrors((current) => ({ ...current, website: "Please enter at least one valid website." }));
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
        <div className="bat-panel w-full max-w-md p-7 text-sm bat-text-muted">Checking session...</div>
      </section>
    );
  }

  return (
    <section className="bat-shell py-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="bat-panel p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <Badge>Create workspace</Badge>
              <h1 className="bat-heading-md mt-3">Create your BAT workspace</h1>
              <p className="mt-1 text-xs bat-text-muted">Verify email, then continue setup in chat.</p>
            </div>
            <p className="bat-chip">Background research starts automatically</p>
          </div>

          <div className="min-h-8 space-y-2" aria-live="polite">
            {error ? <p className="bat-panel-muted bat-status-danger rounded-xl px-3 py-2 text-sm">{error}</p> : null}
            {emailNotice ? <p className="bat-panel-muted rounded-xl px-3 py-2 text-sm">{emailNotice}</p> : null}
          </div>

          <form className="mt-3 space-y-4" onSubmit={onSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Full name
                <Input
                  className={baseFieldClass}
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className="block text-sm">
                Work email
                <Input
                  ref={(node) => {
                    inputRefs.current.email = node;
                  }}
                  aria-invalid={Boolean(fieldErrors.email)}
                  className={baseFieldClass}
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setFieldErrors((current) => ({ ...current, email: undefined }));
                  }}
                  required
                  autoComplete="email"
                />
                <span className="mt-1 block min-h-4 text-xs text-[color:var(--bat-danger)]">{fieldErrors.email || ""}</span>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Company name
                <Input
                  className={baseFieldClass}
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  autoComplete="organization"
                />
              </label>
              <label className="block text-sm">
                Website
                <Input
                  ref={(node) => {
                    inputRefs.current.website = node;
                  }}
                  aria-invalid={Boolean(fieldErrors.website)}
                  className={baseFieldClass}
                  type="url"
                  placeholder="https://yourcompany.com"
                  value={website}
                  onChange={(event) => {
                    setWebsite(event.target.value);
                    setFieldErrors((current) => ({ ...current, website: undefined }));
                  }}
                  required
                  autoComplete="url"
                />
                <span className="mt-1 block min-h-4 text-xs text-[color:var(--bat-danger)]">{fieldErrors.website || ""}</span>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Additional websites (optional)
                <textarea
                  className="bat-textarea mt-1"
                  placeholder="One per line"
                  value={additionalWebsites}
                  onChange={(event) => setAdditionalWebsites(event.target.value)}
                />
              </label>

              <label className="block text-sm">
                Social profile references (optional)
                <textarea
                  className="bat-textarea mt-1"
                  placeholder="LinkedIn / Instagram / TikTok / YouTube / X"
                  value={socialReferences}
                  onChange={(event) => setSocialReferences(event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block text-sm">
                Password
                <Input
                  ref={(node) => {
                    inputRefs.current.password = node;
                  }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  className={baseFieldClass}
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFieldErrors((current) => ({ ...current, password: undefined }));
                  }}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
                <span className="mt-1 block min-h-4 text-xs text-[color:var(--bat-danger)]">
                  {fieldErrors.password || "Use at least 8 characters."}
                </span>
              </label>

              <Button type="submit" disabled={loading} className="h-11 px-6">
                {loading ? "Creating workspace..." : "Create workspace"}
              </Button>
            </div>
          </form>

          <p className="mt-3 text-sm bat-text-muted">
            Already onboarded? <Link href="/login" className="font-semibold text-[color:var(--bat-text)]">Log in</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
