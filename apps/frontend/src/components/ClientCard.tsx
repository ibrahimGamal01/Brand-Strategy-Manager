'use client';

import { ArrowRight, Activity, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

interface ClientCardProps {
    client: {
        id: string;
        name: string;
        clientAccounts: Array<{ handle: string }>;
        researchJobs: Array<{ id: string; status: string }>;
    };
}

export function ClientCard({ client }: ClientCardProps) {
    const latestJob = client.researchJobs?.[0];
    const status = latestJob?.status || 'UNKNOWN';

    const getStatusColor = (s: string) => {
        switch (s) {
            case 'COMPLETE': return 'text-emerald-500 border-emerald-500/20 bg-emerald-500/10';
            case 'FAILED': return 'text-red-500 border-red-500/20 bg-red-500/10';
            default: return 'text-blue-500 border-blue-500/20 bg-blue-500/10';
        }
    };

    const getStatusIcon = (s: string) => {
        switch (s) {
            case 'COMPLETE': return <CheckCircle2 size={16} />;
            case 'FAILED': return <AlertCircle size={16} />;
            default: return <Activity size={16} className="animate-pulse" />;
        }
    };

    return (
        <Link
            href={latestJob ? `/research/${latestJob.id}` : '#'}
            className="group block bg-zinc-900 border border-zinc-800 rounded-lg p-6 hover:border-zinc-700 transition-all hover:shadow-lg hover:shadow-black/20"
        >
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="text-lg font-bold text-zinc-100 group-hover:text-white transition-colors">
                        {client.name}
                    </h3>
                    <p className="text-sm text-zinc-500 mt-1">
                        @{client.clientAccounts?.[0]?.handle || 'no-handle'}
                    </p>
                </div>
                <div className={`px-2.5 py-1 rounded-full border flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${getStatusColor(status)}`}>
                    {getStatusIcon(status)}
                    <span>{status.replace(/_/g, ' ')}</span>
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500 pt-4 border-t border-zinc-800/50">
                <div className="flex items-center gap-1">
                    <Clock size={12} />
                    <span>Last Active: Recent</span>
                </div>
                <div className="flex items-center gap-1 group-hover:translate-x-1 transition-transform text-zinc-400 group-hover:text-primary">
                    <span>Open Workspace</span>
                    <ArrowRight size={12} />
                </div>
            </div>
        </Link>
    );
}
