'use client';

import { ReactNode } from 'react';

interface ResearchCardsGridProps {
    children: ReactNode;
    className?: string;
}

/**
 * ResearchCardsGrid - 2-column responsive grid for research data cards
 */
export function ResearchCardsGrid({ children, className = '' }: ResearchCardsGridProps) {
    return (
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${className}`}>
            {children}
        </div>
    );
}
