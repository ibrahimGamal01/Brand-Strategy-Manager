"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { verifyPortalEmail } from "@/lib/auth-api";

export function VerifyEmailPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") || "";
  const [state, setState] = useState<"loading" | "ok" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "Verifying your email..." : "Verification token is missing.");

  useEffect(() => {
    let active = true;
    if (!token) return;

    verifyPortalEmail(token)
      .then(() => {
        if (!active) return;
        setState("ok");
        setMessage("Your email has been verified successfully.");
      })
      .catch((error: any) => {
        if (!active) return;
        const text = String(error?.message || "Verification failed");
        if (text.includes("TOKEN_INVALID_OR_EXPIRED")) {
          setMessage("This verification link is invalid or expired.");
        } else {
          setMessage(text);
        }
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <section className="bat-shell grid min-h-[70vh] place-items-center py-12">
      <div className="bat-surface w-full max-w-md p-7">
        <h1 className="text-2xl font-semibold">Verify your email</h1>
        <p className="mt-3 text-sm" style={{ color: state === "error" ? "#9f2317" : "var(--bat-text-muted)" }}>
          {message}
        </p>
        <div className="mt-5 flex gap-2">
          {state === "ok" ? (
            <button
              type="button"
              className="rounded-full px-4 py-2 text-sm font-semibold"
              style={{ background: "var(--bat-accent)", color: "white" }}
              onClick={() => router.push("/login?verified=1")}
            >
              Go to login
            </button>
          ) : null}
          <Link
            href="/login"
            className="rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Back to login
          </Link>
        </div>
      </div>
    </section>
  );
}
