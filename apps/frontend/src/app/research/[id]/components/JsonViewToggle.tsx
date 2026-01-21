'use client';

import { useState } from 'react';
import { Code, Eye } from 'lucide-react';

interface JsonViewToggleProps {
    data: any;
    children: React.ReactNode;
    className?: string;
}

/**
 * Wrapper component that allows toggling between formatted view and raw JSON view
 * Use this for any text-based result sections
 */
export function JsonViewToggle({ data, children, className = '' }: JsonViewToggleProps) {
    const [showJson, setShowJson] = useState(false);

    return (
        <div className={className}>
            {/* Toggle Button */}
            <div className="flex justify-end mb-2">
                <button
                    onClick={() => setShowJson(!showJson)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md
                               text-muted-foreground hover:text-foreground
                               bg-muted/50 hover:bg-muted transition-colors"
                    title={showJson ? 'Show formatted view' : 'Show JSON'}
                >
                    {showJson ? (
                        <>
                            <Eye className="w-3.5 h-3.5" />
                            Formatted
                        </>
                    ) : (
                        <>
                            <Code className="w-3.5 h-3.5" />
                            JSON
                        </>
                    )}
                </button>
            </div>

            {/* Content */}
            {showJson ? (
                <div className="relative">
                    <pre className="p-4 rounded-lg bg-zinc-900/80 text-zinc-100 text-xs font-mono 
                                    overflow-auto max-h-[500px] scrollbar-thin scrollbar-thumb-zinc-700">
                        {JSON.stringify(data, null, 2)}
                    </pre>
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                        }}
                        className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-zinc-700 
                                   hover:bg-zinc-600 text-zinc-200 transition-colors"
                    >
                        Copy
                    </button>
                </div>
            ) : (
                children
            )}
        </div>
    );
}
