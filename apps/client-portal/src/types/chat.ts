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
  inputOptions?: ChatInputOptions;
  attachmentIds?: string[];
  documentIds?: string[];
  reasoning?: {
    plan: string[];
    tools: string[];
    assumptions: string[];
    nextSteps: string[];
    evidence: MessageCitation[];
    model?: {
      requested: string;
      used: string;
      fallbackUsed: boolean;
      fallbackFrom?: string;
    };
    quality?: {
      intent: "competitor_brief" | "general";
      passed: boolean;
      notes?: string[];
    };
    runId?: string;
    ledgerVersionId?: string;
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
      type: "document_ready" | "document_parse_needs_review";
      documentId: string;
      versionId?: string | null;
      title: string;
      originalFileName?: string;
      qualityScore?: number | null;
      parser?: string;
      chunkCount?: number | null;
      pagesParsed?: number | null;
      pagesTotal?: number | null;
      warnings?: string[];
      actions?: ChatMessageAction[];
    }
  | {
      type: "document_edit_proposal";
      documentId: string;
      baseVersionId: string;
      baseVersionNumber: number;
      instruction: string;
      proposedContentMd: string;
      changed: boolean;
      changeSummary?: string;
      anchor?: {
        quotedText: string;
        replacementText?: string;
        matched: boolean;
        matchType?: "exact" | "whitespace";
        matchCount?: number;
      };
      preview?: {
        beforeChars: number;
        afterChars: number;
      };
      actions?: ChatMessageAction[];
    }
  | {
      type: "document_edit_applied";
      documentId: string;
      versionId: string;
      versionNumber: number;
      changeSummary?: string;
      actions?: ChatMessageAction[];
    }
  | {
      type: "document_export_result";
      documentId: string;
      versionId: string;
      exportId: string;
      format: "PDF" | "DOCX" | "MD";
      fileSizeBytes?: number;
      downloadHref?: string;
    }
  | {
      type: Exclude<
        string,
        | "decision_requests"
        | "action_buttons"
        | "document_ready"
        | "document_parse_needs_review"
        | "document_edit_proposal"
        | "document_edit_applied"
        | "document_export_result"
      >;
      [key: string]: unknown;
    };

export interface QueuedMessage {
  id: string;
  content: string;
  createdAt: string;
  position?: number;
  inputOptions?: ChatInputOptions;
  attachmentIds?: string[];
  documentIds?: string[];
  steer?: {
    note?: string;
    updatedAt?: string;
  };
}

export interface UploadedDocumentChip {
  id: string;
  title: string;
  fileName: string;
  status: "uploading" | "parsing" | "ready" | "needs_review" | "failed";
  qualityScore?: number | null;
  warnings?: string[];
  attachmentId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ChatInputSourceScope {
  workspaceData: boolean;
  libraryPinned: boolean;
  uploadedDocs: boolean;
  webSearch: boolean;
  liveWebsiteCrawl: boolean;
  socialIntel: boolean;
}

export interface ChatInputOptions {
  modeLabel: "fast" | "balanced" | "deep" | "pro";
  sourceScope: ChatInputSourceScope;
  targetLength: "short" | "medium" | "long";
  libraryRefs?: string[];
  steerNote?: string;
  strictValidation?: boolean;
  pauseAfterPlanning?: boolean;
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

export interface DecisionItem {
  id: string;
  prompt: string;
  options: string[];
  runId?: string;
}

export interface ProcessRunV3LaneStat {
  lane: string;
  queries: number;
  hits: number;
}

export interface ProcessRunV3Detail {
  mode?: string;
  stats?: ProcessMetric[];
  laneStats: ProcessRunV3LaneStat[];
  topCandidates: ProcessPreviewItem[];
  evidenceLinks: ProcessPreviewItem[];
  warnings: string[];
  approvals: DecisionItem[];
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
  v3Detail?: ProcessRunV3Detail;
}

export interface ProcessFeedItem {
  id: string;
  timestamp: string;
  message: string;
  details?: string[];
  actionLabel?: string;
  actionTarget?: {
    kind: "document";
    documentId: string;
  };
  runId?: string;
  toolName?: string;
  phase?: ProcessPhase;
  level?: "info" | "warn" | "error";
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
  libraryRef?: string;
  collection: LibraryCollection;
  title: string;
  summary: string;
  snippet?: string;
  freshness: string;
  tags: string[];
  evidenceLabel: string;
  evidenceHref?: string;
  links?: Array<{ label: string; href: string }>;
  details?: string[];
  previewText?: string;
  downloadHref?: string;
  trustStatus?: "high" | "medium" | "low";
  trustScore?: number;
  trustReasonCodes?: string[];
  evidenceCount?: number;
  evidenceLinks?: Array<{ label: string; href: string }>;
  actions?: Array<{ key: string; label: string }>;
}

export interface SessionPreferences {
  responseMode: "fast" | "balanced" | "deep" | "pro";
  tone: "balanced" | "detailed" | "concise";
  sourceScope: ChatInputSourceScope;
  transparency: boolean;
  askQuestionsFirst: boolean;
  targetLength: "short" | "medium" | "long";
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
