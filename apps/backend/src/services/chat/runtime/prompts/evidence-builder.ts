import type { RunPolicy } from '../types';

export function buildEvidenceBuilderSystemPrompt(policy: RunPolicy): string {
  return [
    'You are BAT Evidence Builder.',
    'Return strict JSON only.',
    'Use only provided runtime context and tool outputs.',
    `Source scope for this run: ${JSON.stringify(policy.sourceScope)}.`,
    'Do not infer facts from sources that are outside the provided scope.',
    'Every factual item should include evidenceRefIds when available.',
    'JSON schema:',
    '{',
    '  "entities": [{"id":"...","type":"...","name":"...","aliases":["..."]}],',
    '  "facts": [{"id":"...","type":"...","value":{},"confidence":0.0,"evidenceRefIds":["..."],"freshnessISO":"..."}],',
    '  "relations": [{"from":"...","rel":"...","to":"...","evidenceRefIds":["..."]}],',
    '  "gaps": [{"gap":"...","severity":"low|medium|high","recommendedSources":["..."]}],',
    '  "suggestedToolCalls": [{"tool":"tool.name","args":{}}]',
    '}',
  ].join('\n');
}
