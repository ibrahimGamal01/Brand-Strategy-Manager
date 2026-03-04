type ExtractExplicitSearchQueryInput = {
  competitorIntent?: boolean;
  defaultQuery?: string;
  maxLength?: number;
};

function compactSearchText(value: string, maxLength: number): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

export function extractCompetitorQueryTarget(message: string): string {
  const raw = String(message || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const forMatch = raw.match(/\bfor\s+([^.!?\n]{2,100})/i);
  if (forMatch?.[1]) return forMatch[1].trim();
  const ofMatch = raw.match(/\bof\s+([^.!?\n]{2,100})/i);
  if (ofMatch?.[1]) return ofMatch[1].trim();
  return '';
}

export function sanitizeSearchQueryText(message: string): string {
  const compact = String(message || '')
    .replace(/use pinned library evidence:[^\n]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';

  const stripped = compact
    .replace(
      /^(please\s+)?(?:can you\s+)?(?:run|do|execute|start|continue|perform)?\s*(?:a\s+)?(?:full\s+)?(?:web\s+)?search(?:\s+the\s+web)?\s*(?:for|on|about)?\s*/i,
      ''
    )
    .replace(/^(please\s+)?(?:look up|find online|search online|research)\s*/i, '')
    .trim();

  return stripped || compact;
}

export function extractExplicitSearchQuery(
  message: string,
  input: ExtractExplicitSearchQueryInput = {}
): string {
  const maxLength = Number.isFinite(Number(input.maxLength))
    ? Math.max(24, Math.min(220, Math.floor(Number(input.maxLength))))
    : 100;
  const compact = sanitizeSearchQueryText(message);
  const competitorIntent = Boolean(input.competitorIntent);
  const hasOrchestrationSyntax =
    /\b(run|continue|execute|use tools|scenario|next actions|workspace|intelligence audit|evidence loop)\b/i.test(compact) ||
    compact.includes('\n') ||
    compact.split(/[,.]/).length > 4;
  const hasLongAudienceSentence =
    /\/| who want| looking for| technology-framed approach|consistency and structure/i.test(compact) ||
    compact.length > 140;

  if (competitorIntent) {
    const target = extractCompetitorQueryTarget(compact);
    if (target) {
      return compactSearchText(`${target} competitors alternatives`, maxLength) || 'direct competitors alternatives';
    }
  }

  if (hasOrchestrationSyntax || hasLongAudienceSentence) {
    return input.defaultQuery || (competitorIntent ? 'direct competitors alternatives' : 'brand strategy research');
  }

  const normalized = compact
    .replace(/[“”"'`]/g, ' ')
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const finalQuery = compactSearchText(normalized, maxLength);
  if (finalQuery.length >= 12) return finalQuery;
  return input.defaultQuery || (competitorIntent ? 'direct competitors alternatives' : 'brand strategy research');
}
