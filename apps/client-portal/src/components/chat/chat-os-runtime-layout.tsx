"use client";

import { useMemo, useState } from "react";
import { Library, MessageSquarePlus, RefreshCcw, Search } from "lucide-react";
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

function formatThreadTime(iso?: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatOsRuntimeLayout({ workspaceId }: { workspaceId: string }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [activeLibraryCollection, setActiveLibraryCollection] = useState<LibraryCollection | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<
    | { mode: "thread"; title: string }
    | { mode: "branch"; title: string; forkedFromMessageId?: string }
    | null
  >(null);
  const [nameInput, setNameInput] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [selectedAssistantMessageId, setSelectedAssistantMessageId] = useState<string | null>(null);
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
    steerRun,
    setPreference,
    refreshNow,
  } = useRuntimeWorkspace(workspaceId);

  const visibleFeed = useMemo(() => feedItems.slice(0, 8), [feedItems]);
  const branchNeedsDecision = processRuns.some((run) => run.status === "waiting_input");
  const activeRun =
    processRuns.find((run) => run.status === "running" || run.status === "waiting_input") ||
    processRuns[0] ||
    null;
  const streamingInsight = activeRun ? `${activeRun.label} • ${activeRun.stage}` : visibleFeed[0]?.message || "";

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || threads[0] || null,
    [threads, activeThreadId]
  );

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) || branches[0] || null,
    [branches, activeBranchId]
  );

  const filteredThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => thread.title.toLowerCase().includes(query));
  }, [threadSearch, threads]);

  const quickLibraryItems = useMemo(
    () =>
      libraryItems
        .filter((item) => item.collection === "deliverables" || item.collection === "web" || item.collection === "social")
        .slice(0, 8),
    [libraryItems]
  );

  const reasoningMessages = useMemo(
    () => messages.filter((message) => message.role === "assistant" && Boolean(message.reasoning?.plan.length)),
    [messages]
  );

  const selectedReasoningMessage = useMemo(() => {
    if (!reasoningMessages.length) return null;
    const selected =
      (selectedAssistantMessageId
        ? reasoningMessages.find((message) => message.id === selectedAssistantMessageId)
        : null) || null;
    return selected || reasoningMessages[reasoningMessages.length - 1] || null;
  }, [reasoningMessages, selectedAssistantMessageId]);

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
      if (isStreaming) {
        runAsync(steerRun(mapping.prompt));
      } else {
        runAsync(sendMessage(mapping.prompt, "send"));
      }
    }
  };

  const onUseLibraryItem = (title: string) => {
    const mode: "send" | "queue" = isStreaming ? "queue" : "send";
    runAsync(sendMessage(`Use evidence from: ${title}`, mode));
    setLibraryOpen(false);
  };

  const onRunMessageAction = (
    actionLabel: string,
    actionKey: string,
    payload?: Record<string, unknown>
  ) => {
    const action = actionKey.trim().toLowerCase();
    const prompt =
      action === "show_sources"
        ? "Show all sources and evidence behind the previous answer."
        : action === "fork_branch"
          ? "Fork this branch and continue with an alternative strategy."
          : action === "generate_pdf"
            ? "Generate a client-ready PDF deliverable from this branch."
            : `Run action ${actionKey} from the latest assistant response.`;
    const payloadLine = payload ? `\nAction payload: ${JSON.stringify(payload)}` : "";
    const mode: "send" | "queue" = isStreaming ? "queue" : "send";
    runAsync(sendMessage(`${prompt}${payloadLine}\nRequested via button: ${actionLabel}`, mode));
  };

  const onNewThread = () => {
    setNameDialog({ mode: "thread", title: "Create new chat" });
    setNameInput("New strategy chat");
  };

  const onForkBranch = (forkedFromMessageId?: string) => {
    setNameDialog({ mode: "branch", title: "Create branch", forkedFromMessageId });
    setNameInput(`What-if ${new Date().toLocaleTimeString()}`);
  };

  const submitNameDialog = () => {
    if (!nameDialog) return;
    const value = nameInput.trim();
    if (!value) return;
    if (nameDialog.mode === "thread") {
      runAsync(createThread(value));
    } else {
      runAsync(createBranch(value, nameDialog.forkedFromMessageId));
    }
    setNameDialog(null);
    setNameInput("");
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

  const onLiveSteer = (instruction: string) => {
    const text = instruction.trim();
    if (!text) return;
    runAsync(steerRun(text));
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
      {error || actionError ? (
        <div className="mb-3 rounded-2xl border p-3 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          <p>{error || actionError}</p>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[280px,minmax(0,1fr),360px]">
        <aside className="bat-surface min-h-[70vh] overflow-hidden">
          <div className="border-b p-3" style={{ borderColor: "var(--bat-border)" }}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "var(--bat-text-muted)" }}>
                  Chats
                </p>
                <p className="text-sm font-semibold">Workspace conversations</p>
              </div>
              <button
                type="button"
                onClick={onNewThread}
                className="rounded-full border px-2.5 py-1.5 text-xs"
                style={{ borderColor: "var(--bat-border)" }}
              >
                <span className="inline-flex items-center gap-1">
                  <MessageSquarePlus className="h-3.5 w-3.5" /> New
                </span>
              </button>
            </div>

            <label className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--bat-border)" }}>
              <Search className="h-3.5 w-3.5" />
              <input
                value={threadSearch}
                onChange={(event) => setThreadSearch(event.target.value)}
                placeholder="Search chats"
                className="w-full border-none bg-transparent text-sm outline-none"
              />
            </label>
          </div>

          <div className="max-h-[34vh] space-y-1 overflow-y-auto p-2">
            {filteredThreads.map((thread) => {
              const active = thread.id === activeThreadId;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setActiveThreadId(thread.id)}
                  className="w-full rounded-xl border px-3 py-2 text-left"
                  style={{
                    borderColor: active ? "var(--bat-accent)" : "var(--bat-border)",
                    background: active ? "var(--bat-accent-soft)" : "transparent",
                  }}
                >
                  <p className="truncate text-sm font-medium">{thread.title}</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--bat-text-muted)" }}>
                    Updated {formatThreadTime(thread.updatedAt) || "recently"}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="border-t p-3" style={{ borderColor: "var(--bat-border)" }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "var(--bat-text-muted)" }}>
                Branches
              </p>
              <button
                type="button"
                onClick={() => onForkBranch()}
                className="rounded-full border px-2 py-1 text-[11px]"
                style={{ borderColor: "var(--bat-border)" }}
              >
                New branch
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {branches.map((branch) => {
                const active = branch.id === activeBranchId;
                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => runAsync(pinBranch(branch.id))}
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{
                      borderColor: active ? "var(--bat-accent)" : "var(--bat-border)",
                      background: active ? "var(--bat-accent-soft)" : "transparent",
                    }}
                  >
                    {branch.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border px-3 py-1.5 text-xs"
                style={{ borderColor: "var(--bat-border)" }}
                onClick={() => runAsync(refreshNow())}
              >
                <span className="inline-flex items-center gap-1">
                  <RefreshCcw className="h-3.5 w-3.5" /> Refresh
                </span>
              </button>
              <CommandPalette onSelect={onCommand} />
            </div>
          </div>

          <div className="border-t p-3" style={{ borderColor: "var(--bat-border)" }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "var(--bat-text-muted)" }}>
                Documents
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveLibraryCollection("all");
                  setLibraryOpen(true);
                }}
                className="rounded-full border px-2 py-1 text-[11px]"
                style={{ borderColor: "var(--bat-border)" }}
              >
                Open library
              </button>
            </div>
            <div className="max-h-[24vh] space-y-2 overflow-y-auto">
              {quickLibraryItems.map((item) => (
                <article key={item.id} className="rounded-xl border px-2.5 py-2" style={{ borderColor: "var(--bat-border)" }}>
                  <p className="line-clamp-1 text-xs font-medium">{item.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px]" style={{ color: "var(--bat-text-muted)" }}>
                    {item.summary}
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded-full border px-2 py-1 text-[11px]"
                    style={{ borderColor: "var(--bat-border)" }}
                    onClick={() => onUseLibraryItem(item.title)}
                  >
                    Use in chat
                  </button>
                </article>
              ))}
              {quickLibraryItems.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  Library is still loading. Start a run to populate documents and evidence.
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="flex min-h-[70vh] flex-col gap-3">
          <header className="bat-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "var(--bat-text-muted)" }}>
                {syncing ? "Syncing" : "Ready"}
              </p>
              <h1 className="text-lg font-semibold">{activeThread?.title || "Workspace chat"}</h1>
              <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {activeBranch ? `Branch: ${activeBranch.name}` : "Main branch"} • {isStreaming ? "BAT is running" : "Idle"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="bat-chip">Queued: {queuedMessages.length}</span>
              {branchNeedsDecision ? <span className="bat-chip">Needs approval</span> : null}
              {preferences.askQuestionsFirst ? <span className="bat-chip">Question-first</span> : null}
              <button
                type="button"
                className="rounded-full border px-3 py-1.5 text-xs"
                style={{ borderColor: "var(--bat-border)" }}
                onClick={() => setLibraryOpen((prev) => !prev)}
              >
                <span className="inline-flex items-center gap-1">
                  <Library className="h-3.5 w-3.5" /> Library
                </span>
              </button>
            </div>
          </header>

          <ChatThread
            messages={messages}
            onForkFromMessage={onForkBranch}
            onResolveDecision={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
            onRunAction={onRunMessageAction}
            onInspectAssistantMessage={setSelectedAssistantMessageId}
            selectedAssistantMessageId={selectedReasoningMessage?.id || null}
            showInlineReasoning={false}
            isStreaming={isStreaming}
            streamingInsight={streamingInsight}
          />

          <ChatComposer
            isStreaming={isStreaming}
            queuedMessages={queuedMessages}
            onSend={onSend}
            onSteerRun={(note) => runAsync(steerRun(note))}
            onSteerQueued={(id, content) =>
              runAsync(
                (async () => {
                  await steerRun(content);
                  await removeQueued(id);
                })()
              )
            }
            onStop={() => runAsync(interruptRun())}
            onReorderQueue={(from, to) => runAsync(reorderQueue(from, to))}
            onDeleteQueued={(id) => runAsync(removeQueued(id))}
            onSteer={onSteer}
          />
        </section>

        <aside className="space-y-3">
          <section className="bat-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Thought process</p>
              <span className="bat-chip">Selected reply</span>
            </div>
            {selectedReasoningMessage?.reasoning ? (
              <div className="space-y-3 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--bat-text)" }}>
                    Plan
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {selectedReasoningMessage.reasoning.plan.map((line) => (
                      <li key={`${selectedReasoningMessage.id}-plan-${line}`}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--bat-text)" }}>
                    Tools used
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {selectedReasoningMessage.reasoning.tools.map((tool) => (
                      <span key={`${selectedReasoningMessage.id}-tool-${tool}`} className="bat-chip">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--bat-text)" }}>
                    Next steps
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {selectedReasoningMessage.reasoning.nextSteps.map((step) => (
                      <li key={`${selectedReasoningMessage.id}-step-${step}`}>{step}</li>
                    ))}
                  </ul>
                </div>
                {selectedReasoningMessage.reasoning.evidence.length ? (
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "var(--bat-text)" }}>
                      Evidence
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {selectedReasoningMessage.reasoning.evidence.map((item) =>
                        item.href ? (
                          <a
                            key={`${selectedReasoningMessage.id}-evidence-${item.id}`}
                            href={item.href}
                            target="_blank"
                            rel="noreferrer"
                            className="bat-chip hover:opacity-80"
                          >
                            {item.label}
                          </a>
                        ) : (
                          <span key={`${selectedReasoningMessage.id}-evidence-${item.id}`} className="bat-chip">
                            {item.label}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
                Pick an assistant reply to inspect BAT reasoning and evidence.
              </p>
            )}
          </section>

          <LiveActivityPanel
            runs={processRuns}
            feedItems={visibleFeed}
            decisions={decisions}
            onResolve={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
            onRunAudit={onRunAudit}
            onSteer={onLiveSteer}
          />
        </aside>
      </div>

      <LibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        items={libraryItems}
        activeCollection={activeLibraryCollection}
        onCollectionChange={setActiveLibraryCollection}
        onUseInChat={(item) => onUseLibraryItem(item.title)}
      />

      {nameDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/30 pt-[18vh]">
          <div className="w-full max-w-xl rounded-2xl border p-4" style={{ background: "var(--bat-surface)", borderColor: "var(--bat-border)" }}>
            <p className="text-lg font-semibold">{nameDialog.title}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              {nameDialog.mode === "thread" ? "Chat name" : "Branch name"}
            </p>
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitNameDialog();
                }
                if (event.key === "Escape") {
                  setNameDialog(null);
                  setNameInput("");
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border px-4 py-2 text-sm"
                style={{ borderColor: "var(--bat-border)" }}
                onClick={() => {
                  setNameDialog(null);
                  setNameInput("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "var(--bat-accent)" }}
                onClick={submitNameDialog}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
