export type RuntimeDecisionOption = {
  value: string;
  label?: string;
};

export type RuntimeDecision = {
  id: string;
  title: string;
  options: RuntimeDecisionOption[];
  default?: string;
  blocking?: boolean;
};

export type RuntimeToolArtifact = {
  kind: string;
  id: string;
  section?: string;
};

export type RuntimeEvidenceItem = {
  kind: string;
  label: string;
  url?: string;
  refId?: string;
  status?: 'RAW' | 'PARTIAL' | 'BLOCKED' | 'VERIFIED';
  provider?: string;
  confidence?: number;
  contentHash?: string;
  runId?: string;
};

export type RuntimeSuggestedToolCall = {
  tool: string;
  args: Record<string, unknown>;
};

export type RuntimeContinuation = {
  type: 'auto_continue' | 'manual_continue';
  reason: string;
  suggestedNextTools?: string[];
  suggestedToolCalls?: RuntimeSuggestedToolCall[];
};

export type RuntimeToolResult = {
  ok: boolean;
  summary: string;
  artifacts: RuntimeToolArtifact[];
  evidence: RuntimeEvidenceItem[];
  continuations: RuntimeContinuation[];
  decisions: RuntimeDecision[];
  warnings: string[];
  raw?: Record<string, unknown>;
};

export type RuntimeToolCall = {
  tool: string;
  args: Record<string, unknown>;
  dependsOn?: string[];
};

export type RuntimePlan = {
  goal: string;
  plan: string[];
  toolCalls: RuntimeToolCall[];
  needUserInput: boolean;
  decisionRequests: RuntimeDecision[];
  responseStyle: {
    depth: 'fast' | 'normal' | 'deep';
    tone: 'direct' | 'friendly';
  };
  runtime?: {
    continuationDepth: number;
    contextSnapshot?: Record<string, unknown>;
  };
};

export type RunPolicy = {
  autoContinue: boolean;
  maxAutoContinuations: number;
  maxToolRuns: number;
  toolConcurrency: number;
  allowMutationTools: boolean;
  maxToolMs: number;
};

export type SendMessageMode = 'send' | 'queue' | 'interrupt';
