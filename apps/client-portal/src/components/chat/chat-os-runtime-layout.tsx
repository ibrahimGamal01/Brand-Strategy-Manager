"use client";

import { useMemo, useState } from "react";
import { LayoutPanelLeft, LayoutPanelTop, SidebarOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRuntimeWorkspace } from "@/hooks/use-runtime-workspace";
import { LibraryCollection, SessionPreferences } from "@/types/chat";
import { ChatComposer } from "./chat-composer";
import { ChatThread } from "./chat-thread";
import { CommandPalette } from "./command-palette";
import { LiveActivityPanel } from "./live-activity-panel";
import { LibraryDrawer } from "@/components/library/library-drawer";

const steerSystemPrompts: Record<
  string,
  { pref?: [keyof SessionPreferences, SessionPreferences[keyof SessionPreferences]]; prompt?: string }
> = {
  "Go deeper": { pref: ["tone", "balanced"], prompt: "Go deeper with the current strategy and include lane-by-lane recommendations." },
  "Show sources": { pref: ["transparency", true], prompt: "Show every claim with source evidence and confidence level." },
  "Make it a PDF": { prompt: "Generate a client-ready PDF deliverable from this branch." },
  "Focus on TikTok": { pref: ["sourceFocus", "social"], prompt: "Prioritize TikTok and social evidence in the next response." },
  "Focus on Web evidence": { pref: ["sourceFocus", "web"], prompt: "Prioritize web evidence and cite pages directly." },
  "Be concise": { pref: ["tone", "concise"] },
  "Ask me questions first": { pref: ["askQuestionsFirst", true] },
};

export function ChatOsRuntimeLayout({ workspaceId }: { workspaceId: string }) {
  const [focusMode, setFocusMode] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [activeLibraryCollection, setActiveLibraryCollection] = useState<LibraryCollection | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const router = useRouter();

  const {
    loading,
    syncing,
    error,
    threads,
    activeThreadId,
    activeBranchId,
    branches,
    messages,
    processRuns,
    feedItems,
    decisions,
    queuedMessages,
    isStreaming,
    libraryItems,
    preferences,
    setActiveThreadId,
    createThread,
    createBranch,
    pinBranch,
    sendMessage,
    interruptRun,
    reorderQueue,
    removeQueued,
    resolveDecision,
    setPreference,
    refreshNow,
  } = useRuntimeWorkspace(workspaceId);

  const visibleFeed = useMemo(() => feedItems.slice(0, 8), [feedItems]);

  const branchNeedsDecision = processRuns.some((run) => run.status === "waiting_input");

  const runAsync = (work: Promise<void>) => {
    setActionError(null);
    void work.catch((workError) => {
      setActionError(String((workError as Error)?.message || "Action failed"));
    });
  };

  const onSend = (content: string, mode: "send" | "queue") => {
    runAsync(sendMessage(content, mode));
  };

  const onSteer = (chip: string) => {
    const mapping = steerSystemPrompts[chip];
    if (!mapping) return;

    if (mapping.pref) {
      const [key, value] = mapping.pref;
      if (key === "tone" && (value === "balanced" || value === "concise")) {
        setPreference("tone", value);
      }
      if (key === "sourceFocus" && (value === "mixed" || value === "web" || value === "social")) {
        setPreference("sourceFocus", value);
      }
      if (key === "transparency" && typeof value === "boolean") {
        setPreference("transparency", value);
      }
      if (key === "askQuestionsFirst" && typeof value === "boolean") {
        setPreference("askQuestionsFirst", value);
      }
    }

    if (mapping.prompt) {
      const mode: "send" | "queue" = isStreaming ? "queue" : "send";
      runAsync(sendMessage(mapping.prompt, mode));
    }
  };

  const onUseLibraryItem = (title: string) => {
    const mode: "send" | "queue" = isStreaming ? "queue" : "send";
    runAsync(sendMessage(`Use evidence from: ${title}`, mode));
    setLibraryOpen(false);
  };

  const onNewThread = () => {
    const title = window.prompt("Thread name", "Main workspace thread");
    if (!title) return;
    runAsync(createThread(title));
  };

  const onForkBranch = (forkedFromMessageId?: string) => {
    const branchName = window.prompt("Branch name", `What-if ${new Date().toLocaleTimeString()}`);
    if (!branchName) return;
    runAsync(createBranch(branchName, forkedFromMessageId));
  };

  const onCommand = (command: string) => {
    if (command === "Open library: Web") {
      setLibraryOpen(true);
      setActiveLibraryCollection("web");
      return;
    }
    if (command === "Open library: Competitors") {
      setLibraryOpen(true);
      setActiveLibraryCollection("competitors");
      return;
    }
    if (command === "Switch workspace") {
      router.push("/app");
      return;
    }

    const mode: "send" | "queue" = isStreaming ? "queue" : "send";
    runAsync(sendMessage(command, mode));
  };

  const onRunAudit = () => {
    const mode: "send" | "queue" = isStreaming ? "queue" : "send";
    runAsync(
      sendMessage(
        "Run a full workspace intelligence audit now. Use tools across web snapshots/sources, competitors, social evidence, community insights, and news, then summarize findings with next actions.",
        mode
      )
    );
  };

  if (loading) {
    return (
      <section className="bat-surface p-6">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Initializing workspace runtime...
        </p>
      </section>
    );
  }

  return (
    <>
      <div className="mb-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.13em]" style={{ color: "var(--bat-text-muted)" }}>
              Workspace
            </p>
            <h1 className="text-xl font-semibold">{workspaceId}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
              onClick={() => setLibraryOpen((prev) => !prev)}
            >
              <span className="inline-flex items-center gap-2">
                <SidebarOpen className="h-4 w-4" /> Library
              </span>
            </button>
            <button
              type="button"
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
              onClick={() => setFocusMode((prev) => !prev)}
            >
              <span className="inline-flex items-center gap-2">
                {focusMode ? <LayoutPanelLeft className="h-4 w-4" /> : <LayoutPanelTop className="h-4 w-4" />}
                {focusMode ? "Split Mode" : "Focus Mode"}
              </span>
            </button>
            <CommandPalette onSelect={onCommand} />
          </div>
        </div>

        <div className="bat-surface flex flex-wrap items-end gap-3 p-3">
          <label className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Thread
            <select
              value={activeThreadId || ""}
              onChange={(event) => setActiveThreadId(event.target.value)}
              className="mt-1 block min-w-[220px] rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              {threads.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.title}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Branch
            <select
              value={activeBranchId || ""}
              onChange={(event) => runAsync(pinBranch(event.target.value))}
              className="mt-1 block min-w-[220px] rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="rounded-full border px-3 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
            onClick={onNewThread}
          >
            New Thread
          </button>

          <button
            type="button"
            className="rounded-full border px-3 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
            onClick={() => onForkBranch()}
          >
            Fork Branch
          </button>

          <button
            type="button"
            className="rounded-full border px-3 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
            onClick={() => runAsync(refreshNow())}
          >
            Refresh
          </button>

          <span className="bat-chip">
            {syncing ? "Syncing..." : isStreaming ? "Running" : "Idle"}
          </span>
          <span className="bat-chip">Queued: {queuedMessages.length}</span>
          {branchNeedsDecision ? <span className="bat-chip">Needs decision</span> : null}
          {preferences.askQuestionsFirst ? <span className="bat-chip">Question-first mode</span> : null}
        </div>

        {error || actionError ? (
          <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
            <p>{error || actionError}</p>
          </div>
        ) : null}
      </div>

      <div className={`grid gap-4 ${focusMode ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-[1fr,360px]"}`}>
        <div className="space-y-4">
          <ChatThread messages={messages} onForkFromMessage={onForkBranch} />
          <ChatComposer
            isStreaming={isStreaming}
            queuedMessages={queuedMessages}
            onSend={onSend}
            onStop={() => runAsync(interruptRun())}
            onReorderQueue={(from, to) => runAsync(reorderQueue(from, to))}
            onDeleteQueued={(id) => runAsync(removeQueued(id))}
            onSteer={onSteer}
          />
          {focusMode ? (
            <section className="bat-surface flex items-center justify-between gap-2 p-3 text-sm">
              <p>
                Live activity in compact mode. <strong>{processRuns.filter((run) => run.status === "running").length}</strong>{" "}
                active process(es).
              </p>
              <span className="bat-chip">{syncing ? "syncing" : "ready"}</span>
            </section>
          ) : null}
        </div>

        {!focusMode ? (
          <LiveActivityPanel
            runs={processRuns}
            feedItems={visibleFeed}
            decisions={decisions}
            onResolve={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
            onRunAudit={onRunAudit}
          />
        ) : null}
      </div>

      <LibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        items={libraryItems}
        activeCollection={activeLibraryCollection}
        onCollectionChange={setActiveLibraryCollection}
        onUseInChat={(item) => onUseLibraryItem(item.title)}
      />
    </>
  );
}
