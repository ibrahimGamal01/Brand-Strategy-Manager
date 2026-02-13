import type { ReactNode } from 'react';

interface BatWorkspaceShellProps {
  topbar: ReactNode;
  moduleNav: ReactNode;
  notificationRail: ReactNode;
  children: ReactNode;
}

export function BatWorkspaceShell({ topbar, moduleNav, notificationRail, children }: BatWorkspaceShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card/70 backdrop-blur-xl">{topbar}</header>

      <div className="border-b border-border/60 bg-background/80 px-4 lg:px-6">{moduleNav}</div>

      <div className="mx-auto w-full max-w-[1700px] px-4 py-4 lg:px-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0 space-y-4">{children}</main>
          <aside className="min-w-0">{notificationRail}</aside>
        </div>
      </div>
    </div>
  );
}
