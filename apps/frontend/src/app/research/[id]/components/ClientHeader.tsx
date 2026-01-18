'use client';

import { Building2, Globe, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const statusConfig: Record<string, { variant: string; label: string }> = {
    PENDING: { variant: 'secondary', label: 'Pending' },
    SCRAPING_CLIENT: { variant: 'warning', label: 'Scraping Client' },
    DISCOVERING_COMPETITORS: { variant: 'warning', label: 'Finding Competitors' },
    ANALYZING: { variant: 'default', label: 'AI Analyzing' },
    COMPLETE: { variant: 'success', label: 'Complete' },
    FAILED: { variant: 'destructive', label: 'Failed' },
};

interface ClientHeaderProps {
    client: any;
    job: any;
}

export function ClientHeader({ client, job }: ClientHeaderProps) {
    const status = statusConfig[job.status] || statusConfig.PENDING;

    return (
        <div className="border-b border-border bg-card/50 backdrop-blur-sm">
            <div className="container mx-auto px-6 py-5">
                <div className="flex items-start justify-between">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                                <Building2 className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight">{client.name || 'Research Job'}</h1>
                                {client.currentSocialPresence && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Globe className="h-3.5 w-3.5" />
                                        <span>{client.currentSocialPresence}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        {client.businessOverview && (
                            <p className="max-w-2xl text-sm text-muted-foreground leading-relaxed">
                                {client.businessOverview}
                            </p>
                        )}
                    </div>

                    <div className="text-right space-y-2">
                        <Badge variant={status.variant as any} className="text-sm px-3 py-1">
                            {job.status === 'ANALYZING' && (
                                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                            )}
                            {status.label}
                        </Badge>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground justify-end">
                            <Clock className="h-3 w-3" />
                            <span>
                                {job.startedAt || job.createdAt
                                    ? `Started ${new Date(job.startedAt || job.createdAt).toLocaleDateString()}`
                                    : 'Recently started'}
                            </span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                            Job ID: {job.id?.slice(0, 8)}...
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
