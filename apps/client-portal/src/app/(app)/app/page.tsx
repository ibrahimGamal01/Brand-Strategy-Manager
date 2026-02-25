"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspacePicker } from "@/components/workspace/workspace-picker";
import { fetchWorkspaces } from "@/lib/runtime-api";
import { RuntimeWorkspace } from "@/types/chat";

function toWorkspaceCard(workspace: RuntimeWorkspace) {
  const name = workspace.client?.name?.trim() || `Workspace ${workspace.id.slice(0, 8)}`;
  const plan = workspace.intakeReady ? "Ready" : "Setup required";
  return {
    id: workspace.id,
    name,
    members: 1,
    plan,
    status: workspace.status || "UNKNOWN",
    startedAt: workspace.startedAt || null,
    intakeReady: workspace.intakeReady ?? false,
  };
}

export default function AppPage() {
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

  const cards = useMemo(() => workspaces.map(toWorkspaceCard), [workspaces]);

  return <WorkspacePicker workspaces={cards} loading={loading} error={error} onRetry={load} />;
}
