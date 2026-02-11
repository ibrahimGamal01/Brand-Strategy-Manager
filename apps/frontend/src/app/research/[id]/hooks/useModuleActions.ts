'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { apiClient, ResearchModuleAction, ResearchModuleKey } from '@/lib/api-client';

export interface ModuleActionResponse {
  success: boolean;
  module: ResearchModuleKey;
  action: ResearchModuleAction;
  deletedCount: number;
  startedTasks: string[];
  skippedTasks: string[];
  errors: string[];
  warnings: string[];
  attemptedKeywords?: string[];
}

export function useModuleActions(jobId: string) {
  const router = useRouter();
  const { toast } = useToast();
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<Partial<Record<ResearchModuleKey, ModuleActionResponse>>>({});

  async function runModuleAction(module: ResearchModuleKey, action: ResearchModuleAction) {
    const key = `${module}:${action}`;

    if (runningKey === key) {
      return;
    }

    setRunningKey(key);

    try {
      const response = (await apiClient.runModuleAction(jobId, module, action)) as ModuleActionResponse | { error?: string };

      if (!response || (response as any).error) {
        throw new Error((response as any)?.error || 'Module action failed');
      }

      const result = response as ModuleActionResponse;
      setLastResults((prev) => ({ ...prev, [module]: result }));

      if (!result.success) {
        throw new Error(result.errors?.join(' | ') || 'Module action failed');
      }

      const warningSummary = result.warnings?.slice(0, 2).join(' | ');
      toast({
        title: `${module.replace(/_/g, ' ')}: ${action.replace(/_/g, ' ')}`,
        description: warningSummary || `Started ${result.startedTasks.length} task(s).`,
      });

      router.refresh();
      return result;
    } catch (error: any) {
      toast({
        title: 'Module action failed',
        description: error.message || 'Could not run module action',
        variant: 'destructive',
      });
      throw error;
    } finally {
      setRunningKey(null);
    }
  }

  function isRunning(module: ResearchModuleKey, action?: ResearchModuleAction) {
    if (!runningKey) return false;
    if (action) return runningKey === `${module}:${action}`;
    return runningKey.startsWith(`${module}:`);
  }

  function getLastResult(module: ResearchModuleKey) {
    return lastResults[module];
  }

  return {
    runModuleAction,
    isRunning,
    getLastResult,
    lastResults,
  };
}
