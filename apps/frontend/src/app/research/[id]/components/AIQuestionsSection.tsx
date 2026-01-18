'use client';

import { Brain, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { JsonViewer } from '@/components/ui/json-viewer';

interface Question {
    id: string;
    questionType: string;
    question: string;
    answer: any;
    answerJson?: any;
    confidence?: number;
}

interface AIQuestionsSectionProps {
    questions: Question[];
}

export function AIQuestionsSection({ questions }: AIQuestionsSectionProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const toggleExpand = (id: string) => {
        setExpandedId(expandedId === id ? null : id);
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {questions.map((q, i) => {
                    const isExpanded = expandedId === (q.id || i.toString());
                    const displayId = q.id || i.toString();

                    return (
                        <Card
                            key={displayId}
                            className={cn(
                                "transition-all duration-200 hover:shadow-md cursor-pointer",
                                isExpanded ? "md:col-span-2 lg:col-span-3 ring-2 ring-primary/20" : ""
                            )}
                            onClick={() => toggleExpand(displayId)}
                        >
                            <CardHeader className="pb-2 space-y-0">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1">
                                        <span className="text-xs font-mono text-primary px-2 py-0.5 bg-primary/10 rounded-full uppercase tracking-wider">
                                            {q.questionType?.replace(/_/g, ' ')}
                                        </span>
                                        <CardTitle className="text-base font-medium leading-tight mt-2">
                                            {q.question || q.questionType?.replace(/_/g, ' ')}
                                        </CardTitle>
                                    </div>
                                    {isExpanded ? (
                                        <ChevronUp className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                    ) : (
                                        <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className={cn(
                                    "text-sm text-muted-foreground transition-all",
                                    isExpanded ? "" : "line-clamp-3"
                                )}>
                                    {typeof q.answer === 'string' ? (
                                        <div className="space-y-4">
                                            <p className="whitespace-pre-line leading-relaxed">{q.answer}</p>
                                            {isExpanded && (
                                                <JsonViewer
                                                    data={q.answerJson || { ...q, answer: undefined }}
                                                    title="Raw Analysis Data"
                                                    className="mt-4"
                                                />
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <JsonViewer
                                                data={q.answer || q}
                                                title="Structured Answer"
                                                defaultExpanded={true}
                                            />
                                        </div>
                                    )}
                                </div>
                                {!isExpanded && (
                                    <div className="mt-2 text-xs text-primary font-medium">Click to read more</div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {questions.length === 0 && (
                <div className="text-center py-12 border border-dashed border-border rounded-lg bg-muted/20">
                    <Brain className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <h3 className="text-lg font-medium">No Strategic Analysis Yet</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Running 12 strategic questions analysis...
                    </p>
                </div>
            )}
        </div>
    );
}
