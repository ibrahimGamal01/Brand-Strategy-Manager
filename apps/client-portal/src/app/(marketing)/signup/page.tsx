"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPortalMe, signupPortal } from "@/lib/auth-api";
import { SignupActionBar } from "@/components/auth/signup/signup-action-bar";
import { SignupContextRail } from "@/components/auth/signup/signup-context-rail";
import { SignupSectionNav } from "@/components/auth/signup/signup-section-nav";
import { SignupSectionId, SignupValidationState, useSignupScroll } from "@/components/auth/signup/use-signup-scroll";

type SignupFieldKey = "email" | "password" | "website";

const SMART_SCROLL_ENABLED = String(process.env.NEXT_PUBLIC_PORTAL_SIGNUP_SMART_SCROLL_V1 ?? "true").toLowerCase() !== "false";

const SECTION_DEFS: Array<{ id: SignupSectionId; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "company", label: "Company" },
  { id: "web", label: "Web sources" },
  { id: "social", label: "Social" },
  { id: "review", label: "Review" },
];

function parseMultiLineEntries(value: string, limit: number): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  const next = Math.min(Math.max(element.scrollHeight, 112), 260);
  element.style.height = `${next}px`;
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

function sectionForField(field: SignupFieldKey): SignupSectionId {
  if (field === "website") return "company";
  return "identity";
}

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

  const additionalWebsiteRef = useRef<HTMLTextAreaElement | null>(null);
  const socialReferenceRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRefs = useRef<Partial<Record<SignupFieldKey, HTMLInputElement | null>>>({});

  const { activeSection, registerSection, scrollToSection } = useSignupScroll({
    sectionIds: SECTION_DEFS.map((section) => section.id),
    sectionTopOffset: 130,
    storageKey: "bat.signup.scrollY.v1",
  });

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
    resizeTextarea(additionalWebsiteRef.current);
  }, [additionalWebsites]);

  useEffect(() => {
    resizeTextarea(socialReferenceRef.current);
  }, [socialReferences]);

  const liveInvalidCount = useMemo(() => {
    return Object.keys(
      validateClientFields({
        email,
        password,
        website,
      })
    ).length;
  }, [email, password, website]);

  const sectionValidation = useMemo<SignupValidationState>(() => {
    const hasIdentity = Boolean(email.trim()) && Boolean(password.trim()) && password.trim().length >= 8;
    const hasCompany = Boolean(website.trim());
    const webEntries = parseMultiLineEntries(additionalWebsites, 5);
    const socialEntries = parseMultiLineEntries(socialReferences, 12);

    return {
      identity: {
        complete: hasIdentity,
        errorCount: Number(Boolean(fieldErrors.email)) + Number(Boolean(fieldErrors.password)),
      },
      company: {
        complete: hasCompany,
        errorCount: Number(Boolean(fieldErrors.website)),
      },
      web: {
        complete: webEntries.length >= 0,
        errorCount: 0,
      },
      social: {
        complete: socialEntries.length >= 0,
        errorCount: 0,
      },
      review: {
        complete: hasIdentity && hasCompany,
        errorCount: liveInvalidCount,
      },
    };
  }, [additionalWebsites, email, fieldErrors.email, fieldErrors.password, fieldErrors.website, liveInvalidCount, password, socialReferences, website]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setEmailNotice(null);

    const nextFieldErrors = validateClientFields({ email, password, website });
    setFieldErrors(nextFieldErrors);

    const firstInvalid = firstInvalidFieldKey(nextFieldErrors);
    if (firstInvalid) {
      setError("Please review the highlighted fields before continuing.");
      const owningSection = sectionForField(firstInvalid);
      scrollToSection(owningSection);
      window.setTimeout(() => {
        const target = inputRefs.current[firstInvalid];
        target?.focus();
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 120);
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
        scrollToSection("identity");
      } else if (message.includes("INVALID_PASSWORD")) {
        setFieldErrors((current) => ({ ...current, password: "Password must be at least 8 characters." }));
        setError("Password must be at least 8 characters.");
        scrollToSection("identity");
      } else if (message.includes("website") || message.includes("WEBSITE_REQUIRED")) {
        setFieldErrors((current) => ({ ...current, website: "Please enter at least one valid website." }));
        setError("Please enter at least one valid website.");
        scrollToSection("company");
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

  if (!SMART_SCROLL_ENABLED) {
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
              <input className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }} type="text" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
            </label>
            <label className="block text-sm">
              Work email
              <input className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
            </label>
            <label className="block text-sm">
              Company name
              <input className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }} type="text" value={companyName} onChange={(event) => setCompanyName(event.target.value)} autoComplete="organization" />
            </label>
            <label className="block text-sm">
              Website
              <input className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }} type="url" placeholder="https://yourcompany.com" value={website} onChange={(event) => setWebsite(event.target.value)} required autoComplete="url" />
            </label>
            <label className="block text-sm">
              Additional websites (optional)
              <textarea className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)", minHeight: 76 }} placeholder="One per line, e.g. https://subdomain.yourcompany.com" value={additionalWebsites} onChange={(event) => setAdditionalWebsites(event.target.value)} />
            </label>
            <label className="block text-sm">
              Social profile references (optional)
              <textarea className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)", minHeight: 76 }} placeholder="LinkedIn / Instagram / TikTok / YouTube / X URLs (one per line)" value={socialReferences} onChange={(event) => setSocialReferences(event.target.value)} />
            </label>
            <label className="block text-sm">
              Password
              <input className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" minLength={8} />
            </label>
            <button type="submit" disabled={loading} className="w-full rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-70" style={{ background: "var(--bat-accent)", color: "white" }}>
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

  return (
    <section className="bat-shell-app signup-smart-shell py-8 sm:py-10">
      <div className="mx-auto w-full max-w-[1520px]">
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <header className="mb-5 space-y-2">
              <p className="text-xs uppercase tracking-[0.14em]" style={{ color: "var(--bat-text-muted)" }}>
                Website-first onboarding
              </p>
              <h1 className="text-3xl font-semibold sm:text-4xl">Create your BAT workspace</h1>
              <p className="max-w-3xl text-sm sm:text-base" style={{ color: "var(--bat-text-muted)" }}>
                Share your core brand details once. BAT handles background research after signup and guides your setup inside chat.
              </p>
              <p className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)", color: "var(--bat-text-muted)" }}>
                BAT starts background research after signup. Source details appear in Library.
              </p>
            </header>

            <SignupSectionNav
              sections={SECTION_DEFS}
              activeSection={activeSection}
              validation={sectionValidation}
              onSelect={scrollToSection}
            />

            <div className="signup-feedback-shell mt-4" aria-live="polite">
              {error ? (
                <p className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
                  {error}
                </p>
              ) : null}
              {emailNotice ? (
                <p className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
                  {emailNotice}
                </p>
              ) : null}
            </div>

            <form id="signup-smart-form" noValidate onSubmit={onSubmit} className="space-y-5 pb-36 sm:pb-40">
              <section id="signup-section-identity" ref={registerSection("identity")} className="signup-section-anchor bat-surface p-5 sm:p-6">
                <h2 className="text-lg font-semibold">Identity</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  Account owner details for verification and access.
                </p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                      ref={(node) => {
                        inputRefs.current.email = node;
                      }}
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      style={{ borderColor: fieldErrors.email ? "#f4b8b4" : "var(--bat-border)" }}
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setFieldErrors((current) => ({ ...current, email: undefined }));
                      }}
                      required
                      autoComplete="email"
                    />
                    <span id="signup-email-error" className="mt-1 block min-h-5 text-xs" style={{ color: "#9f2317" }}>
                      {fieldErrors.email || ""}
                    </span>
                  </label>
                </div>

                <label className="mt-2 block text-sm">
                  Password
                  <input
                    ref={(node) => {
                      inputRefs.current.password = node;
                    }}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    style={{ borderColor: fieldErrors.password ? "#f4b8b4" : "var(--bat-border)" }}
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
                  <span id="signup-password-error" className="mt-1 block min-h-5 text-xs" style={{ color: "#9f2317" }}>
                    {fieldErrors.password || "Use at least 8 characters."}
                  </span>
                </label>
              </section>

              <section id="signup-section-company" ref={registerSection("company")} className="signup-section-anchor bat-surface p-5 sm:p-6">
                <h2 className="text-lg font-semibold">Company</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  Core brand source BAT uses first in research and planning.
                </p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                      ref={(node) => {
                        inputRefs.current.website = node;
                      }}
                      aria-invalid={Boolean(fieldErrors.website)}
                      aria-describedby={fieldErrors.website ? "signup-website-error" : undefined}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      style={{ borderColor: fieldErrors.website ? "#f4b8b4" : "var(--bat-border)" }}
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
                    <span id="signup-website-error" className="mt-1 block min-h-5 text-xs" style={{ color: "#9f2317" }}>
                      {fieldErrors.website || ""}
                    </span>
                  </label>
                </div>
              </section>

              <section id="signup-section-web" ref={registerSection("web")} className="signup-section-anchor bat-surface p-5 sm:p-6">
                <h2 className="text-lg font-semibold">Web sources</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  Add extra pages or domains BAT should include in initial context.
                </p>

                <label className="mt-4 block text-sm">
                  Additional websites
                  <textarea
                    ref={additionalWebsiteRef}
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    style={{ borderColor: "var(--bat-border)", minHeight: 112 }}
                    placeholder="One per line, e.g. https://subdomain.yourcompany.com"
                    value={additionalWebsites}
                    onChange={(event) => setAdditionalWebsites(event.target.value)}
                  />
                  <span className="mt-1 block text-xs" style={{ color: "var(--bat-text-muted)" }}>
                    Up to 5 URLs. Comma-separated or one-per-line both work.
                  </span>
                </label>
              </section>

              <section id="signup-section-social" ref={registerSection("social")} className="signup-section-anchor bat-surface p-5 sm:p-6">
                <h2 className="text-lg font-semibold">Social references</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  LinkedIn, Instagram, TikTok, YouTube, or X links improve channel suggestions.
                </p>

                <label className="mt-4 block text-sm">
                  Social profile references
                  <textarea
                    ref={socialReferenceRef}
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    style={{ borderColor: "var(--bat-border)", minHeight: 112 }}
                    placeholder="Paste one profile URL per line"
                    value={socialReferences}
                    onChange={(event) => setSocialReferences(event.target.value)}
                  />
                  <span className="mt-1 block text-xs" style={{ color: "var(--bat-text-muted)" }}>
                    Up to 12 references. Add whichever links you already know.
                  </span>
                </label>
              </section>

              <section id="signup-section-review" ref={registerSection("review")} className="signup-section-anchor bat-surface p-5 sm:p-6">
                <h2 className="text-lg font-semibold">Final review</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  Confirm core details before workspace creation.
                </p>

                <ul className="mt-4 space-y-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  <li>
                    <span className="font-medium" style={{ color: "var(--bat-text)" }}>Brand:</span> {companyName.trim() || "Not provided"}
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: "var(--bat-text)" }}>Primary website:</span> {website.trim() || "Missing"}
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: "var(--bat-text)" }}>Additional websites:</span> {parseMultiLineEntries(additionalWebsites, 5).length}
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: "var(--bat-text)" }}>Social references:</span> {parseMultiLineEntries(socialReferences, 12).length}
                  </li>
                </ul>

                <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>
                  Create workspace
                </button>
              </section>
            </form>

            <SignupActionBar formId="signup-smart-form" loading={loading} invalidCount={liveInvalidCount} />
          </div>

          <div className="hidden xl:col-span-4 xl:block">
            <SignupContextRail sections={SECTION_DEFS} validation={sectionValidation} />
          </div>
        </div>
      </div>
    </section>
  );
}
