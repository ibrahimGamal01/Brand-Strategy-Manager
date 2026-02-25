import {
  RuntimeBranch,
  RuntimeThread,
  RuntimeWorkspace,
} from "@/types/chat";

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.details === "string"
          ? payload.details
          : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchWorkspaces(): Promise<RuntimeWorkspace[]> {
  const response = await fetch("/api/portal/workspaces", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  const payload = await parseJson<RuntimeWorkspace[] | { jobs?: RuntimeWorkspace[]; workspaces?: RuntimeWorkspace[] }>(response);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.workspaces)) return payload.workspaces;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  return [];
}

export type WorkspaceIntakeFormData = {
  name: string;
  website: string;
  websites?: string | string[];
  oneSentenceDescription: string;
  niche: string;
  businessType: string;
  operateWhere: string;
  wantClientsWhere: string;
  idealAudience: string;
  targetAudience: string;
  geoScope: string;
  servicesList: string | string[];
  mainOffer: string;
  primaryGoal: string;
  secondaryGoals: string | string[];
  futureGoal: string;
  engineGoal: string;
  topProblems: string | string[];
  resultsIn90Days: string | string[];
  questionsBeforeBuying: string | string[];
  brandVoiceWords: string | string[];
  brandTone: string;
  topicsToAvoid: string | string[];
  constraints: string;
  excludedCategories: string | string[];
  language: string;
  planningHorizon: string;
  autonomyLevel: "assist" | "auto";
  budgetSensitivity: string;
  competitorInspirationLinks: string | string[];
  handles: {
    instagram: string;
    tiktok: string;
    youtube: string;
    twitter: string;
  };
};

export type WorkspaceIntakeStatus = {
  workspaceId: string;
  required: boolean;
  completed: boolean;
  readyForChat: boolean;
  source: string;
  updatedAt: string;
  prefill: WorkspaceIntakeFormData;
  pendingQuestionSets: Array<{
    id: string;
    title: string;
    description?: string;
    questionCount: number;
  }>;
};

export type IntakeSuggestedHandleValidationItem = {
  handle: string;
  isLikelyClient: boolean;
  confidence: number;
  reason: string;
};

export type WorkspaceIntakeSuggestion = {
  success: boolean;
  suggested?: Record<string, unknown>;
  suggestedHandles?: Record<string, string>;
  suggestedHandleValidation?: {
    instagram?: IntakeSuggestedHandleValidationItem;
    tiktok?: IntakeSuggestedHandleValidationItem;
  };
  confirmationRequired?: boolean;
  confirmationReasons?: string[];
};

export async function fetchWorkspaceIntakeStatus(workspaceId: string) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/intake`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  return parseJson<WorkspaceIntakeStatus>(response);
}

export async function suggestWorkspaceIntakeCompletion(
  workspaceId: string,
  payload: Record<string, unknown>
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/intake/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  return parseJson<WorkspaceIntakeSuggestion>(response);
}

export async function submitWorkspaceIntake(
  workspaceId: string,
  payload: Record<string, unknown>
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  return parseJson<{
    success: boolean;
    workspaceId: string;
    researchJob: { id: string; status: string };
    message: string;
    pendingQuestionSets: WorkspaceIntakeStatus["pendingQuestionSets"];
  }>(response);
}

export async function saveWorkspaceIntakeDraft(
  workspaceId: string,
  payload: Record<string, unknown>
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/intake/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  return parseJson<{ ok: boolean; workspaceId: string }>(response);
}

export async function listRuntimeThreads(workspaceId: string): Promise<Array<RuntimeThread & { branches?: RuntimeBranch[] }>> {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/threads`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const payload = await parseJson<{ threads: Array<RuntimeThread & { branches?: RuntimeBranch[] }> }>(response);
  return Array.isArray(payload.threads) ? payload.threads : [];
}

export async function createRuntimeThread(workspaceId: string, input: { title: string; createdBy: string }) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });

  return parseJson<{
    thread: RuntimeThread & { branches?: RuntimeBranch[] };
    mainBranch: RuntimeBranch;
  }>(response);
}

export async function getRuntimeThread(workspaceId: string, threadId: string) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/threads/${threadId}`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  return parseJson<{
    thread: RuntimeThread;
    branches: RuntimeBranch[];
  }>(response);
}

export async function createRuntimeBranch(
  workspaceId: string,
  threadId: string,
  input: {
    name: string;
    createdBy: string;
    forkedFromBranchId?: string;
    forkedFromMessageId?: string;
  }
) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/threads/${threadId}/branches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  return parseJson<{ branch: RuntimeBranch }>(response);
}

export async function pinRuntimeBranch(workspaceId: string, threadId: string, branchId: string) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/threads/${threadId}/pin-branch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branchId }),
    credentials: "include",
  });
  return parseJson<{ thread: RuntimeThread }>(response);
}

export type RuntimeMessageDto = {
  id: string;
  role: string;
  content: string;
  blocksJson?: unknown;
  citationsJson?: unknown;
  reasoningJson?: unknown;
  createdAt: string;
};

export async function listRuntimeMessages(workspaceId: string, branchId: string) {
  const response = await fetch(
    `/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages?limit=300`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    }
  );
  return parseJson<{ messages: RuntimeMessageDto[] }>(response);
}

export type RuntimeEventDto = {
  id: string;
  type: string;
  level: string;
  message: string;
  payloadJson?: unknown;
  createdAt: string;
  agentRunId?: string | null;
  toolRunId?: string | null;
};

export async function listRuntimeEvents(workspaceId: string, branchId: string) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/events?limit=150`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  return parseJson<{ events: RuntimeEventDto[] }>(response);
}

export type RuntimeQueueDto = {
  id: string;
  content: string;
  createdAt: string;
  position: number;
  status: string;
};

export async function listRuntimeQueue(workspaceId: string, branchId: string) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/queue`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  return parseJson<{ queue: RuntimeQueueDto[] }>(response);
}

export type RuntimeActiveRunDto = {
  id: string;
  status: string;
  triggerType: string;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  toolRuns: Array<{
    id: string;
    toolName: string;
    status: string;
    createdAt: string;
    startedAt?: string | null;
    endedAt?: string | null;
  }>;
};

export async function fetchRuntimeBranchState(workspaceId: string, branchId: string) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/state`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  return parseJson<{
    branch: RuntimeBranch;
    activeRuns: RuntimeActiveRunDto[];
  }>(response);
}

export async function sendRuntimeMessage(
  workspaceId: string,
  branchId: string,
  input: {
    content: string;
    userId: string;
    mode: "send" | "queue" | "interrupt";
    policy?: Record<string, unknown>;
  }
) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  return parseJson<{
    branchId: string;
    queued: boolean;
    queueItemId?: string;
    runId?: string;
    userMessageId?: string;
  }>(response);
}

export async function interruptRuntimeBranch(workspaceId: string, branchId: string, reason = "Interrupted by user") {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/interrupt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
    credentials: "include",
  });
  return parseJson<{ ok: boolean }>(response);
}

export async function reorderRuntimeQueue(workspaceId: string, branchId: string, ids: string[]) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/queue/reorder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
    credentials: "include",
  });
  return parseJson<{ queue: RuntimeQueueDto[] }>(response);
}

export async function cancelRuntimeQueueItem(workspaceId: string, branchId: string, itemId: string) {
  const response = await fetch(`/api/research-jobs/${workspaceId}/runtime/branches/${branchId}/queue/${itemId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ queue: RuntimeQueueDto[] }>(response);
}
