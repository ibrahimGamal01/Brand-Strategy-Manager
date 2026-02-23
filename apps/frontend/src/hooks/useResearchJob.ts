import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface ResearchJob {
  id: string;
  brandName?: string;
  status: 'PENDING' | 'SCRAPING_CLIENT' | 'DISCOVERING_COMPETITORS' | 'SCRAPING_COMPETITORS' | 'ANALYZING' | 'COMPLETE' | 'FAILED';
  continuityEnabled?: boolean;
  continuityIntervalHours?: number;
  continuityLastRunAt?: string | null;
  continuityNextRunAt?: string | null;
  continuityRunning?: boolean;
  continuityErrorMessage?: string | null;
  competitorsToFind: number;
  discoveredCompetitors: Array<{
    id: string;
    competitor: {
      handle: string;
      brandName: string;
    };
  }>;
  searchTrends?: Array<{
    keyword: string;
    interestOverTime: Record<string, number>;
    relatedQueries: { top: any[], rising: any[] };
  }>;
  communityInsights?: Array<{
    source: string;
    content: string;
    sentiment: string;
    painPoints: string[];
    desires: string[];
    marketingHooks: string[];
  }>;
  aiQuestions?: Array<{
    questionType: string;
    answer: any;
  }>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  analysisScope?: {
    runId: string;
    status: 'RUNNING' | 'COMPLETE' | 'SKIPPED' | 'FAILED';
    downloadedTotal: number;
    qualifiedForAi: number;
    analysisWindow: number;
    analyzedInWindow: number;
    attemptedAssets: number;
    succeeded: number;
    failed: number;
    skippedReason: string | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

export function useResearchJob(id: string, options: { sseHealthy?: boolean } = {}) {
  return useQuery({
    queryKey: ['researchJob', id],
    queryFn: async () =>
      (await apiClient.getResearchJob(id, { competitorScope: 'latest_run' })) as ResearchJob,
    refetchInterval: (data) => {
      // Stop polling if complete or failed
      if (
        data?.state.status === 'success' &&
        (data.state.data?.status === 'COMPLETE' || data.state.data?.status === 'FAILED') &&
        !data.state.data?.continuityEnabled
      ) {
        return false;
      }
      if (options.sseHealthy) {
        return 15000; // Reduce polling load when SSE is healthy
      }
      return 3000; // Poll every 3 seconds
    },
    enabled: !!id,
  });
}
