import { apiFetch, streamUrl } from './api/http';
import type {
  CompetitorOrchestrationResponse,
  CompetitorShortlistResponse,
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

  getResearchJob: (jobId: string) => apiFetch<any>(`/research-jobs/${jobId}`),

  getResearchJobOverview: (jobId: string) => apiFetch<any>(`/research-jobs/${jobId}/overview`),

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

  getCompetitors: (clientId: string) => apiFetch<any>(`/competitors/client/${clientId}`),

  scrapeCompetitor: (discoveredId: string) => post<any>(`/competitors/discovered/${discoveredId}/scrape`),

  getCompetitorPosts: (discoveredId: string) => apiFetch<any>(`/competitors/discovered/${discoveredId}/posts`),

  confirmCompetitor: (discoveredId: string) => post<any>(`/competitors/discovered/${discoveredId}/confirm`),

  rejectCompetitor: (discoveredId: string) => post<any>(`/competitors/discovered/${discoveredId}/reject`),

  deleteCompetitorPosts: (discoveredId: string) => del<any>(`/competitors/discovered/${discoveredId}/posts`),

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
    }
  ) =>
    post<{ success: boolean; queuedCount: number; skippedCount?: number; error?: string }>(
      `/research-jobs/${jobId}/competitors/continue-scrape`,
      payload
    ),

  getCompetitorAnalysis: (competitorId: string) => apiFetch<any>(`/competitors/${competitorId}/analysis`),

  createResearchJob: (clientId: string) => post<any>('/research-jobs', { clientId }),

  getClientAnalytics: (clientId: string) => apiFetch<any>(`/analytics/client/${clientId}`),

  getTopPosts: (clientId: string, metric = 'likes', limit = 10) =>
    apiFetch<any>(`/analytics/client/${clientId}/top-posts?metric=${metric}&limit=${limit}`),

  rerunScraper: (jobId: string, scraper: string) => post<any>(`/research-jobs/${jobId}/rerun/${scraper}`),

  continueResearchJob: (jobId: string) => post<any>(`/research-jobs/${jobId}/continuity/continue`),

  resumeResearchJob: (jobId: string) => post<any>(`/research-jobs/${jobId}/resume`),

  runModuleAction: (jobId: string, module: ResearchModuleKey, action: ResearchModuleAction) =>
    post<any>(`/research-jobs/${jobId}/modules/${module}/action`, { action }),

  updateResearchContinuity: (jobId: string, config: { enabled?: boolean; intervalHours?: number }) =>
    patch<any>(`/research-jobs/${jobId}/continuity`, config),

  getBrain: (jobId: string) => apiFetch<any>(`/research-jobs/${jobId}/brain`),

  createBrainCommand: (
    jobId: string,
    payload: { section: string; instruction: string; dryRun?: boolean; createdBy?: string }
  ) => post<any>(`/research-jobs/${jobId}/brain/commands`, payload),

  applyBrainCommand: (jobId: string, commandId: string) =>
    post<any>(`/research-jobs/${jobId}/brain/commands/${commandId}/apply`),

  listBrainCommands: (jobId: string) => apiFetch<any>(`/research-jobs/${jobId}/brain/commands`),

  updateBrainProfile: (clientId: string, payload: Record<string, unknown>) =>
    patch<any>(`/clients/${clientId}/brain-profile`, payload),

  updateDataItem: (jobId: string, dataType: string, itemId: string, payload: Record<string, unknown>) =>
    put<any>(`/research-jobs/${jobId}/${dataType}/${itemId}`, payload),
};
