"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getPortalMe, PortalMeResponse } from "@/lib/auth-api";

export function PortalAuthGate({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<PortalMeResponse | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let active = true;

    getPortalMe()
      .then((payload) => {
        if (!active) return;
        setMe(payload);
      })
      .catch(() => {
        if (!active) return;
        const next = encodeURIComponent(pathname || "/app");
        router.replace(`/login?next=${next}`);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [pathname, router]);

  useEffect(() => {
    if (!loading && adminOnly && me && !me.user.isAdmin) {
      router.replace("/app");
    }
  }, [adminOnly, loading, me, router]);

  if (loading || !me) {
    return (
      <section className="bat-shell py-8">
        <div className="bat-surface p-5 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Checking your workspace access...
        </div>
      </section>
    );
  }

  if (adminOnly && !me.user.isAdmin) {
    return null;
  }

  return <>{children}</>;
}
