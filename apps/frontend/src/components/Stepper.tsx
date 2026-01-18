'use client';

import { Check } from 'lucide-react';

interface StepperProps {
    status: string;
}

const STEPS = [
    { id: 'PENDING', label: 'Start' },
    { id: 'SCRAPING_CLIENT', label: 'Brand Analysis' },
    { id: 'DISCOVERING_COMPETITORS', label: 'Competitors' },
    { id: 'SCRAPING_COMPETITORS', label: 'Social Data' },
    { id: 'ANALYZING', label: 'Deep Intelligence' },
    { id: 'COMPLETE', label: 'Ready' },
];

export function Stepper({ status }: StepperProps) {
    const currentIndex = STEPS.findIndex(s => s.id === status);
    const isFailed = status === 'FAILED';

    return (
        <div className="w-full">
            <div className="flex items-center justify-between relative">
                {/* Background Line */}
                <div className="absolute top-4 left-0 w-full h-0.5 bg-zinc-800 -z-10" />

                {STEPS.map((step, index) => {
                    const isCompleted = index < currentIndex || status === 'COMPLETE';
                    const isCurrent = index === currentIndex && status !== 'COMPLETE';

                    return (
                        <div key={step.id} className="flex flex-col items-center gap-2 bg-zinc-950 px-2 first:pl-0 last:pr-0">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all
                  ${isCompleted
                                        ? 'bg-blue-600 border-blue-600 text-white'
                                        : isCurrent
                                            ? 'bg-zinc-950 border-blue-500 text-blue-500 ring-4 ring-blue-500/20'
                                            : 'bg-zinc-900 border-zinc-700 text-zinc-500'}`}
                            >
                                {isCompleted ? <Check size={14} strokeWidth={3} /> : <span className="text-xs font-bold">{index + 1}</span>}
                            </div>
                            <span className={`text-xs font-medium uppercase tracking-wide ${isCurrent ? 'text-blue-500' : 'text-zinc-500'}`}>
                                {step.label}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
