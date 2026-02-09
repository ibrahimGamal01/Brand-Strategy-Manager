'use client';

import { Brain } from 'lucide-react';
import { TreeNodeCard, DataList } from './';

interface AiAnalysisNodeProps {
    aiQuestions: any[];
}

export function AiAnalysisNode({ aiQuestions }: AiAnalysisNodeProps) {
    return (
        <TreeNodeCard
            title="AI Strategic Analysis"
            icon={<Brain className="h-4 w-4" />}
            count={aiQuestions.length}
            defaultExpanded={aiQuestions.length > 0}
            level={1}
        >
            {aiQuestions.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6 px-4">
                    No AI analysis available yet
                </div>
            ) : (
                <DataList
                    items={aiQuestions.map((qa: any) => ({
                        id: qa.id || qa.question,
                        title: qa.question,
                        content: qa.answer
                    }))}
                />
            )}
        </TreeNodeCard>
    );
}
