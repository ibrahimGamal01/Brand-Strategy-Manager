import {
  generateDocumentForResearchJob,
  getGeneratedDocumentById,
} from '../../../documents/document-service';
import type { DocumentPlan } from '../../../documents/document-spec';
import type { ToolDefinition } from './tool-types';

function normalizePlanInput(args: Record<string, unknown>): Partial<DocumentPlan> {
  return {
    docType: String(args.docType || args.template || 'STRATEGY_BRIEF').toUpperCase() as DocumentPlan['docType'],
    title: typeof args.title === 'string' ? args.title : undefined,
    audience: typeof args.audience === 'string' ? args.audience : undefined,
    timeframeDays: Number.isFinite(Number(args.timeframeDays)) ? Number(args.timeframeDays) : undefined,
    depth: typeof args.depth === 'string' ? (args.depth as DocumentPlan['depth']) : undefined,
    includeCompetitors: typeof args.includeCompetitors === 'boolean' ? args.includeCompetitors : undefined,
    includeEvidenceLinks: typeof args.includeEvidenceLinks === 'boolean' ? args.includeEvidenceLinks : undefined,
  };
}

export const documentTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'document.plan',
    description: 'Normalize and return a document generation plan from user preferences.',
    argsSchema: {
      type: 'object',
      properties: {
        docType: { type: 'string', enum: ['STRATEGY_BRIEF', 'COMPETITOR_AUDIT', 'CONTENT_CALENDAR'] },
        title: { type: 'string' },
        audience: { type: 'string' },
        timeframeDays: { type: 'number' },
        depth: { type: 'string', enum: ['short', 'standard', 'deep'] },
        includeCompetitors: { type: 'boolean' },
        includeEvidenceLinks: { type: 'boolean' },
      },
      additionalProperties: true,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object' },
      },
      required: ['plan'],
      additionalProperties: false,
    },
    mutate: false,
    execute: async (_context, args) => ({ plan: normalizePlanInput(args) }),
  },
  {
    name: 'document.generate',
    description: 'Generate a PDF document for the current research workspace.',
    argsSchema: {
      type: 'object',
      properties: {
        docType: { type: 'string', enum: ['STRATEGY_BRIEF', 'COMPETITOR_AUDIT', 'CONTENT_CALENDAR'] },
        title: { type: 'string' },
        audience: { type: 'string' },
        timeframeDays: { type: 'number' },
        depth: { type: 'string', enum: ['short', 'standard', 'deep'] },
        includeCompetitors: { type: 'boolean' },
        includeEvidenceLinks: { type: 'boolean' },
      },
      additionalProperties: true,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string' },
        title: { type: 'string' },
        storagePath: { type: 'string' },
        mimeType: { type: 'string' },
      },
      required: ['docId', 'title', 'storagePath', 'mimeType'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) =>
      generateDocumentForResearchJob(context.researchJobId, normalizePlanInput(args)) as unknown as Record<string, unknown>,
  },
  {
    name: 'document.status',
    description: 'Get status and metadata of a generated document by id.',
    argsSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string' },
      },
      required: ['docId'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        found: { type: 'boolean' },
        document: { type: 'object' },
      },
      required: ['found'],
      additionalProperties: false,
    },
    mutate: false,
    execute: async (context, args) => {
      const docId = String(args.docId || '').trim();
      if (!docId) return { found: false };
      const document = await getGeneratedDocumentById(context.researchJobId, docId);
      if (!document) return { found: false };
      return {
        found: true,
        document: {
          id: document.id,
          fileName: document.fileName,
          filePath: document.filePath,
          mimeType: document.mimeType,
          uploadedAt: document.uploadedAt.toISOString(),
        },
      };
    },
  },
];
