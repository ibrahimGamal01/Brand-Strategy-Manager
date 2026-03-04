"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { verifyPortalEmail } from "@/lib/auth-api";
import { Badge, Button } from "@/components/ui";

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
      <div className="bat-panel w-full max-w-md p-7">
        <Badge className="mb-4">Verification</Badge>
        <h1 className="bat-heading-md">Verify your email</h1>
        <p className={state === "error" ? "bat-panel-muted bat-status-danger mt-3 rounded-xl px-3 py-2 text-sm" : "mt-3 text-sm bat-text-muted"}>
          {message}
        </p>
        <div className="mt-5 flex gap-2">
          {state === "ok" ? (
            <Button onClick={() => router.push("/login?verified=1")}>Go to login</Button>
          ) : null}
          <Link href="/login" className="bat-button bat-button-secondary">
            Back to login
          </Link>
        </div>
      </div>
    </section>
  );
}
