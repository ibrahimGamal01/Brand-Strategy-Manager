"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Competitor {
    id: string;
    handle: string;
    discoveryReason: string;
    relevanceScore: number;
}

interface CompetitorListProps {
    initialCompetitors: Competitor[];
    clientId: string;
}

export function CompetitorList({ initialCompetitors }: CompetitorListProps) {
    const [competitors, setCompetitors] = useState(initialCompetitors);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleAction = async (id: string, action: "confirm" | "reject") => {
        // Optimistic update
        setCompetitors((prev) => prev.filter((c) => c.id !== id));

        try {
            if (action === "confirm") {
                await apiClient.confirmCompetitor(id);
            } else {
                await apiClient.rejectCompetitor(id);
            }
            startTransition(() => {
                router.refresh();
            });
        } catch (error) {
            console.error(`Failed to ${action} competitor:`, error);
            // Revert on error (could be improved with more robust state management)
            // For now, refreshing the page will restore state if operation failed
            router.refresh();
        }
    };

    if (!competitors.length) {
        return (
            <div className="text-center py-8 text-gray-400">
                No discovered competitors found. Start a research job to find some!
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {competitors.map((comp) => (
                <div
                    key={comp.id}
                    className="bg-white/5 border border-white/10 rounded-lg p-4 flex items-center justify-between group hover:bg-white/10 transition-colors"
                >
                    <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-white truncate">@{comp.handle}</span>
                            <Badge
                                variant="secondary"
                                className={cn(
                                    "text-[10px]",
                                    comp.relevanceScore > 0.8 ? "text-green-400" : "text-yellow-400"
                                )}
                            >
                                Match: {(comp.relevanceScore * 100).toFixed(0)}%
                            </Badge>
                        </div>
                        <p className="text-gray-400 text-sm truncate" title={comp.discoveryReason}>
                            {comp.discoveryReason}
                        </p>
                    </div>
                    <div className="flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8 hover:bg-green-500/20 hover:text-green-400"
                            onClick={() => handleAction(comp.id, "confirm")}
                            disabled={isPending}
                            title="Confirm Competitor"
                        >
                            <Check className="h-4 w-4" />
                        </Button>
                        <Button
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8 hover:bg-red-500/20 hover:text-red-400"
                            onClick={() => handleAction(comp.id, "reject")}
                            disabled={isPending}
                            title="Reject Competitor"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ))}
        </div>
    );
}
