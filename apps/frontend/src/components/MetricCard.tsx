'use client';

import { DivideIcon as LucideIcon } from 'lucide-react';

interface MetricCardProps {
    label: string;
    value: string | number;
    subValue?: string;
    icon?: any;
}

export function MetricCard({ label, value, subValue, icon: Icon }: MetricCardProps) {
    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 flex items-start justify-between hover:border-zinc-700 transition-colors">
            <div>
                <p className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
                <h3 className="text-3xl font-bold text-white tracking-tight">{value}</h3>
                {subValue && <p className="text-xs text-emerald-500 font-medium mt-1">{subValue}</p>}
            </div>
            {Icon && (
                <div className="p-2 bg-zinc-800 rounded-md text-zinc-400">
                    <Icon size={20} />
                </div>
            )}
        </div>
    );
}
