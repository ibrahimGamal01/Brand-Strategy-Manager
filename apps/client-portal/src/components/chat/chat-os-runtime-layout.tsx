"use client";

import { useMemo, useState } from "react";
import { Library, Menu, MessageSquarePlus, RefreshCcw, Search } from "lucide-react";
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
  "Go deeper": { pref: ["tone", "detailed"], prompt: "Go deeper with the current strategy and include lane-by-lane recommendations." },
  "Show sources": { pref: ["transparency", true], prompt: "Show every claim with source evidence and confidence level." },
  "Make it a PDF": { prompt: "Generate a client-ready PDF deliverable from this branch." },
  "Focus on TikTok": { pref: ["sourceFocus", "social"], prompt: "Prioritize TikTok and social evidence in the next response." },
  "Focus on Web evidence": { pref: ["sourceFocus", "web"], prompt: "Prioritize web evidence and cite pages directly." },
  "Ask me questions first": { pref: ["askQuestionsFirst", true] },
};

function formatThreadTime(iso?: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatPhaseLabel(phase?: string | null): string {
  const normalized = String(phase || "").trim().toLowerCase();
  if (!normalized) return "Running";
  if (normalized === "waiting_input") return "Waiting input";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function ChatOsRuntimeLayout({ workspaceId }: { workspaceId: string }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [activeLibraryCollection, setActiveLibraryCollection] = useState<LibraryCollection | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState<
    | { mode: "thread"; title: string }
    | { mode: "branch"; title: string; forkedFromMessageId?: string }
    | null
  >(null);
  const [nameInput, setNameInput] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
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
  const streamingInsight = activeRun
    ? `${activeRun.label} • ${formatPhaseLabel(activeRun.phase)} • ${activeRun.stage}`
    : visibleFeed[0]?.message || "";

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
        .slice(0, 6),
    [libraryItems]
  );

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
      if (key === "tone" && (value === "balanced" || value === "detailed" || value === "concise")) {
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
    runAsync(sendMessage(`Use evidence from: ${title}`, "send"));
    setLibraryOpen(false);
  };

  const onRunMessageAction = (
    actionLabel: string,
    actionKey: string,
    payload?: Record<string, unknown>
  ) => {
    const action = actionKey.trim().toLowerCase();
    if (action === 'open_library') {
      const requestedCollection = String(payload?.collection || '').trim().toLowerCase();
      if (
        requestedCollection === 'web' ||
        requestedCollection === 'competitors' ||
        requestedCollection === 'social' ||
        requestedCollection === 'community' ||
        requestedCollection === 'news' ||
        requestedCollection === 'deliverables'
      ) {
        setActiveLibraryCollection(requestedCollection as LibraryCollection);
      } else {
        setActiveLibraryCollection('all');
      }
      setLibraryOpen(true);
      return;
    }

    const prompt =
      action === "show_sources"
        ? "Show all sources and evidence behind the previous answer."
        : action === "fork_branch"
          ? "Fork this branch and continue with an alternative strategy."
          : action === "generate_pdf"
            ? "Generate a client-ready PDF deliverable from this branch."
            : `Run action ${actionKey} from the latest assistant response.`;
    const payloadLine = payload ? `\nAction payload: ${JSON.stringify(payload)}` : "";
    runAsync(sendMessage(`${prompt}${payloadLine}\nRequested via button: ${actionLabel}`, "send"));
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

    runAsync(sendMessage(command, "send"));
  };

  const onRunAudit = () => {
    runAsync(
      sendMessage(
        "Run a full workspace intelligence audit now. Use tools across web snapshots/sources, competitors, social evidence, community insights, and news, then summarize findings with next actions.",
        "send"
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
      {error || actionError ? (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{error || actionError}</p>
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-[28px] border border-zinc-200 bg-[#f3f4f6] shadow-[0_20px_60px_rgba(16,24,40,0.08)]">
        <div className="grid h-[calc(100vh-7.5rem)] min-h-[640px] grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside
            className={`${
              sidebarOpen ? "absolute inset-y-0 left-0 z-30 flex w-[300px]" : "hidden"
            } flex-col border-r border-zinc-800/70 bg-[#171717] text-zinc-200 lg:static lg:z-auto lg:flex lg:w-auto`}
          >
            <div className="border-b border-zinc-800 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Chats</p>
                <button
                  type="button"
                  onClick={onNewThread}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-800"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  New
                </button>
              </div>
              <label className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                <Search className="h-3.5 w-3.5" />
                <input
                  value={threadSearch}
                  onChange={(event) => setThreadSearch(event.target.value)}
                  placeholder="Search chats"
                  className="w-full border-none bg-transparent text-sm text-zinc-100 outline-none"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
              {filteredThreads.map((thread) => {
                const active = thread.id === activeThreadId;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      setSidebarOpen(false);
                    }}
                    className={`w-full rounded-xl px-3 py-2 text-left transition ${
                      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/70"
                    }`}
                  >
                    <p className="truncate text-sm font-medium">{thread.title}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Updated {formatThreadTime(thread.updatedAt) || "recently"}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3 border-t border-zinc-800 px-3 py-3">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-400">Branches</p>
                  <button
                    type="button"
                    onClick={() => onForkBranch()}
                    className="rounded-full border border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-800"
                  >
                    New
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((branch) => {
                    const active = branch.id === activeBranchId;
                    return (
                      <button
                        key={branch.id}
                        type="button"
                        onClick={() => runAsync(pinBranch(branch.id))}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          active
                            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                            : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        {branch.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                  onClick={() => runAsync(refreshNow())}
                >
                  <span className="inline-flex items-center gap-1">
                    <RefreshCcw className="h-3.5 w-3.5" /> Refresh
                  </span>
                </button>
                <CommandPalette onSelect={onCommand} />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveLibraryCollection("all");
                    setLibraryOpen(true);
                  }}
                  className="mb-2 inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
                >
                  <Library className="h-3.5 w-3.5" />
                  Open library
                </button>
                <div className="space-y-1.5">
                  {quickLibraryItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onUseLibraryItem(item.title)}
                      className="w-full rounded-lg border border-zinc-700/80 px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                    >
                      <p className="line-clamp-1 font-medium text-zinc-200">{item.title}</p>
                      <p className="line-clamp-2 text-zinc-400">{item.summary}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="relative flex min-h-0 flex-col bg-white">
            <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5">
              <div className="min-w-0">
                <div className="mb-0.5 flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 lg:hidden"
                    onClick={() => setSidebarOpen((prev) => !prev)}
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                  <h1 className="truncate text-sm font-semibold text-zinc-900">{activeThread?.title || "New chat"}</h1>
                </div>
                <p className="text-xs text-zinc-500">
                  {syncing ? "Syncing..." : activeBranch ? `Branch: ${activeBranch.name}` : "Main branch"}
                  {" • "}
                  {isStreaming ? formatPhaseLabel(activeRun?.phase) : "Idle"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onRunAudit}
                  className="hidden rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 md:inline-flex"
                >
                  Audit
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  <Library className="h-3.5 w-3.5" />
                  Library
                </button>
                {queuedMessages.length > 0 ? (
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600">
                    Queue {queuedMessages.length}
                  </span>
                ) : null}
                {branchNeedsDecision ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                    Needs approval
                  </span>
                ) : null}
                {preferences.askQuestionsFirst ? (
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600">
                    Question first
                  </span>
                ) : null}
              </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-h-0 flex-col border-zinc-200 xl:border-r">
                <ChatThread
                  messages={messages}
                  onForkFromMessage={onForkBranch}
                  onResolveDecision={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
                  onRunAction={onRunMessageAction}
                  showInlineReasoning={false}
                  isStreaming={isStreaming}
                  streamingInsight={streamingInsight}
                  contentWidthClassName="max-w-5xl 2xl:max-w-6xl"
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
                  contentWidthClassName="max-w-5xl 2xl:max-w-6xl"
                />
              </div>

              <div className="hidden min-h-0 bg-[#f8fafc] xl:block">
                <LiveActivityPanel
                  runs={processRuns}
                  feedItems={feedItems}
                  decisions={decisions}
                  onResolve={(decisionId, option) => runAsync(resolveDecision(decisionId, option))}
                  onRunAudit={onRunAudit}
                  onSteer={(instruction) => runAsync(steerRun(instruction))}
                />
              </div>
            </div>
          </section>
        </div>

        {sidebarOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/35 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close chats sidebar"
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

      {nameDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/40 pt-[18vh]">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
            <p className="text-lg font-semibold text-zinc-900">{nameDialog.title}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.08em] text-zinc-500">
              {nameDialog.mode === "thread" ? "Chat name" : "Branch name"}
            </p>
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
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
                className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={() => {
                  setNameDialog(null);
                  setNameInput("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
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
