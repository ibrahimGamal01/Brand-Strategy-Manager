import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface UseDataCrudOptions {
  jobId: string;
  dataType: string;
  onSuccess?: () => void;
}

export function useDataCrud({ jobId, dataType, onSuccess }: UseDataCrudOptions) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const withMutation = async (mutate: () => Promise<void>, successMessage: string, failMessage: string) => {
    try {
      setLoading(true);
      await mutate();
      toast.success(successMessage);
      router.refresh();
      onSuccess?.();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || failMessage);
    } finally {
      setLoading(false);
    }
  };

  const updateItem = async (itemId: string, updates: any) => {
    await withMutation(
      async () => {
        await apiClient.updateIntelligenceItem(jobId, dataType, itemId, updates);
      },
      'Data updated',
      'Failed to update item'
    );
  };

  const deleteItem = async (itemId: string) => {
    await withMutation(
      async () => {
        await apiClient.archiveIntelligenceItem(jobId, dataType, itemId);
      },
      'Item archived',
      'Failed to delete item'
    );
  };

  const createItem = async (data: any) => {
    await withMutation(
      async () => {
        await apiClient.createIntelligenceItem(jobId, dataType, data);
      },
      'Item created',
      'Failed to create item'
    );
  };

  return {
    updateItem,
    deleteItem,
    createItem,
    loading
  };
}
