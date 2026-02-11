'use client';

import { useEffect, useState } from 'react';
import { Building2, Globe, Clock, PlayCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

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
    onContinueNow?: () => void | Promise<void>;
    onSaveContinuity?: (config: { enabled: boolean; intervalHours: number }) => void | Promise<void>;
    isContinuing?: boolean;
    isSavingContinuity?: boolean;
}

function formatDateTime(value?: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
}

export function ClientHeader({
    client,
    job,
    onContinueNow,
    onSaveContinuity,
    isContinuing = false,
    isSavingContinuity = false
}: ClientHeaderProps) {
    const status = statusConfig[job.status] || statusConfig.PENDING;
    const [continuityEnabled, setContinuityEnabled] = useState<boolean>(Boolean(job.continuityEnabled));
    const [continuityIntervalHours, setContinuityIntervalHours] = useState<number>(
        Math.max(2, Number(job.continuityIntervalHours) || 2)
    );

    useEffect(() => {
        setContinuityEnabled(Boolean(job.continuityEnabled));
        setContinuityIntervalHours(Math.max(2, Number(job.continuityIntervalHours) || 2));
    }, [job.continuityEnabled, job.continuityIntervalHours, job.id]);

    const running = Boolean(job.continuityRunning) || isContinuing;

    async function handleSaveContinuity() {
        if (!onSaveContinuity) return;
        await onSaveContinuity({
            enabled: continuityEnabled,
            intervalHours: Math.max(2, Math.floor(continuityIntervalHours || 2))
        });
    }

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

                        <div className="mt-3 rounded-lg border border-border/70 bg-background/60 p-3 text-left min-w-[300px]">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Continuity</p>
                                <Switch
                                    checked={continuityEnabled}
                                    onCheckedChange={setContinuityEnabled}
                                    disabled={isSavingContinuity}
                                />
                            </div>

                            <div className="mt-2 flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Every</span>
                                <Input
                                    type="number"
                                    min={2}
                                    value={continuityIntervalHours}
                                    onChange={(e) => setContinuityIntervalHours(Math.max(2, Number(e.target.value) || 2))}
                                    className="h-8 w-20 text-xs"
                                    disabled={isSavingContinuity}
                                />
                                <span className="text-xs text-muted-foreground">hours (min 2)</span>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={onContinueNow}
                                    disabled={running}
                                    className="h-8 text-xs gap-1.5"
                                >
                                    {running ? <RefreshCw className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                                    Continue Now
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSaveContinuity}
                                    disabled={isSavingContinuity}
                                    className="h-8 text-xs"
                                >
                                    {isSavingContinuity ? 'Saving...' : 'Save'}
                                </Button>
                            </div>

                            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                                <p>Last run: {formatDateTime(job.continuityLastRunAt)}</p>
                                <p>Next run: {continuityEnabled ? formatDateTime(job.continuityNextRunAt) : 'Disabled'}</p>
                                {job.continuityErrorMessage && (
                                    <p className="text-destructive line-clamp-2">Last error: {job.continuityErrorMessage}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
