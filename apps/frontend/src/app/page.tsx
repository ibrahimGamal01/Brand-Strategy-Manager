'use client';

import Link from 'next/link';
import { Plus, Radar } from 'lucide-react';
import { ClientCard } from '@/components/ClientCard';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Home() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoadError(null);
        const data = await apiClient.getClients();
        setClients(data);
      } catch (error: any) {
        setLoadError(
          error?.message ||
            'Backend is unavailable. Start backend and verify /api/health responds with schemaReady=true.'
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-lg">
              B
            </div>
            <h1 className="text-lg font-bold tracking-tight">
              BAT <span className="ml-1 rounded-md bg-muted px-2 py-0.5 text-xs uppercase tracking-widest text-muted-foreground">Workspace</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/clients/new"
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus size={16} />
              New Client
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2">BAT Control Center</h2>
            <p className="text-muted-foreground">Manage client brains, intelligence runs, and strategy workflows.</p>
          </div>
          <div className="font-mono text-sm text-muted-foreground">{clients.length} ACTIVE CLIENTS</div>
        </div>

        {loading ? (
          <div className="grid animate-pulse grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 rounded-lg border border-border bg-card" />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-8">
            <h3 className="mb-2 text-lg font-semibold">Backend Unavailable</h3>
            <p className="mb-3 text-sm text-muted-foreground">{loadError}</p>
            <p className="font-mono text-xs text-muted-foreground">
              Check backend at <code>/api/health</code> and confirm schema readiness.
            </p>
          </div>
        ) : clients.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-16 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Radar className="h-7 w-7" />
            </div>
            <h3 className="mb-2 text-xl font-bold">No Active Clients</h3>
            <p className="mx-auto mb-8 max-w-sm text-muted-foreground">
              Add your first client to initialize BAT Brain and begin intelligence tracking.
            </p>
            <Link
              href="/clients/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus size={18} />
              Add Client
            </Link>
          </div>
        ) : Array.isArray(clients) && clients.length > 0 ? (
          <div className="grid animate-in fade-in duration-500 grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {clients.map((client: any) => (
              <ClientCard key={client.id} client={client} />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground">No clients found or error loading data.</div>
        )}
      </main>
    </div>
  );
}
