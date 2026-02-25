"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWorkspaces } from "@/lib/runtime-api";
import { RuntimeWorkspace } from "@/types/chat";

function labelForWorkspace(workspace: RuntimeWorkspace): string {
  return workspace.client?.name?.trim() || `Workspace ${workspace.id.slice(0, 8)}`;
}

export default function AdminWorkspacesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<RuntimeWorkspace[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchWorkspaces();
      setWorkspaces(rows);
    } catch (fetchError: any) {
      setError(String(fetchError?.message || "Failed to fetch workspaces"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = useMemo(() => workspaces.map((workspace) => ({ ...workspace, label: labelForWorkspace(workspace) })), [workspaces]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin • Workspaces</h1>
      {error ? (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          <p>{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: "currentColor" }}
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="space-y-2">
        {loading && cards.length === 0 ? (
          <article className="bat-surface p-4 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Loading workspaces...
          </article>
        ) : null}
        {!loading && cards.length === 0 ? (
          <article className="bat-surface p-4 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            No workspaces found.
          </article>
        ) : null}
        {cards.map((workspace) => (
          <Link
            key={workspace.id}
            href={`/admin/workspaces/${workspace.id}`}
            className="bat-surface flex items-center justify-between p-4"
          >
            <div>
              <p className="font-semibold">{workspace.label}</p>
              <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
                Status: {workspace.status || "UNKNOWN"}
              </p>
            </div>
            <p className="text-sm" style={{ color: "var(--bat-accent)" }}>
              Open
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
