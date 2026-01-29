'use client';

import { useState } from 'react';

interface EditableSectionProps {
    sectionKey: string;
    title: string;
    content: string;
    jobId: string;
    onUpdate: (sectionKey: string, newContent: string) => void;
}

export default function EditableSection({
    sectionKey,
    title,
    content,
    jobId,
    onUpdate
}: EditableSectionProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(content);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);

        try {
            const response = await fetch(`/api/strategy/${jobId}/section/${sectionKey}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: editedContent })
            });

            if (!response.ok) {
                throw new Error('Failed to save section');
            }

            // Optimistic update
            onUpdate(sectionKey, editedContent);
            setIsEditing(false);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setEditedContent(content);
        setIsEditing(false);
        setError(null);
    };

    return (
        <div className="editable-section">
            {/* Section Header with Edit Button */}
            <div className="flex items-center justify-between mb-6">
                <div className="section-header flex-1">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
                    <div className="h-1 w-16 bg-blue-600 rounded"></div>
                </div>

                {!isEditing && (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="ml-4 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors"
                    >
                        <svg className="inline-block w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit Section
                    </button>
                )}
            </div>

            {/* Edit Mode */}
            {isEditing ? (
                <div className="edit-mode">
                    <textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Edit markdown content..."
                    />

                    {error && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="mt-4 flex items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-6 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSaving ? (
                                <span className="flex items-center gap-2">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                    Saving...
                                </span>
                            ) : (
                                'Save Changes'
                            )}
                        </button>
                        <button
                            onClick={handleCancel}
                            disabled={isSaving}
                            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md font-medium hover:bg-gray-300 disabled:opacity-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <span className="text-sm text-gray-500">
                            Editing markdown - changes will update the document
                        </span>
                    </div>
                </div>
            ) : (
                // View Mode - render content as passed from parent (already rendered by DocumentViewer)
                <div className="view-mode">
                    {/* Content is rendered by parent DocumentViewer component */}
                </div>
            )}
        </div>
    );
}
