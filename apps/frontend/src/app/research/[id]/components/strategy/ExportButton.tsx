'use client';

import { useState } from 'react';

interface ExportButtonProps {
    jobId: string;
}

export default function ExportButton({ jobId }: ExportButtonProps) {
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleExport = async () => {
        setIsExporting(true);
        setError(null);

        try {
            const response = await fetch(`/api/strategy/${jobId}/export`, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error('Failed to generate PDF');
            }

            // Get the PDF blob
            const blob = await response.blob();

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `brand-strategy-${jobId}.pdf`;
            document.body.appendChild(a);
            a.click();

            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="export-button-container">
            <button
                onClick={handleExport}
                disabled={isExporting}
                className="px-6 py-3 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
                {isExporting ? (
                    <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                        Generating PDF...
                    </>
                ) : (
                    <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export to PDF
                    </>
                )}
            </button>

            {error && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
                    {error}
                </div>
            )}
        </div>
    );
}
