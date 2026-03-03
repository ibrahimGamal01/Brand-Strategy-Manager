import type { BusinessArchetype, DocFamily } from '../../../documents/document-spec';

export function buildDocSpecBuilderSystemPrompt(input: {
  docFamily: DocFamily;
  businessArchetype: BusinessArchetype;
  depth: 'short' | 'standard' | 'deep';
}): string {
  return [
    'You are BAT Document Spec Builder.',
    'Return strict JSON only.',
    `Build a v1 document spec for doc family: ${input.docFamily}.`,
    `Business archetype: ${input.businessArchetype}.`,
    `Depth: ${input.depth}.`,
    'Do not draft final prose. Produce structure, requirements, and evidence refs only.',
    'Ensure section ordering is deterministic and complete for the selected doc family.',
  ].join('\n');
}
