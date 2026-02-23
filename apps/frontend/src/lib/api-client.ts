import { apiFetch, streamUrl } from './api/http';
import type {
  BrandIntelligenceOrchestrationResponse,
  BrandIntelligenceSummaryResponse,
  CompetitorOrchestrationResponse,
  CompetitorShortlistResponse,
  MediaAnalysisScopeSummary,
  ResearchJobEventsResponse,
  ResearchModuleAction,
  ResearchModuleKey,
} from './api/types';

export type * from './api/types';

type JsonBody = Record<string, unknown>;

function post<T>(path: string, body?: JsonBody): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

function patch<T>(path: string, body?: JsonBody): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}

function put<T>(path: string, body?: JsonBody): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

function del<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}

export const apiClient = {
  getClients: () => apiFetch<any[]>('/clients'),

  createClient: (data: Record<string, unknown>) => post<any>('/clients', data),

  createClientIntakeV2: (data: Record<string, unknown>) => post<any>('/clients/intake-v2', data),

  suggestIntakeCompletion: (partialPayload: Record<string, unknown>) =>
    post<{
      success: boolean;
      suggested?: Record<string, unknown>;
      suggestedHandles?: Record<string, string>;
      suggestedHandleValidation?: {
        instagram?: { handle: string; isLikelyClient: boolean; confidence: number; reason: string };
        tiktok?: { handle: string; isLikelyClient: boolean; confidence: number; reason: string };
      };
      filledByUser?: string[];
      confirmationRequired?: boolean;
      confirmationReasons?: string[];
    }>('/clients/suggest-intake-completion', partialPayload),

  getResearchJob: (jobId: string, options?: { includeFiltered?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.includeFiltered) params.set('includeFiltered', 'true');
    const query = params.toString();
    return apiFetch<any>(`/research-jobs/${jobId}${query ? `?${query}` : ''}`);
  },

  getResearchJobOverview: (jobId: string) => apiFetch<any>(`/research-jobs/${jobId}/overview`),

  analyzeJobMedia: (
    jobId: string,
    options?: {
      skipAlreadyAnalyzed?: boolean;
      limit?: number;
      maxEligibleAssets?: number;
      maxEligiblePosts?: number;
      allowDegraded?: boolean;
    }
  ) =>
    post<{
      success: boolean;
      runId?: string;
      requested: number;
      succeeded: number;
      failed: number;
      skipped?: boolean;
      reason?: string;
      analysisScope?: MediaAnalysisScopeSummary;
      errors?: Array<{ mediaAssetId: string; error?: string }>;
    }>(
      `/research-jobs/${jobId}/analyze-media`,
      options ?? {}
    ),

  getResearchJobModule: (jobId: string, module: string, cursor?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (typeof limit === 'number') params.set('limit', String(limit));
    const query = params.toString();
    return apiFetch<any>(`/research-jobs/${jobId}/modules/${module}${query ? `?${query}` : ''}`);
  },

  getResearchJobs: () => apiFetch<any[]>('/research-jobs'),

  getResearchJobEvents: (jobId: string, afterId?: number, limit: number = 100): Promise<ResearchJobEventsResponse> => {
    const params = new URLSearchParams();
    if (afterId && afterId > 0) params.set('afterId', String(afterId));
    params.set('limit', String(limit));
    return apiFetch<ResearchJobEventsResponse>(`/research-jobs/${jobId}/events?${params.toString()}`);
  },

  streamResearchJobEvents: (jobId: string, afterId?: number): EventSource => {
    const params = new URLSearchParams();
    if (afterId && afterId > 0) params.set('afterId', String(afterId));
    const query = params.toString();
    return new EventSource(streamUrl(`/research-jobs/${jobId}/events/stream${query ? `?${query}` : ''}`));
  },

  getPostMedia: (postId: string) => apiFetch<any>(`/media/post/${postId}`),

  getCompetitors: (clientId: string, options?: { includeFiltered?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.includeFiltered) params.set('includeFiltered', 'true');
    const query = params.toString();
    return apiFetch<any>(`/competitors/client/${clientId}${query ? `?${query}` : ''}`);
  },

  getCompetitorDebugExport: (jobId: string, runId?: string) => {
    const params = new URLSearchParams();
    if (runId) params.set('runId', runId);
    const query = params.toString();
    return apiFetch<any>(`/research-jobs/${jobId}/competitors/debug-export${query ? `?${query}` : ''}`);
  },

  scrapeCompetitor: (discoveredId: string) => post<any>(`/competitors/discovered/${discoveredId}/scrape`),

  getCompetitorPosts: (discoveredId: string) => apiFetch<any>(`/competitors/discovered/${discoveredId}/posts`),

  confirmCompetitor: (discoveredId: string) => post<any>(`/competitors/discovered/${discoveredId}/confirm`),

  rejectCompetitor: (discoveredId: string) => post<any>(`/competitors/discovered/${discoveredId}/reject`),

  deleteCompetitorPosts: (discoveredId: string) => del<any>(`/competitors/discovered/${discoveredId}/posts`),

  updateJobSettings: (jobId: string, payload: { controlMode?: 'auto' | 'manual' }) =>
    patch<{ success: boolean; controlMode?: string }>(`/research-jobs/${jobId}/settings`, payload),

  runCompetitorOrchestration: (
    jobId: string,
    payload: {
      mode?: 'append' | 'replace';
      surfaces?: Array<'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'facebook' | 'website'>;
      platforms?: Array<'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'facebook' | 'website'>;
      targetCount?: number;
      precision?: 'high' | 'balanced';
      connectorPolicy?: 'ddg_first_pluggable';
      runReason?: string;
    }
  ): Promise<CompetitorOrchestrationResponse> =>
    post<CompetitorOrchestrationResponse>(`/research-jobs/${jobId}/competitors/orchestrate`, payload),

  getCompetitorShortlist: (jobId: string, runId?: string): Promise<CompetitorShortlistResponse> => {
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
    return apiFetch<CompetitorShortlistResponse>(`/research-jobs/${jobId}/competitors/shortlist${query}`);
  },

  /** Backfill top picks from intake inspiration links (optionally force-resync). */
  seedCompetitorsFromIntake: (jobId: string, options?: { force?: boolean }) =>
    post<{ success: boolean; topPicks?: number; message?: string }>(
      `/research-jobs/${jobId}/competitors/seed-from-intake${options?.force ? '?force=true' : ''}`,
      options?.force ? { force: true } : undefined
    ),

  shortlistCompetitor: (
    jobId: string,
    payload: { runId: string; profileId: string }
  ): Promise<{ success: boolean; discoveredCompetitorId?: string; error?: string }> =>
    post(`/research-jobs/${jobId}/competitors/shortlist`, payload),

  approveAndScrapeCompetitors: (
    jobId: string,
    payload: { runId: string; candidateProfileIds: string[]; competitorIds?: string[] }
  ) =>
    post<{
      success: boolean;
      approvedCount: number;
      rejectedCount: number;
      queuedCount: number;
      skippedCount: number;
      error?: string;
    }>(`/research-jobs/${jobId}/competitors/approve-and-scrape`, payload),

  continueCompetitorScrape: (
    jobId: string,
    payload: {
      candidateProfileIds?: string[];
      competitorIds?: string[];
      onlyPending?: boolean;
      runId?: string;
      forceUnavailable?: boolean;
      forceMaterialize?: boolean;
    }
  ) =>
    post<{ success: boolean; queuedCount: number; skippedCount?: number; error?: string }>(
      `/research-jobs/${jobId}/competitors/continue-scrape`,
      payload
    ),

  recheckCompetitorAvailability: (jobId: string, payload: { candidateProfileId: string }) =>
    post<{
      success: boolean;
      candidateProfileId?: string;
      handle?: string;
      platform?: string;
      availabilityStatus?: string;
      availabilityReason?: string | null;
      resolverConfidence?: number | null;
      error?: string;
      code?: string;
    }>(`/research-jobs/${jobId}/competitors/recheck-availability`, payload),

  updateCompetitorCandidateState: (
    jobId: string,
    payload: { candidateProfileId: string; state: string; reason?: string }
  ) =>
    patch<{ success: boolean; candidateProfile?: Record<string, unknown>; error?: string }>(
      `/research-jobs/${jobId}/competitors/candidate-state`,
      payload
    ),

  getCompetitorAnalysis: (competitorId: string) => apiFetch<any>(`/competitors/${competitorId}/analysis`),

  createResearchJob: (clientId: string) => post<any>('/research-jobs', { clientId }),

  getClientAnalytics: (clientId: string) => apiFetch<any>(`/analytics/client/${clientId}`),

  getTopPosts: (clientId: string, metric = 'likes', limit = 10) =>
    apiFetch<any>(`/analytics/client/${clientId}/top-posts?metric=${metric}&limit=${limit}`),

  rerunScraper: (jobId: string, scraper: string) => post<any>(`/research-jobs/${jobId}/rerun/${scraper}`),

  scrapeClientProfile: (jobId: string, platform: string, handle: string) =>
    post<{ success: boolean; profileId?: string }>(`/research-jobs/${jobId}/scrape-client-profile`, {
      platform,
      handle,
    }),

  continueResearchJob: (jobId: string) => post<any>(`/research-jobs/${jobId}/continuity/continue`),

  resumeResearchJob: (jobId: string) => post<any>(`/research-jobs/${jobId}/resume`),

  runModuleAction: (jobId: string, module: ResearchModuleKey, action: ResearchModuleAction) =>
    post<any>(`/research-jobs/${jobId}/modules/${module}/action`, { action }),

  orchestrateBrandIntelligence: (
    jobId: string,
    payload: {
      mode?: 'append' | 'replace';
      modules?: Array<'brand_mentions' | 'community_insights'>;
      moduleInputs?: {
        brand_mentions?: { depth?: 'standard' | 'deep' };
        community_insights?: { platforms?: Array<'reddit' | 'quora' | 'trustpilot' | 'forum'> };
      };
      runReason?: 'manual' | 'resume' | 'continuity' | 'module_action' | 'brain_command';
    } = {}
  ) =>
    post<BrandIntelligenceOrchestrationResponse>(
      `/research-jobs/${jobId}/brand-intelligence/orchestrate`,
      payload
    ),

  getBrandIntelligenceSummary: (jobId: string, runId?: string) => {
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
    return apiFetch<BrandIntelligenceSummaryResponse>(
      `/research-jobs/${jobId}/brand-intelligence/summary${query}`
    );
  },

  updateResearchContinuity: (jobId: string, config: { enabled?: boolean; intervalHours?: number }) =>
    patch<any>(`/research-jobs/${jobId}/continuity`, config),

  getBrain: (jobId: string, options?: { resync?: boolean }) => {
    const q = options?.resync ? '?resync=1' : '';
    return apiFetch<any>(`/research-jobs/${jobId}/brain${q}`);
  },

  createBrainCommand: (
    jobId: string,
    payload: { section: string; instruction: string; dryRun?: boolean; createdBy?: string }
  ) => post<any>(`/research-jobs/${jobId}/brain/commands`, payload),

  applyBrainCommand: (jobId: string, commandId: string) =>
    post<any>(`/research-jobs/${jobId}/brain/commands/${commandId}/apply`),

  acceptBrainSuggestion: (jobId: string, suggestionId: string) =>
    post<{ success: boolean; brainProfile?: Record<string, unknown>; error?: string }>(
      `/research-jobs/${jobId}/brain/suggestions/${suggestionId}/accept`
    ),

  rejectBrainSuggestion: (jobId: string, suggestionId: string) =>
    post<{ success: boolean; error?: string }>(`/research-jobs/${jobId}/brain/suggestions/${suggestionId}/reject`),

  listBrainCommands: (jobId: string) => apiFetch<any>(`/research-jobs/${jobId}/brain/commands`),

  updateBrainProfile: (clientId: string, payload: Record<string, unknown>) =>
    patch<any>(`/clients/${clientId}/brain-profile`, payload),

  updateDataItem: (jobId: string, dataType: string, itemId: string, payload: Record<string, unknown>) =>
    put<any>(`/research-jobs/${jobId}/${dataType}/${itemId}`, payload),

  reRequestAssets: (payload: { targets: Array<{ kind: 'brand_mention' | 'client_post' | 'social_post'; id: string }> }) =>
    post<any>('/recovery/re-request', payload),

  // Competitor state management
  updateCompetitorState: (discoveredId: string, payload: { selectionState: string; reason?: string }) =>
    patch<any>(`/competitors/discovered/${discoveredId}/state`, payload),

  updateCompetitorOrder: (discoveredId: string, payload: { displayOrder: number }) =>
    patch<any>(`/competitors/discovered/${discoveredId}/order`, payload),

  batchUpdateCompetitorStates: (payload: { updates: Array<{ id: string; selectionState: string; reason?: string }> }) =>
    patch<any>('/competitors/discovered/batch/state', payload),
};
