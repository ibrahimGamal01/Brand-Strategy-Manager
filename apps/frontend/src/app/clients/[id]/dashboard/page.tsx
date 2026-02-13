'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

export default function LegacyClientDashboardRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  useEffect(() => {
    let cancelled = false;

    async function redirectToBatWorkspace() {
      try {
        const clients = await apiClient.getClients();
        const client = clients.find((item: { id?: string; researchJobs?: Array<{ id?: string }> }) => item.id === id);
        const latestJobId = client?.researchJobs?.[0]?.id;

        if (!cancelled) {
          if (latestJobId) router.replace(`/research/${latestJobId}`);
          else router.replace('/clients/new');
        }
      } catch {
        if (!cancelled) router.replace('/');
      }
    }

    void redirectToBatWorkspace();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Redirecting to BAT workspace...
      </div>
    </div>
  );
}
