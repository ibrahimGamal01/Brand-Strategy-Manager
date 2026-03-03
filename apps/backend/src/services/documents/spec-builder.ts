import {
  canonicalDocFamily,
  type BusinessArchetype,
  type DocFamily,
  type DocumentDataPayload,
  type DocumentPlan,
} from './document-spec';
import {
  inferBusinessArchetype,
  resolveSectionsForDocFamily,
  type ArchetypeSectionBlueprint,
} from './business-archetypes';
import {
  repairDocumentSpecV1,
  validateDocumentSpecV1,
  type DocumentSpecSection,
  type DocumentSpecV1,
} from './document-spec-schema';

export type BuildDocumentSpecInput = {
  plan: DocumentPlan;
  payload: DocumentDataPayload;
  title?: string;
  businessArchetype?: BusinessArchetype;
  docFamily?: DocFamily;
};

export type BuildDocumentSpecResult = {
  spec: DocumentSpecV1;
  repaired: boolean;
  validationErrors: string[];
};

function toSectionId(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'section';
}

function collectEvidenceRefIds(payload: DocumentDataPayload, lane?: ArchetypeSectionBlueprint['requiredEvidenceLane']): string[] {
  if (lane === 'competitors') {
    return payload.competitors
      .map((row) => String(row.profileUrl || '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((url, index) => `evidence:competitor:${index + 1}:${url}`);
  }
  if (lane === 'posts') {
    return payload.topPosts
      .map((row) => String(row.postUrl || '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((url, index) => `evidence:post:${index + 1}:${url}`);
  }
  if (lane === 'web') {
    return payload.webSnapshots
      .map((row) => String(row.finalUrl || '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((url, index) => `evidence:web:${index + 1}:${url}`);
  }
  if (lane === 'news') {
    return payload.news
      .map((row) => String(row.url || '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((url, index) => `evidence:news:${index + 1}:${url}`);
  }
  if (lane === 'community') {
    return payload.communityInsights
      .map((row) => String(row.url || '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((url, index) => `evidence:community:${index + 1}:${url}`);
  }

  const merged = [
    ...collectEvidenceRefIds(payload, 'web'),
    ...collectEvidenceRefIds(payload, 'competitors'),
    ...collectEvidenceRefIds(payload, 'posts'),
    ...collectEvidenceRefIds(payload, 'news'),
    ...collectEvidenceRefIds(payload, 'community'),
  ];
  return Array.from(new Set(merged)).slice(0, 12);
}

function buildSectionBlueprints(input: {
  docFamily: DocFamily;
  archetype: BusinessArchetype;
  payload: DocumentDataPayload;
}): DocumentSpecSection[] {
  return resolveSectionsForDocFamily({ docFamily: input.docFamily, archetype: input.archetype }).map((section) => {
    const evidenceRefIds = collectEvidenceRefIds(input.payload, section.requiredEvidenceLane);
    return {
      id: toSectionId(section.title),
      kind: section.kind,
      title: section.title,
      requirements: [
        `Use ${section.kind} structure appropriate for ${input.docFamily}.`,
        ...(section.requiredEvidenceLane ? [`Ground claims in ${section.requiredEvidenceLane} evidence lane.`] : []),
        ...(typeof section.minEvidenceRefs === 'number' ? [`Include at least ${section.minEvidenceRefs} cited evidence references where available.`] : []),
      ],
      evidenceRefIds,
    };
  });
}

export function buildDocumentSpecV1(input: BuildDocumentSpecInput): BuildDocumentSpecResult {
  const docFamily = input.docFamily || canonicalDocFamily(input.plan.docType);
  const businessArchetype =
    input.businessArchetype ||
    inferBusinessArchetype({
      businessType: input.payload.businessType,
      userIntent: input.plan.requestedIntent || input.payload.requestedIntent,
      docFamily,
    });

  const draft: DocumentSpecV1 = {
    version: 'v1',
    docFamily,
    title: String(input.title || input.plan.title || `${input.payload.clientName} ${docFamily}`).trim(),
    audience: /board|investor/i.test(input.plan.audience || input.payload.audience) ? 'board' : 'client',
    businessArchetype,
    depth: input.plan.depth === 'short' || input.plan.depth === 'standard' || input.plan.depth === 'deep' ? input.plan.depth : 'standard',
    requestedIntent: input.plan.requestedIntent || input.payload.requestedIntent,
    renderedIntent: `${docFamily.toLowerCase()}_v1`,
    styleProfile:
      docFamily === 'SWOT'
        ? 'swot_standard_v1'
        : docFamily === 'PLAYBOOK'
          ? 'playbook_standard_v1'
          : docFamily === 'COMPETITOR_AUDIT'
            ? 'competitor_audit_v1'
            : docFamily === 'CONTENT_CALENDAR'
              ? 'content_calendar_v1'
              : docFamily === 'GO_TO_MARKET'
                ? 'go_to_market_v1'
                : `strategy_standard_${businessArchetype}_v1`,
    sections: buildSectionBlueprints({ docFamily, archetype: businessArchetype, payload: input.payload }),
  };

  const validation = validateDocumentSpecV1(draft);
  if (validation.valid && validation.value) {
    return {
      spec: validation.value,
      repaired: false,
      validationErrors: [],
    };
  }

  // One repair attempt max (deterministic, schema-safe fallback)
  const repaired = repairDocumentSpecV1(draft);
  const repairedValidation = validateDocumentSpecV1(repaired);
  return {
    spec: repairedValidation.value || repaired,
    repaired: true,
    validationErrors: validation.errors,
  };
}
