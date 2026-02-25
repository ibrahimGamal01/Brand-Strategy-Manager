import { AppNav } from "@/components/layout/app-nav";
import { PortalAuthGate } from "@/components/auth/portal-auth-gate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalAuthGate adminOnly>
      <AppNav />
      <main className="bat-shell py-6">{children}</main>
    </PortalAuthGate>
  );
}
