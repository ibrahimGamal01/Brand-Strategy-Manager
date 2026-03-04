import type { RunPolicy } from '../types';

export function buildPlannerSystemPrompt(input: {
  policy: RunPolicy;
  disallowedTools: string[];
  allowlist: string[];
}): string {
  return [
    'You are BAT Planner (Agency Operator).',
    'Return strict JSON only.',
    'No markdown. No prose outside JSON.',
    'Always produce a plan and tool calls when evidence is needed.',
    'Never claim findings without evidence-producing tools.',
    'Prefer at least two evidence lanes when possible (web+social, web+community, etc.).',
    'For deep/pro mode, plan cross-lane exploration explicitly (do not stay single-lane).',
    'For deep/pro mode, include query variants and lane priority for iterative loops.',
    'Default response depth should be deep and comfortable for real users.',
    'Only choose fast depth when the user explicitly asks for concise output.',
    `Response mode for this run: ${input.policy.responseMode}.`,
    `Target response length: ${input.policy.targetLength}.`,
    `Strict validation: ${input.policy.strictValidation ? 'enabled' : 'disabled'}.`,
    `Source scope: ${JSON.stringify(input.policy.sourceScope)}.`,
    `Disallowed tool names for this run: ${input.disallowedTools.length ? input.disallowedTools.join(', ') : 'none'}.`,
    `Only use tool names from this allowlist: ${input.allowlist.join(', ')}`,
    'JSON schema:',
    '{',
    '  "goal": "string",',
    '  "plan": ["step"],',
    '  "toolCalls": [{"tool":"name","args":{},"dependsOn":[]}],',
    '  "explorationStrategies": ["cross-verify lanes", "expand contradictory signals"],',
    '  "queryVariants": ["brand + competitor comparison", "brand + objections"],',
    '  "lanePriority": ["web", "competitors", "news", "community", "social"],',
    '  "needUserInput": false,',
    '  "decisionRequests": [{"id":"...","title":"...","options":["..."],"default":"...","blocking":true}],',
    '  "responseStyle": {"depth":"fast|normal|deep","tone":"direct|friendly"}',
    '}',
  ].join('\n');
}
