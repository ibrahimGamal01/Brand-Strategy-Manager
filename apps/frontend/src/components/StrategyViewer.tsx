'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
    questions: Array<{
        questionType: string;
        answer: any;
    }>;
}

export function StrategyViewer({ questions }: Props) {
    const [activeTab, setActiveTab] = useState(questions[0]?.questionType || '');

    if (!questions || questions.length === 0) return null;

    const formatLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
    const activeAnswer = questions.find(q => q.questionType === activeTab)?.answer;

    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col md:flex-row min-h-[600px] overflow-hidden">

            {/* Sidebar Navigation */}
            <div className="w-full md:w-72 border-r border-zinc-800 bg-zinc-900/50 flex flex-col overflow-y-auto max-h-[600px]">
                <div className="p-4 border-b border-zinc-800 bg-zinc-900 sticky top-0 z-10">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Strategic Modules</h3>
                </div>
                <div className="p-2 space-y-1">
                    {questions.map((q) => (
                        <button
                            key={q.questionType}
                            onClick={() => setActiveTab(q.questionType)}
                            className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium transition-all flex items-center justify-between group
                ${activeTab === q.questionType
                                    ? 'bg-white text-zinc-900 shadow-sm'
                                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}
                        >
                            {formatLabel(q.questionType)}
                            {activeTab === q.questionType && <ChevronRight size={14} className="text-zinc-400" />}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Reader */}
            <div className="flex-1 bg-zinc-950 p-8 overflow-y-auto max-h-[600px]">
                <div className="max-w-3xl mx-auto animate-in fade-in duration-300 key={activeTab}">
                    <h2 className="text-2xl font-bold text-white mb-6 border-b border-zinc-800 pb-4 font-space">
                        {formatLabel(activeTab)}
                    </h2>

                    <div className="prose prose-invert prose-zinc max-w-none">
                        {typeof activeAnswer === 'string' ? (
                            <p className="whitespace-pre-wrap leading-relaxed text-zinc-300">{activeAnswer}</p>
                        ) : (
                            <div className="grid gap-6">
                                {Object.entries(activeAnswer).map(([key, value]) => (
                                    <div key={key} className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-5">
                                        <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 border-b border-zinc-800 pb-2">{formatLabel(key)}</h4>
                                        {Array.isArray(value) ? (
                                            <ul className="space-y-2">
                                                {value.map((v: any, i) => (
                                                    <li key={i} className="flex gap-2 text-zinc-300 items-start">
                                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                                                        <span>{String(v)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-zinc-300">{String(value)}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
