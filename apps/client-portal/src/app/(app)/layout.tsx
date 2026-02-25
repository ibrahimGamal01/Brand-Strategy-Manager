import { AppNav } from "@/components/layout/app-nav";
import { PortalAuthGate } from "@/components/auth/portal-auth-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalAuthGate>
      <AppNav />
      <main className="bat-shell py-6">{children}</main>
    </PortalAuthGate>
  );
}
