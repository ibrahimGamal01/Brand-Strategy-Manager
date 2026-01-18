'use client';

import { Database } from 'lucide-react';

export function ResearchFooter({ jobId }: { jobId: string }) {
    return (
        <footer className="border-t border-border bg-card/30 py-6 mt-12">
            <div className="container mx-auto px-6 flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                    <Database className="h-3.5 w-3.5" />
                    <span>Brand Strategy Intelligence Platform</span>
                </div>
                <div className="font-mono">
                    Job ID: {jobId} - Last updated: {new Date().toLocaleString()}
                </div>
            </div>
        </footer>
    );
}
