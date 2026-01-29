'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import EditableSection from './EditableSection';

interface DocumentViewerProps {
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
    clientName?: string;
    generatedAt?: string;
    jobId: string;
}

const SECTION_TITLES: { [key: string]: string } = {
    businessUnderstanding: 'Part 1: Business Understanding',
    targetAudience: 'Part 2: Target Audience',
    industryOverview: 'Part 3: Industry Overview',
    priorityCompetitor: 'Part 4: Priority Competitor Analysis',
    contentAnalysis: 'Part 5: Content Analysis',
    contentPillars: 'Part 6: Strategic Content Pillars',
    formatRecommendations: 'Part 7: Format Recommendations',
    buyerJourney: 'Part 8: Buyer Journey Mapping',
    platformStrategy: 'Part 9: Platform Strategy'
};

export default function DocumentViewer({
    sections: initialSections,
    clientName = 'Client',
    generatedAt,
    jobId
}: DocumentViewerProps) {

    // State for managing section content (allows optimistic updates)
    const [sections, setSections] = useState(initialSections);

    // Handle section updates from EditableSection
    const handleSectionUpdate = (sectionKey: string, newContent: string) => {
        setSections(prev => ({
            ...prev,
            [sectionKey]: newContent
        }));
    };

    const formattedDate = generatedAt
        ? new Date(generatedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
        : new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

    return (
        <div id="strategy-document" className="document-viewer bg-white">
            {/* Document Header */}
            <div className="document-header py-8 px-12 border-b-2 border-gray-900 bg-gradient-to-r from-gray-50 to-white">
                <h1 className="text-4xl font-bold text-gray-900 mb-2">
                    Brand Strategy Document
                </h1>
                <div className="flex justify-between items-center text-sm text-gray-600">
                    <span className="font-medium">{clientName}</span>
                    <span>Generated: {formattedDate}</span>
                </div>
            </div>

            {/* Document Content */}
            <div className="document-content max-w-4xl mx-auto px-12 py-8">
                {Object.entries(sections).map(([key, content]) => {
                    if (!content) return null;

                    return (
                        <section
                            key={key}
                            id={`section-${key}`}
                            className="document-section mb-12 pb-8 border-b border-gray-200 last:border-b-0 page-break"
                        >
                            <EditableSection
                                sectionKey={key}
                                title={SECTION_TITLES[key] || key}
                                content={content}
                                jobId={jobId}
                                onUpdate={handleSectionUpdate}
                            />

                            {/* Content rendering (when not editing) */}
                            <div className="prose prose-lg max-w-none">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        // Custom styling for markdown elements
                                        h1: ({ children }) => (
                                            <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">
                                                {children}
                                            </h3>
                                        ),
                                        h2: ({ children }) => (
                                            <h4 className="text-lg font-semibold text-gray-800 mt-6 mb-3">
                                                {children}
                                            </h4>
                                        ),
                                        h3: ({ children }) => (
                                            <h5 className="text-base font-semibold text-gray-700 mt-4 mb-2">
                                                {children}
                                            </h5>
                                        ),
                                        p: ({ children }) => (
                                            <p className="text-gray-700 leading-relaxed mb-4">
                                                {children}
                                            </p>
                                        ),
                                        ul: ({ children }) => (
                                            <ul className="list-disc list-inside space-y-2 mb-4 ml-4 text-gray-700">
                                                {children}
                                            </ul>
                                        ),
                                        ol: ({ children }) => (
                                            <ol className="list-decimal list-inside space-y-2 mb-4 ml-4 text-gray-700">
                                                {children}
                                            </ol>
                                        ),
                                        li: ({ children }) => (
                                            <li className="leading-relaxed">
                                                {children}
                                            </li>
                                        ),
                                        blockquote: ({ children }) => (
                                            <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-4 italic bg-blue-50">
                                                {children}
                                            </blockquote>
                                        ),
                                        strong: ({ children }) => (
                                            <strong className="font-semibold text-gray-900">
                                                {children}
                                            </strong>
                                        ),
                                        code: ({ className, children }) => {
                                            // Inline code
                                            if (!className) {
                                                return (
                                                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-blue-700">
                                                        {children}
                                                    </code>
                                                );
                                            }
                                            // Code block
                                            return (
                                                <code className={`${className} block bg-gray-50 p-4 rounded-lg text-sm font-mono overflow-x-auto`}>
                                                    {children}
                                                </code>
                                            );
                                        },
                                        hr: () => (
                                            <hr className="my-8 border-t-2 border-gray-200" />
                                        ),
                                        table: ({ children }) => (
                                            <div className="overflow-x-auto my-4">
                                                <table className="min-w-full divide-y divide-gray-200 border">
                                                    {children}
                                                </table>
                                            </div>
                                        ),
                                        thead: ({ children }) => (
                                            <thead className="bg-gray-50">
                                                {children}
                                            </thead>
                                        ),
                                        tbody: ({ children }) => (
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                {children}
                                            </tbody>
                                        ),
                                        th: ({ children }) => (
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                                                {children}
                                            </th>
                                        ),
                                        td: ({ children }) => (
                                            <td className="px-4 py-3 text-sm text-gray-700">
                                                {children}
                                            </td>
                                        )
                                    }}
                                >
                                    {content}
                                </ReactMarkdown>
                            </div>
                        </section>
                    );
                })}
            </div>

            <style jsx global>{`
        /* PDF-like Print Styles */
        @media print {
          .document-viewer {
            font-family: 'Georgia', 'Times New Roman', serif;
          }
          
          .page-break {
            page-break-after: always;
          }
          
          /* Hide navigation and UI elements */
          nav, header, footer, button {
            display: none !important;
          }
          
          /* Ensure proper margins */
          body {
            margin: 0;
            padding: 0;
          }
          
          /* Optimize for print */
          .document-content {
            max-width: 100%;
            padding: 0.5in;
          }
        }
        
        /* PDF-like screen styling */
        .document-viewer {
          font-family: 'Georgia', 'Times New Roman', serif;
          line-height: 1.6;
          color: #1a1a1a;
        }
        
        .document-viewer h1,
        .document-viewer h2,
        .document-viewer h3,
        .document-viewer h4,
        .document-viewer h5 {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
      `}</style>
        </div>
    );
}
