'use client';

import type { ScenarioSimulatorBlock } from '../types';

interface ScenarioSimulatorBlockViewProps {
  block: ScenarioSimulatorBlock;
  onSelect?: (answer: string) => void;
}

export function ScenarioSimulatorBlockView({ block, onSelect }: ScenarioSimulatorBlockViewProps) {
  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">{block.title || 'Scenario simulation'}</p>
      {block.scenarioPrompt ? <p className="text-xs text-muted-foreground">{block.scenarioPrompt}</p> : null}
      <div className="space-y-2">
        {block.scenarios.map((scenario) => (
          <button
            key={scenario.id}
            onClick={() => onSelect?.(`Simulate scenario: ${scenario.label}`)}
            className="w-full rounded-lg border border-border/60 bg-background/70 p-3 text-left hover:border-primary/40"
          >
            <p className="text-sm font-semibold text-foreground">{scenario.label}</p>
            <p className="text-xs text-muted-foreground">Impact: {scenario.impact}</p>
            {scenario.risk ? <p className="text-xs text-muted-foreground">Risk: {scenario.risk}</p> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

