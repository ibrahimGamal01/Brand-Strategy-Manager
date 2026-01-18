'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectionProps {
    title: string;
    icon: React.ElementType;
    children: React.ReactNode;
    defaultOpen?: boolean;
    badge?: string;
}

export function Section({ title, icon: Icon, children, defaultOpen = true, badge }: SectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="space-y-4">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 w-full text-left group"
            >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
                    <Icon className="h-4 w-4 text-primary" />
                </div>
                <h2 className="text-lg font-semibold flex-1">{title}</h2>
                {badge && (
                    <span className="text-xs text-muted-foreground font-mono px-2 py-0.5 bg-muted/50 rounded">
                        {badge}
                    </span>
                )}
                {isOpen ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
            </button>
            <div
                className={cn(
                    "transition-all duration-300 overflow-hidden",
                    isOpen ? "opacity-100" : "opacity-0 h-0"
                )}
            >
                {children}
            </div>
        </div>
    );
}
