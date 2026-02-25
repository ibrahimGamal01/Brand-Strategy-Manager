"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWorkspaceIntakeStatus, WorkspaceIntakeStatus } from "@/lib/runtime-api";
import { WorkspaceIntakeFlow } from "@/components/intake/workspace-intake-flow";
import { ChatOsRuntimeLayout } from "./chat-os-runtime-layout";

export function ChatOsLayout({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WorkspaceIntakeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchWorkspaceIntakeStatus(workspaceId);
      setStatus(next);
      setError(null);
    } catch (fetchError: unknown) {
      setError(String((fetchError as Error)?.message || "Failed to load workspace setup status"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  if (loading) {
    return (
      <section className="bat-surface p-6">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Checking workspace setup...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bat-surface space-y-3 p-6">
        <p className="text-sm" style={{ color: "#9f2317" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => {
            void refreshStatus();
          }}
          className="rounded-full border px-4 py-2 text-sm"
          style={{ borderColor: "var(--bat-border)" }}
        >
          Retry
        </button>
      </section>
    );
  }

  if (!status?.completed) {
    return (
      <WorkspaceIntakeFlow
        workspaceId={workspaceId}
        initialPrefill={status?.prefill}
        onCompleted={refreshStatus}
      />
    );
  }

  return <ChatOsRuntimeLayout workspaceId={workspaceId} />;
}
