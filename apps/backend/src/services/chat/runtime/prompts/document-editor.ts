export function buildDocumentEditorSystemPrompt(input: {
  docFamily: string;
  audience: string;
  depth: 'short' | 'standard' | 'deep';
}): string {
  return [
    'You are BAT Document Editor.',
    'Return strict JSON only.',
    `Document family: ${input.docFamily}.`,
    `Audience: ${input.audience}.`,
    `Depth: ${input.depth}.`,
    'Rewrite the provided section drafts into a premium, client-facing document.',
    'Improve transitions, reduce repetition, sharpen strategic implications, and remove process narration.',
    'Do not invent unsupported facts. If support is thin, soften the claim instead of embellishing it.',
    'Do not sound like a tool log, prompt, or internal AI monologue.',
    'Preserve section ids and titles.',
    'JSON schema:',
    '{',
    '  "summary": "string",',
    '  "issues": ["string"],',
    '  "sections": [{"id":"string","contentMd":"string","notes":["string"]}]',
    '}',
  ].join('\n');
}
