'use client';

import { useState, useEffect } from 'react';
import DocumentViewer from './DocumentViewer';
import ExportButton from './ExportButton';
import StrategyDocChatPanel from './StrategyDocChatPanel';
import { apiFetch, apiFetchLong } from '@/lib/api/http';

interface StrategyWorkspaceProps {
    jobId: string;
    clientName?: string;
}

interface StrategyDocument {
    sections: {
        businessUnderstanding?: string;
        targetAudience?: string;
        industryOverview?: string;
        priorityCompetitor?: string;
        contentAnalysis?: string;
        contentPillars?: string;
        formatRecommendations?: string;
        buyerJourney?: string;
        platformStrategy?: string;
    };
    generatedAt?: string;
    status: 'COMPLETE' | 'PARTIAL' | 'NONE';
    sectionsComplete?: number;
    totalSections?: number;
}

export default function StrategyWorkspace({ jobId, clientName = 'Client' }: StrategyWorkspaceProps) {
    const [document, setDocument] = useState<StrategyDocument | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check if document exists
    useEffect(() => {
        async function fetchDocument() {
            try {
                const data = await apiFetch<StrategyDocument>(`/strategy/${jobId}`);
                setDocument(data);
            } catch (err: any) {
                if (err?.status === 404) {
                    setDocument(null);
                } else {
                    setError(err?.message || 'Failed to fetch strategy document');
                }
            } finally {
                setIsLoading(false);
            }
        }

        fetchDocument();
    }, [jobId]);

    // Generate document
    const handleGenerate = async () => {
        setIsGenerating(true);
        setError(null);

        try {
            const data = await apiFetchLong<StrategyDocument>(`/strategy/${jobId}/generate`, {
                method: 'POST',
                body: JSON.stringify({ sections: 'all' })
            });
            setDocument(data);
        } catch (err: any) {
            setError(err?.message || 'Failed to generate strategy document');
        } finally {
            setIsGenerating(false);
        }
    };

    if (isLoading) {
        return (
            <div className="container mx-auto px-6 py-8">
                <div className="flex items-center justify-center py-12">
                    <div className="text-center space-y-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
                        <p className="text-muted-foreground">Checking for existing strategy document...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto px-6 py-8">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <p className="text-red-600 font-medium">Error: {error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    // Document doesn't exist - show generate CTA
    if (!document || document.status === 'NONE') {
        return (
            <div className="container mx-auto px-6 py-8">
                <div className="max-w-3xl mx-auto text-center py-12">
                    <div className="mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
                            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <h2 className="text-3xl font-bold mb-4">Generate Brand Strategy Document</h2>
                        <p className="text-lg text-muted-foreground mb-2">
                            Transform your research into a comprehensive brand strategy document.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            This will analyze all gathered intelligence and create a 9-part strategic roadmap.
                        </p>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-6 mb-8 text-left max-w-2xl mx-auto">
                        <h3 className="font-semibold mb-3">What you'll get:</h3>
                        <ul className="space-y-2 text-sm text-gray-700">
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Business Understanding & Market Positioning</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Target Audience Analysis & Personas</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Industry Overview & Competitive Landscape</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Priority Competitor Deep Dive</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Content Analysis & Performance Patterns</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Strategic Content Pillars</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Format Recommendations</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Buyer Journey Mapping</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                <span>Platform Strategy & KPIs</span>
                            </li>
                        </ul>
                    </div>

                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="px-8 py-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                    >
                        {isGenerating ? (
                            <span className="flex items-center gap-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                                Generating Document... This may take 2-3 minutes
                            </span>
                        ) : (
                            <span>Generate Strategy Document</span>
                        )}
                    </button>

                    {isGenerating && (
                        <p className="mt-4 text-sm text-muted-foreground">
                            AI is analyzing your research data and creating strategic insights...
                        </p>
                    )}
                </div>
            </div>
        );
    }

    const sectionsComplete = document.sectionsComplete ?? Object.keys(document.sections).length;
    const totalSections = document.totalSections ?? 9;
    const isIncomplete = sectionsComplete < totalSections;

    // Document exists - show viewer
    return (
        <div className="strategy-document-container">
            {/* Export Bar - Sticky */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
                <div className="max-w-4xl mx-auto px-6 py-4 flex justify-end">
                    <ExportButton jobId={jobId} />
                </div>
            </div>

            {isIncomplete && (
                <div className="mx-auto max-w-4xl px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-4 flex-wrap">
                    <span className="text-sm text-amber-800">
                        Document is incomplete ({sectionsComplete}/{totalSections} sections).
                    </span>
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="shrink-0 px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700 disabled:opacity-50"
                    >
                        {isGenerating ? 'Generating…' : 'Generate all sections'}
                    </button>
                </div>
            )}

            <div className="mx-auto w-full max-w-[1400px] px-4 py-4 lg:px-6">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-w-0">
                        <DocumentViewer
                            sections={document.sections}
                            clientName={clientName}
                            generatedAt={document.generatedAt}
                            jobId={jobId}
                        />
                    </div>
                    <div className="xl:sticky xl:top-20">
                        <StrategyDocChatPanel
                            jobId={jobId}
                            sections={document.sections}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
