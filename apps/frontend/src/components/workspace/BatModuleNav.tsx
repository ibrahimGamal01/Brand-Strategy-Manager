'use client';

import { Badge } from '@/components/ui/badge';
import type { BatWorkspaceModuleConfig, BatWorkspaceModuleKey } from '@/lib/workspace/module-types';
import { cn } from '@/lib/utils';

interface BatModuleNavProps {
  modules: readonly BatWorkspaceModuleConfig[];
  activeModule: BatWorkspaceModuleKey;
  onChange: (module: BatWorkspaceModuleKey) => void;
}

export function BatModuleNav({ modules, activeModule, onChange }: BatModuleNavProps) {
  return (
    <nav className="flex items-center gap-2 overflow-x-auto py-2 custom-scrollbar" aria-label="BAT workspace modules">
      {modules.map((module) => {
        const active = module.key === activeModule;
        return (
          <button
            key={module.key}
            type="button"
            onClick={() => onChange(module.key)}
            className={cn(
              'inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2 text-sm transition-colors',
              active
                ? 'border-primary/40 bg-primary/15 text-foreground shadow-[0_0_30px_hsl(167_75%_52%_/_0.12)]'
                : 'border-border/70 bg-card/60 text-muted-foreground hover:border-primary/30 hover:text-foreground'
            )}
          >
            <span className="font-medium">{module.label}</span>
            {module.badge ? (
              <Badge variant="outline" className="text-[10px] uppercase">
                {module.badge}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
