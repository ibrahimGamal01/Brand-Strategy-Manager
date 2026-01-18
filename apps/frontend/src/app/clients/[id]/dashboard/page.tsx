'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandStrategyDashboard } from '@/components/dashboard/BrandStrategyDashboard';
import { apiClient } from '@/lib/api-client';
import { Loader2 } from 'lucide-react';

export default function ClientDashboardPage() {
    const params = useParams();
    const id = params.id as string;

    // In a real implementation, we would fetch data here and pass it down.
    // However, the Lovable UI components are currently wired to mock data internally or via props.
    // For this step, we will render the Dashboard and then incrementally wire up the pieces.
    // The Dashboard component currently uses mock data by default.

    // Let's at least verify the client exists
    const [loading, setLoading] = useState(true);
    const [client, setClient] = useState<any>(null);

    useEffect(() => {
        if (!id) return;

        async function load() {
            try {
                // Fetch basic client info to ensure it exists
                // The dashboard will hydrate with more data later
                const clientData = await apiClient.getClients(); // optimization: getClient(id) if available
                const found = clientData.find((c: any) => c.id === id);
                if (found) setClient(found);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [id]);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <Loader2 className="animate-spin text-primary" size={32} />
            </div>
        );
    }

    if (!client) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <p>Client not found</p>
            </div>
        );
    }

    // Render the new dashboard
    // We can pass real data if we modify BrandStrategyDashboard to accept it
    // For now, it uses mock data internally, which is fine for visual verification.
    return <BrandStrategyDashboard />;
}
