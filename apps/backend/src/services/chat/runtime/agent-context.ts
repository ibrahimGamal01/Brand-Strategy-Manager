import { SECTION_CONFIG } from '../../../routes/intelligence-crud-config';

export type RuntimeActorRole = 'client' | 'admin' | 'system';

export type RuntimeAgentContextUser = {
  userId?: string;
  role: RuntimeActorRole;
  orgId?: string;
  clientId?: string;
};

export type RuntimeAgentContextSection = {
  section: string;
  total: number;
  rows: Record<string, unknown>[];
  lastUpdatedAt?: string;
};

export type RuntimeAgentContextDecision = {
  id: string;
  title: string;
  options: Array<{ value: string; label?: string }>;
};

export type RuntimeAgentContext = {
  researchJobId: string;
  threadId?: string;
  branchId: string;
  runId?: string;
  syntheticSessionId: string;
  userMessage: string;
  actor: RuntimeAgentContextUser;
  permissions: {
    canMutate: boolean;
    canExportDocs: boolean;
    canRunScrapers: boolean;
    canSeeRawEvidence: boolean;
    allowedSections: string[];
  };
  workspace: {
    clientId?: string;
    clientName?: string;
    inputData: Record<string, unknown>;
    intakeDraft: Record<string, unknown>;
    goals: Array<{ goalType: string; targetValue?: string; priority?: number }>;
    brandVoice?: string;
  };
  intelligence: {
    sections: Record<string, RuntimeAgentContextSection>;
  };
  evidence: {
    webSnapshots: Array<{
      id: string;
      finalUrl?: string;
      statusCode?: number;
      fetchedAt?: string;
      snippet?: string;
    }>;
    webSources: Array<{
      id: string;
      url: string;
      domain?: string;
      sourceType?: string;
      updatedAt?: string;
    }>;
    documents: Array<{
      id: string;
      fileName: string;
      uploadedAt?: string;
      hasExtractedText: boolean;
    }>;
    competitors: {
      discovered: number;
      candidates: number;
      topPicks: Array<Record<string, unknown>>;
    };
  };
  runtime: {
    queuedMessages: Array<{ id: string; content: string; createdAt: string; position: number }>;
    pendingDecisions: RuntimeAgentContextDecision[];
    steerNotes: string[];
  };
  links: {
    appOrigin: string;
    jobBase: string;
    moduleLink: (module: string, params?: Record<string, string>) => string;
  };
  rag: {
    brainProfile?: Record<string, unknown>;
    competitorSummary: Record<string, unknown>;
    lastArtifacts: Array<{ kind: string; id: string; label: string; href?: string }>;
  };
  trace: {
    requestId: string;
    runId?: string;
  };
  nowISO: string;
};

export type BuildRuntimeAgentContextInput = {
  researchJobId: string;
  branchId: string;
  syntheticSessionId: string;
  userMessage: string;
  runId?: string;
  actor?: Partial<RuntimeAgentContextUser>;
  permissionsOverride?: Partial<RuntimeAgentContext['permissions']>;
  requestId?: string;
};

export function createRuntimeModuleLinks(appOrigin: string, researchJobId: string): RuntimeAgentContext['links'] {
  const normalizedOrigin = String(appOrigin || '').trim().replace(/\/$/, '');
  const resolvedOrigin = normalizedOrigin || 'https://brand-strategy-manager-frontend.vercel.app';
  const jobBase = `${resolvedOrigin}/research/${researchJobId}`;

  return {
    appOrigin: resolvedOrigin,
    jobBase,
    moduleLink: (module: string, params: Record<string, string> = {}) => {
      const search = new URLSearchParams({ module, ...params });
      return `${jobBase}?${search.toString()}`;
    },
  };
}

export function defaultRuntimePermissions(role: RuntimeActorRole): RuntimeAgentContext['permissions'] {
  const canMutate = role === 'admin' || role === 'system';
  const canSeeRawEvidence = role === 'admin' || role === 'system';

  return {
    canMutate,
    canExportDocs: true,
    canRunScrapers: true,
    canSeeRawEvidence,
    allowedSections: Object.keys(SECTION_CONFIG),
  };
}

