'use client';

import type { ComponentType } from 'react';
import { Loader2, PlayCircle, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ResearchModuleAction, ResearchModuleKey } from '@/lib/api-client';
import { ModuleActionResponse } from '../hooks/useModuleActions';

interface ModuleActionButtonsProps {
    module: ResearchModuleKey;
    runModuleAction: (
        module: ResearchModuleKey,
        action: ResearchModuleAction
    ) => Promise<ModuleActionResponse | undefined>;
    isRunning: (module: ResearchModuleKey, action?: ResearchModuleAction) => boolean;
    className?: string;
    compact?: boolean;
    hideLabels?: boolean;
    hiddenActions?: ResearchModuleAction[];
}

export function ModuleActionButtons({
    module,
    runModuleAction,
    isRunning,
    className,
    compact = false,
    hideLabels = false,
    hiddenActions = []
}: ModuleActionButtonsProps) {
    const runningAny = isRunning(module);

    async function handleAction(action: ResearchModuleAction) {
        if (runningAny) return;

        if (action === 'delete') {
            const confirmed = window.confirm('Delete all data in this module? This cannot be undone.');
            if (!confirmed) return;
        }

        if (action === 'run_from_start') {
            const confirmed = window.confirm('Run from start will delete and re-run this module. Continue?');
            if (!confirmed) return;
        }

        try {
            await runModuleAction(module, action);
        } catch {
            // Toast is handled in useModuleActions.
        }
    }

    function renderButton(
        action: ResearchModuleAction,
        label: string,
        icon: ComponentType<{ className?: string }>,
        variant: 'default' | 'outline' | 'secondary' = 'outline'
    ) {
        const ActionIcon = icon;
        const loading = isRunning(module, action);
        const sizeClass = compact ? 'h-7 px-2 text-[11px]' : 'h-8 text-xs';

        return (
            <Button
                type="button"
                variant={variant}
                size="sm"
                className={cn(sizeClass, hideLabels && 'w-7 px-0')}
                onClick={() => handleAction(action)}
                disabled={runningAny}
                title={label}
            >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ActionIcon className="h-3.5 w-3.5" />}
                {!hideLabels && <span className="ml-1">{label}</span>}
            </Button>
        );
    }

    return (
        <div className={cn('flex items-center gap-1', className)}>
            {!hiddenActions.includes('delete') && renderButton('delete', 'Delete', Trash2)}
            {!hiddenActions.includes('run_from_start') && renderButton('run_from_start', 'Run from Start', RotateCcw, 'secondary')}
            {!hiddenActions.includes('continue') && renderButton('continue', 'Continue', PlayCircle, 'default')}
        </div>
    );
}
