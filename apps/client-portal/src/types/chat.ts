export type MessageRole = "user" | "assistant" | "system";

export interface MessageCitation {
  id: string;
  label: string;
  href?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  blocks?: ChatMessageBlock[];
  reasoning?: {
    plan: string[];
    tools: string[];
    assumptions: string[];
    nextSteps: string[];
    evidence: MessageCitation[];
  };
}

export interface ChatMessageAction {
  label: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface ChatMessageDecision {
  id: string;
  title: string;
  options: Array<{ value: string; label?: string }>;
  default?: string;
  blocking?: boolean;
}

export type ChatMessageBlock =
  | {
      type: "decision_requests";
      items: ChatMessageDecision[];
    }
  | {
      type: "action_buttons";
      actions: ChatMessageAction[];
      decisions: ChatMessageDecision[];
    }
  | {
      type: Exclude<string, "decision_requests" | "action_buttons">;
      [key: string]: unknown;
    };

export interface QueuedMessage {
  id: string;
  content: string;
  createdAt: string;
}

export type ProcessStatus = "running" | "waiting_input" | "done" | "failed" | "cancelled";
export type ProcessPhase =
  | "queued"
  | "planning"
  | "tools"
  | "writing"
  | "waiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProcessMetric {
  key: string;
  value: string;
}

export interface ProcessPreviewItem {
  label: string;
  url?: string;
}

export interface ProcessRun {
  id: string;
  label: string;
  stage: string;
  phase: ProcessPhase;
  progress: number;
  status: ProcessStatus;
  details?: string[];
  metrics?: ProcessMetric[];
  highlights?: ProcessPreviewItem[];
}

export interface ProcessFeedItem {
  id: string;
  timestamp: string;
  message: string;
  actionLabel?: string;
  runId?: string;
  toolName?: string;
  phase?: ProcessPhase;
  level?: "info" | "warn" | "error";
}

export interface DecisionItem {
  id: string;
  prompt: string;
  options: string[];
}

export type LibraryCollection =
  | "web"
  | "competitors"
  | "social"
  | "community"
  | "news"
  | "deliverables";

export interface LibraryItem {
  id: string;
  collection: LibraryCollection;
  title: string;
  summary: string;
  freshness: string;
  tags: string[];
  evidenceLabel: string;
  evidenceHref?: string;
  links?: Array<{ label: string; href: string }>;
  details?: string[];
  previewText?: string;
  downloadHref?: string;
}

export interface SessionPreferences {
  tone: "balanced" | "detailed" | "concise";
  sourceFocus: "mixed" | "web" | "social";
  transparency: boolean;
  askQuestionsFirst: boolean;
}

export interface RuntimeThread {
  id: string;
  title: string;
  pinnedBranchId?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeBranch {
  id: string;
  threadId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
}

export interface RuntimeWorkspace {
  id: string;
  status: string;
  startedAt?: string | null;
  createdAt?: string;
  intakeReady?: boolean;
  role?: "ADMIN" | "CLIENT";
  client?: {
    id: string;
    name: string;
  };
}
