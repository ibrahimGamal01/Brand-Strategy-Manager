"use client";

import { useState, useTransition } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function NewResearchButton({ clientId }: { clientId: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleResearch = async () => {
        setIsLoading(true);
        try {
            await apiClient.createResearchJob(clientId);
            startTransition(() => {
                router.refresh();
            });
        } catch (error) {
            console.error("Failed to start research:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Button
            onClick={handleResearch}
            disabled={isLoading || isPending}
            className="gap-2"
        >
            <Search className="h-4 w-4" />
            New Research
        </Button>
    );
}
