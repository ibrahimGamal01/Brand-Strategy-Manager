import { AppNav } from "@/components/layout/app-nav";
import { PortalAuthGate } from "@/components/auth/portal-auth-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalAuthGate>
      <AppNav />
      <main className="bat-shell-app py-3 sm:py-4 lg:py-5">{children}</main>
    </PortalAuthGate>
  );
}
