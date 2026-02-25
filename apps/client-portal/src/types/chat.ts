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
  reasoning?: {
    plan: string[];
    tools: string[];
    assumptions: string[];
    nextSteps: string[];
    evidence: MessageCitation[];
  };
}

export interface QueuedMessage {
  id: string;
  content: string;
  createdAt: string;
}

export type ProcessStatus = "running" | "waiting_input" | "done" | "failed" | "cancelled";

export interface ProcessRun {
  id: string;
  label: string;
  stage: string;
  progress: number;
  status: ProcessStatus;
}

export interface ProcessFeedItem {
  id: string;
  timestamp: string;
  message: string;
  actionLabel?: string;
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
}

export interface SessionPreferences {
  tone: "balanced" | "concise";
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
