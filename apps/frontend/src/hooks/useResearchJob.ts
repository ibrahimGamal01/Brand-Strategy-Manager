import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const BACKEND_URL = 'http://localhost:3001/api'; // In production this should be env var

export interface ResearchJob {
  id: string;
  brandName?: string;
  status: 'PENDING' | 'SCRAPING_CLIENT' | 'DISCOVERING_COMPETITORS' | 'SCRAPING_COMPETITORS' | 'ANALYZING' | 'COMPLETE' | 'FAILED';
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
}

export function useResearchJob(id: string) {
  return useQuery({
    queryKey: ['researchJob', id],
    queryFn: async () => {
      const { data } = await axios.get<ResearchJob>(`${BACKEND_URL}/research-jobs/${id}`);
      return data;
    },
    refetchInterval: (data) => {
      // Stop polling if complete or failed
      if (data?.state.status === 'success' && (data.state.data?.status === 'COMPLETE' || data.state.data?.status === 'FAILED')) {
        return false;
      }
      return 3000; // Poll every 3 seconds
    },
    enabled: !!id,
  });
}
