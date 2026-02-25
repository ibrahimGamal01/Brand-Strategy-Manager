import { Suspense } from "react";
import { LoginPageClient } from "@/components/auth/login-page-client";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <section className="bat-shell grid min-h-[70vh] place-items-center py-12">
          <div className="bat-surface w-full max-w-md p-7 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Loading login...
          </div>
        </section>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
