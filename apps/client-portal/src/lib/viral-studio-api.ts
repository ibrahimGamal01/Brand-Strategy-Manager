import {
  BrandDNAProfile,
  ViralStudioContractSnapshot,
  ViralStudioDocument,
  ViralStudioDocumentSection,
  ViralStudioDocumentVersion,
  ViralStudioDocumentVersionComparison,
  ViralStudioGenerationFormatTarget,
  ViralStudioGenerationPack,
  ViralStudioGenerationRefineMode,
  ViralStudioGenerationSection,
  ViralStudioIngestionEvent,
  ViralStudioIngestionRun,
  ViralStudioPlatform,
  ViralStudioPromptTemplate,
  ViralStudioReferenceAsset,
  ViralStudioStorageModeDiagnostics,
  ViralStudioTelemetrySnapshot,
} from "@/types/viral-studio";

export type ViralStudioApiError = Error & {
  status?: number;
  code?: string;
  details?: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  const raw = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.details === "string"
          ? payload.details
          : `Request failed (${response.status})`;
    const error = new Error(message) as ViralStudioApiError;
    error.status = response.status;
    if (typeof payload.code === "string") error.code = payload.code;
    if (typeof payload.details === "string") error.details = payload.details;
    throw error;
  }
  return payload as T;
}

export async function fetchWorkspaceBrandDna(workspaceId: string) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/brand-dna`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{
    ok: boolean;
    profile: BrandDNAProfile | null;
    contract: { onboarding: ViralStudioContractSnapshot["stateMachines"]["onboarding"] };
  }>(response);
}

export async function createWorkspaceBrandDna(
  workspaceId: string,
  payload: Partial<BrandDNAProfile>
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/brand-dna`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; profile: BrandDNAProfile }>(response);
}

export async function patchWorkspaceBrandDna(
  workspaceId: string,
  payload: Partial<BrandDNAProfile>
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/brand-dna`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; profile: BrandDNAProfile }>(response);
}

export async function generateWorkspaceBrandDnaSummary(
  workspaceId: string,
  payload: Partial<BrandDNAProfile>
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/brand-dna/summary`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{
    ok: boolean;
    summary: {
      summary: string;
      bullets: string[];
    };
  }>(response);
}

export async function fetchViralStudioContracts(workspaceId: string) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/contracts`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{
    ok: boolean;
    contract: ViralStudioContractSnapshot;
    promptTemplates: ViralStudioPromptTemplate[];
  }>(response);
}

export async function fetchViralStudioTelemetry(workspaceId: string) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/telemetry`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{ ok: boolean; telemetry: ViralStudioTelemetrySnapshot }>(response);
}

export async function fetchViralStudioStorageMode(workspaceId: string) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/storage-mode`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{ ok: boolean; storage: ViralStudioStorageModeDiagnostics }>(response);
}

export async function listViralStudioIngestions(workspaceId: string) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/ingestions`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{ ok: boolean; runs: ViralStudioIngestionRun[] }>(response);
}

export async function createViralStudioIngestion(
  workspaceId: string,
  payload: {
    sourcePlatform: ViralStudioPlatform;
    sourceUrl: string;
    maxVideos?: number;
    lookbackDays?: number;
    sortBy?: "engagement" | "recent" | "views";
    preset?: "balanced" | "quick-scan" | "deep-scan";
  }
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/ingestions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; run: ViralStudioIngestionRun }>(response);
}

export async function retryViralStudioIngestion(
  workspaceId: string,
  ingestionId: string
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/ingestions/${ingestionId}/retry`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return parseJson<{ ok: boolean; run: ViralStudioIngestionRun }>(response);
}

export async function fetchViralStudioIngestion(
  workspaceId: string,
  ingestionId: string
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/ingestions/${ingestionId}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{ ok: boolean; run: ViralStudioIngestionRun }>(response);
}

export async function listViralStudioIngestionEvents(
  workspaceId: string,
  ingestionId: string,
  query?: { afterId?: number; limit?: number }
) {
  const params = new URLSearchParams();
  if (typeof query?.afterId === "number") params.set("afterId", String(query.afterId));
  if (typeof query?.limit === "number") params.set("limit", String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/ingestions/${ingestionId}/events${suffix}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{
    ok: boolean;
    events: ViralStudioIngestionEvent[];
    count: number;
  }>(response);
}

export async function listViralStudioReferences(
  workspaceId: string,
  query?: { ingestionRunId?: string; shortlistOnly?: boolean; includeExcluded?: boolean }
) {
  const params = new URLSearchParams();
  if (query?.ingestionRunId) params.set("ingestionRunId", query.ingestionRunId);
  if (typeof query?.shortlistOnly === "boolean") params.set("shortlistOnly", String(query.shortlistOnly));
  if (typeof query?.includeExcluded === "boolean") params.set("includeExcluded", String(query.includeExcluded));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/references${suffix}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{
    ok: boolean;
    items: ViralStudioReferenceAsset[];
    count: number;
    scoringWeights: ViralStudioContractSnapshot["scoringWeights"];
  }>(response);
}

export async function updateViralStudioReferenceShortlist(
  workspaceId: string,
  payload: { referenceId: string; action: "pin" | "exclude" | "must-use" | "clear" }
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/references/shortlist`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; item: ViralStudioReferenceAsset }>(response);
}

export async function createViralStudioGeneration(
  workspaceId: string,
  payload: {
    templateId?: string;
    prompt?: string;
    selectedReferenceIds?: string[];
    formatTarget?: ViralStudioGenerationFormatTarget;
  }
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/generations`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; generation: ViralStudioGenerationPack }>(response);
}

export async function fetchViralStudioGeneration(
  workspaceId: string,
  generationId: string
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/generations/${generationId}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{ ok: boolean; generation: ViralStudioGenerationPack }>(response);
}

export async function refineViralStudioGeneration(
  workspaceId: string,
  generationId: string,
  payload: {
    section: ViralStudioGenerationSection;
    instruction?: string;
    mode?: ViralStudioGenerationRefineMode;
  }
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/generations/${generationId}/refine`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; generation: ViralStudioGenerationPack }>(response);
}

export async function createViralStudioDocument(
  workspaceId: string,
  payload: { title?: string; generationId: string }
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/documents`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; document: ViralStudioDocument }>(response);
}

export async function fetchViralStudioDocument(
  workspaceId: string,
  documentId: string
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentId}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<{
    ok: boolean;
    document: ViralStudioDocument;
    versions: ViralStudioDocumentVersion[];
  }>(response);
}

export async function patchViralStudioDocument(
  workspaceId: string,
  documentId: string,
  payload: {
    title?: string;
    sections?: Array<{
      id: string;
      title?: string;
      kind?: ViralStudioDocumentSection["kind"];
      content?: string | string[];
    }>;
    orderedSectionIds?: string[];
    autosave?: boolean;
  }
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{
    ok: boolean;
    document: ViralStudioDocument;
    autosavedAt?: string;
  }>(response);
}

export async function createViralStudioDocumentVersion(
  workspaceId: string,
  documentId: string,
  payload?: { author?: string; summary?: string }
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentId}/versions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  return parseJson<{
    ok: boolean;
    document: ViralStudioDocument;
    version: ViralStudioDocumentVersion;
  }>(response);
}

export async function promoteViralStudioDocumentVersion(
  workspaceId: string,
  documentId: string,
  versionId: string,
  payload?: { author?: string; summary?: string }
) {
  const response = await fetch(
    `/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentId}/versions/${versionId}/promote`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    }
  );
  return parseJson<{
    ok: boolean;
    document: ViralStudioDocument;
    version: ViralStudioDocumentVersion;
    promotedFromVersionId: string;
  }>(response);
}

export async function compareViralStudioDocumentVersions(
  workspaceId: string,
  documentId: string,
  leftVersionId: string,
  rightVersionId: string
) {
  const params = new URLSearchParams();
  params.set("leftVersionId", leftVersionId);
  params.set("rightVersionId", rightVersionId);
  const response = await fetch(
    `/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentId}/compare?${params.toString()}`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    }
  );
  return parseJson<{
    ok: boolean;
    comparison: ViralStudioDocumentVersionComparison;
  }>(response);
}

export async function exportViralStudioDocument(
  workspaceId: string,
  documentId: string,
  format: "markdown" | "json"
) {
  const response = await fetch(`/api/portal/workspaces/${workspaceId}/viral-studio/documents/${documentId}/export`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format }),
  });
  return parseJson<{
    ok: boolean;
    export: {
      format: "markdown" | "json";
      fileName: string;
      contentType: string;
      content: string;
    };
  }>(response);
}
