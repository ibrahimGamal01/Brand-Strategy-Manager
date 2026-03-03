import type { DocumentSectionKind } from './business-archetypes';
import type { BusinessArchetype, DocFamily } from './document-spec';

export type DocumentSpecSection = {
  id: string;
  kind: DocumentSectionKind;
  title: string;
  requirements: string[];
  evidenceRefIds: string[];
};

export type DocumentSpecV1 = {
  version: 'v1';
  docFamily: DocFamily;
  title: string;
  audience: 'internal' | 'client' | 'board';
  businessArchetype: BusinessArchetype;
  depth: 'short' | 'standard' | 'deep';
  requestedIntent?: string;
  renderedIntent?: string;
  styleProfile: string;
  sections: DocumentSpecSection[];
};

export type DocumentSpecValidationResult = {
  valid: boolean;
  errors: string[];
  value: DocumentSpecV1 | null;
};

const ALLOWED_DOC_FAMILIES = new Set<DocFamily>([
  'SWOT',
  'BUSINESS_STRATEGY',
  'PLAYBOOK',
  'COMPETITOR_AUDIT',
  'CONTENT_CALENDAR',
  'GO_TO_MARKET',
]);
const ALLOWED_ARCHETYPES = new Set<BusinessArchetype>([
  'b2b_saas',
  'ecommerce',
  'wellness',
  'financial_services',
  'professional_services',
  'generic',
]);
const ALLOWED_AUDIENCES = new Set(['internal', 'client', 'board']);
const ALLOWED_DEPTH = new Set(['short', 'standard', 'deep']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeSection(value: unknown, index: number): DocumentSpecSection | null {
  if (!isRecord(value)) return null;
  const id = String(value.id || `section-${index + 1}`).trim();
  const kind = String(value.kind || '').trim() as DocumentSectionKind;
  const title = String(value.title || '').trim();
  if (!id || !kind || !title) return null;
  return {
    id,
    kind,
    title,
    requirements: asStringArray(value.requirements, 12),
    evidenceRefIds: asStringArray(value.evidenceRefIds, 40),
  };
}

export const DOCUMENT_SPEC_V1_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'docFamily', 'title', 'audience', 'businessArchetype', 'depth', 'styleProfile', 'sections'],
  properties: {
    version: { const: 'v1' },
    docFamily: {
      type: 'string',
      enum: ['SWOT', 'BUSINESS_STRATEGY', 'PLAYBOOK', 'COMPETITOR_AUDIT', 'CONTENT_CALENDAR', 'GO_TO_MARKET'],
    },
    title: { type: 'string', minLength: 2, maxLength: 180 },
    audience: { type: 'string', enum: ['internal', 'client', 'board'] },
    businessArchetype: {
      type: 'string',
      enum: ['b2b_saas', 'ecommerce', 'wellness', 'financial_services', 'professional_services', 'generic'],
    },
    depth: { type: 'string', enum: ['short', 'standard', 'deep'] },
    requestedIntent: { type: 'string' },
    renderedIntent: { type: 'string' },
    styleProfile: { type: 'string', minLength: 2, maxLength: 120 },
    sections: {
      type: 'array',
      minItems: 3,
      maxItems: 32,
      items: {
        type: 'object',
        required: ['id', 'kind', 'title', 'requirements', 'evidenceRefIds'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 2, maxLength: 120 },
          kind: { type: 'string', minLength: 2, maxLength: 80 },
          title: { type: 'string', minLength: 2, maxLength: 180 },
          requirements: { type: 'array', items: { type: 'string' } },
          evidenceRefIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export function validateDocumentSpecV1(input: unknown): DocumentSpecValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { valid: false, errors: ['DocumentSpec must be an object.'], value: null };
  }

  const version = String(input.version || '').trim();
  if (version !== 'v1') {
    errors.push('version must be v1.');
  }

  const docFamily = String(input.docFamily || '').trim() as DocFamily;
  if (!ALLOWED_DOC_FAMILIES.has(docFamily)) {
    errors.push(`Unsupported docFamily: ${docFamily || 'empty'}.`);
  }

  const title = String(input.title || '').trim();
  if (title.length < 2) {
    errors.push('title is required.');
  }

  const audience = String(input.audience || '').trim().toLowerCase();
  if (!ALLOWED_AUDIENCES.has(audience)) {
    errors.push(`Invalid audience: ${audience || 'empty'}.`);
  }

  const businessArchetype = String(input.businessArchetype || '').trim() as BusinessArchetype;
  if (!ALLOWED_ARCHETYPES.has(businessArchetype)) {
    errors.push(`Invalid businessArchetype: ${businessArchetype || 'empty'}.`);
  }

  const depth = String(input.depth || '').trim().toLowerCase();
  if (!ALLOWED_DEPTH.has(depth)) {
    errors.push(`Invalid depth: ${depth || 'empty'}.`);
  }

  const styleProfile = String(input.styleProfile || '').trim();
  if (styleProfile.length < 2) {
    errors.push('styleProfile is required.');
  }

  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const sections = rawSections
    .map((section, index) => normalizeSection(section, index))
    .filter((section): section is DocumentSpecSection => Boolean(section))
    .slice(0, 32);

  const minSectionsByFamily: Record<DocFamily, number> = {
    SWOT: 7,
    BUSINESS_STRATEGY: 10,
    PLAYBOOK: 7,
    COMPETITOR_AUDIT: 8,
    CONTENT_CALENDAR: 6,
    GO_TO_MARKET: 9,
  };
  const minSections = minSectionsByFamily[docFamily] ?? 3;
  if (sections.length < minSections) {
    errors.push(`At least ${minSections} sections are required for ${docFamily}.`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: {
      version: 'v1',
      docFamily,
      title,
      audience: audience as DocumentSpecV1['audience'],
      businessArchetype,
      depth: depth as DocumentSpecV1['depth'],
      requestedIntent: String(input.requestedIntent || '').trim() || undefined,
      renderedIntent: String(input.renderedIntent || '').trim() || undefined,
      styleProfile,
      sections,
    },
  };
}

export function repairDocumentSpecV1(input: unknown): DocumentSpecV1 {
  const record = isRecord(input) ? input : {};
  const fallback: DocumentSpecV1 = {
    version: 'v1',
    docFamily: 'BUSINESS_STRATEGY',
    title: 'Generated Document',
    audience: 'client',
    businessArchetype: 'generic',
    depth: 'deep',
    styleProfile: 'strategy_standard_v1',
    sections: [
      {
        id: 'executive-summary',
        kind: 'executive_summary',
        title: 'Executive Summary',
        requirements: ['Summarize objectives and evidence confidence.'],
        evidenceRefIds: [],
      },
      {
        id: 'analysis',
        kind: 'signal_analysis',
        title: 'Signal Analysis',
        requirements: ['Highlight major evidence-backed signals.'],
        evidenceRefIds: [],
      },
      {
        id: 'roadmap',
        kind: 'roadmap_30_60_90',
        title: '30/60/90 Plan',
        requirements: ['Provide immediate, mid-term, and long-term actions.'],
        evidenceRefIds: [],
      },
    ],
  };

  const candidate = {
    version: 'v1',
    docFamily: String(record.docFamily || fallback.docFamily).trim(),
    title: String(record.title || fallback.title).trim(),
    audience: String(record.audience || fallback.audience).trim().toLowerCase(),
    businessArchetype: String(record.businessArchetype || fallback.businessArchetype).trim(),
    depth: String(record.depth || fallback.depth).trim().toLowerCase(),
    requestedIntent: String(record.requestedIntent || '').trim() || undefined,
    renderedIntent: String(record.renderedIntent || '').trim() || undefined,
    styleProfile: String(record.styleProfile || fallback.styleProfile).trim(),
    sections: Array.isArray(record.sections) ? record.sections : fallback.sections,
  };

  const validation = validateDocumentSpecV1(candidate);
  if (validation.valid && validation.value) {
    return validation.value;
  }
  return fallback;
}
