'use client';

import Link from "next/link";
import { Plus } from 'lucide-react';
import { ClientCard } from "@/components/ClientCard";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

// Converting to Client Component to easily handle "No Cache" and interactive states
// Real-world would use Server Component + Suspense, but for speed/simplicity:
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
      } catch (e: any) {
        setLoadError(
          e?.message ||
            'Backend is unavailable. Start backend and verify /api/health responds with schemaReady=true.'
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">

      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center font-bold text-primary-foreground shadow-lg">
              B
            </div>
            <h1 className="text-lg font-bold tracking-tight">
              BrandStrat <span className="text-muted-foreground px-2 py-0.5 bg-muted rounded-md text-xs uppercase tracking-widest ml-1">OS 2.0</span>
            </h1>
          </div>
          <Link
            href="/clients/new"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus size={16} />
            New Account
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold mb-2">Accounts Overview</h2>
            <p className="text-muted-foreground">Manage your tracked brands and research jobs</p>
          </div>
          <div className="text-sm text-muted-foreground font-mono">
            {clients.length} ACTIVE ACCOUNTS
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-40 bg-card rounded-lg border border-border" />
            ))}
          </div>
        ) : loadError ? (
          <div className="border border-amber-500/30 rounded-xl p-8 bg-amber-500/5">
            <h3 className="text-lg font-semibold mb-2">Backend Unavailable</h3>
            <p className="text-sm text-muted-foreground mb-3">{loadError}</p>
            <p className="text-xs text-muted-foreground font-mono">
              Check backend at <code>/api/health</code> and confirm schema readiness.
            </p>
          </div>
        ) : clients.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-16 text-center bg-card/50">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">📡</div>
            <h3 className="text-xl font-bold mb-2">
              No Active Accounts
            </h3>
            <p className="text-muted-foreground mb-8 max-w-sm mx-auto">
              Add your first client account to begin tracking competitors and trends.
            </p>
            <Link
              href="/clients/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
            >
              <Plus size={18} />
              Add Account
            </Link>
          </div>
        ) : (Array.isArray(clients) && clients.length > 0) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
            {clients.map((client: any) => (
              <ClientCard key={client.id} client={client} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            No clients found or error loading data.
          </div>
        )}
      </main>
    </div>
  );
}
