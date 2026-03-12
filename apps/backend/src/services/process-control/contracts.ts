import { ProcessRunDocumentType } from '@prisma/client';
import {
  PHASE2_REQUEST_MODES,
  type Phase2RequestMode,
  type ProcessRunTargetInput,
} from './request-compiler';

export type ProcessRunCreateContract = {
  documentType: ProcessRunDocumentType;
  objective: string;
  requestMode: Phase2RequestMode;
  targets?: ProcessRunTargetInput[];
  idempotencyKey?: string;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeIdempotencyKey(value: unknown): string {
  return normalizeText(value)
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 120);
}

function normalizeRequestMode(value: unknown): Phase2RequestMode {
  const raw = normalizeText(value).toLowerCase();
  if ((PHASE2_REQUEST_MODES as readonly string[]).includes(raw)) {
    return raw as Phase2RequestMode;
  }
  if (raw === 'single' || raw === 'single_document') return 'single_doc';
  if (raw === 'sections' || raw === 'section_only') return 'section_bundle';
  if (raw === 'multi' || raw === 'composite') return 'multi_doc_bundle';
  return 'single_doc';
}

function parseTargets(value: unknown): ProcessRunTargetInput[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const parsed = value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      artifactType: normalizeText(entry.artifactType).toUpperCase(),
      sections: Array.isArray(entry.sections)
        ? entry.sections.map((section) => normalizeText(section).toLowerCase()).filter(Boolean)
        : undefined,
      objective: normalizeText(entry.objective) || undefined,
    }))
    .filter((entry) => Boolean(entry.artifactType));

  return parsed.length ? parsed : undefined;
}

export function parseProcessRunCreateContract(payload: unknown): ProcessRunCreateContract {
  const body = asRecord(payload);

  const rawDocType = normalizeText(body.documentType).toUpperCase();
  const documentType = rawDocType === ProcessRunDocumentType.BUSINESS_STRATEGY
    ? ProcessRunDocumentType.BUSINESS_STRATEGY
    : ProcessRunDocumentType.BUSINESS_STRATEGY;

  const objective = normalizeText(body.objective) || 'Build a business strategy document';
  const requestMode = normalizeRequestMode(body.requestMode || body.mode);
  const targets = parseTargets(body.targets);
  const idempotencyKey = sanitizeIdempotencyKey(body.idempotencyKey);

  return {
    documentType,
    objective,
    requestMode,
    ...(targets ? { targets } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export type SectionRevisionContract = {
  markdown: string;
  summary?: string;
  createdByRole?: string;
};

export function parseSectionRevisionContract(payload: unknown): SectionRevisionContract {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};

  const markdown = normalizeText(body.markdown);
  if (!markdown) {
    throw new Error('markdown is required');
  }

  const summary = normalizeText(body.summary);
  const createdByRole = normalizeText(body.createdByRole);

  return {
    markdown,
    ...(summary ? { summary } : {}),
    ...(createdByRole ? { createdByRole } : {}),
  };
}

export function parseQuestionAnswerContract(payload: unknown): { answer: unknown } {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};

  if (!Object.prototype.hasOwnProperty.call(body, 'answer')) {
    throw new Error('answer is required');
  }

  return {
    answer: body.answer,
  };
}
