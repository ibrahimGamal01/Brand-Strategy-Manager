'use client';

import { ReactNode } from 'react';

interface TreeLayoutProps {
    children: ReactNode;
    className?: string;
}

/**
 * TreeLayout - Container for tree-based hierarchical layout
 * Provides vertical stacking with proper spacing
 */
export function TreeLayout({ children, className = '' }: TreeLayoutProps) {
    return (
        <div className={`space-y-0 ${className}`}>
            {children}
        </div>
    );
}
