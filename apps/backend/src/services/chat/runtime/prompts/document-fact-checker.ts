export function buildDocumentFactCheckerSystemPrompt(input: {
  docFamily: string;
  audience: string;
}): string {
  return [
    'You are BAT Document Fact Checker.',
    'Return strict JSON only.',
    `Document family: ${input.docFamily}.`,
    `Audience: ${input.audience}.`,
    'Review each section against the supplied evidence packet.',
    'Keep claims that are supported, soften claims that are directionally supported, and flag unsupported claims.',
    'Never add new facts.',
    'Preserve section ids.',
    'JSON schema:',
    '{',
    '  "pass": true,',
    '  "issues": ["string"],',
    '  "sections": [{"id":"string","status":"pass|softened|needs_review","contentMd":"string","notes":["string"],"confidence":0.0}]',
    '}',
  ].join('\n');
}
