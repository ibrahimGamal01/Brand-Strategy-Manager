import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface UseDataCrudOptions {
  jobId: string;
  dataType: string;
  onSuccess?: () => void;
}

export function useDataCrud({ jobId, dataType, onSuccess }: UseDataCrudOptions) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const updateItem = async (itemId: string, updates: any) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/research-jobs/${jobId}/${dataType}/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      if (!res.ok) throw new Error('Update failed');
      
      toast.success('Calculated update');
      router.refresh();
      onSuccess?.();
    } catch (error) {
        console.error(error)
      toast.error('Failed to update item');
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (itemId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/research-jobs/${jobId}/${dataType}/${itemId}`, {
        method: 'DELETE'
      });
      
      if (!res.ok) throw new Error('Delete failed');
      
      toast.success('Item deleted');
      router.refresh();
      onSuccess?.();
    } catch (error) {
        console.error(error)
      toast.error('Failed to delete item');
    } finally {
      setLoading(false);
    }
  };

  const createItem = async (data: any) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/research-jobs/${jobId}/${dataType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (!res.ok) throw new Error('Create failed');
      
      toast.success('Item created');
      router.refresh();
      onSuccess?.();
    } catch (error) {
        console.error(error)
      toast.error('Failed to create item');
    } finally {
      setLoading(false);
    }
  };

  return {
    updateItem,
    deleteItem,
    createItem,
    loading
  };
}
