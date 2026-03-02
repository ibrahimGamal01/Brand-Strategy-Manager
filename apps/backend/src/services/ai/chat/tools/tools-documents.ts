import {
  generateDocumentForResearchJob,
  getGeneratedDocumentById,
} from '../../../documents/document-service';
import {
  applyRuntimeDocumentEdit,
  compareRuntimeDocumentVersions,
  ensureDocumentBelongsToWorkspace,
  exportRuntimeDocumentVersion,
  proposeRuntimeDocumentEdit,
  readRuntimeDocument,
  searchRuntimeDocument,
  uploadRuntimeDocuments,
} from '../../../documents/workspace-document-service';
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

function parseJsonBuffer(value: unknown): Buffer {
  if (typeof value === 'string') {
    return Buffer.from(value, 'base64');
  }
  if (Array.isArray(value)) {
    return Buffer.from(value.map((entry) => Number(entry || 0)));
  }
  return Buffer.from('');
}

function resolveBranchId(context: { sessionId: string }): string {
  const raw = String(context.sessionId || '').trim();
  if (raw.startsWith('runtime-')) {
    const parsed = raw.slice('runtime-'.length);
    if (parsed) return parsed;
  }
  return raw || 'runtime-unknown-branch';
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
  {
    name: 'document.ingest',
    description: 'Register an uploaded file into workspace document ingestion pipeline.',
    argsSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        fileBase64: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['fileName', 'mimeType', 'fileBase64'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        documents: { type: 'array', items: { type: 'object' } },
      },
      required: ['documents'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const fileName = String(args.fileName || '').trim();
      const mimeType = String(args.mimeType || '').trim() || 'application/octet-stream';
      if (!fileName) {
        throw new Error('fileName is required');
      }
      const buffer = parseJsonBuffer(args.fileBase64);
      if (!buffer.length) {
        throw new Error('fileBase64 produced empty file');
      }
      return uploadRuntimeDocuments({
        researchJobId: context.researchJobId,
        branchId: resolveBranchId(context),
        userId: 'runtime-tool',
        files: [
          {
            originalname: fileName,
            mimetype: mimeType,
            size: buffer.length,
            buffer,
          },
        ],
        title: typeof args.title === 'string' ? args.title : undefined,
      });
    },
  },
  {
    name: 'document.read',
    description: 'Read a workspace document version with canonical markdown content.',
    argsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        versionId: { type: 'string' },
      },
      required: ['documentId'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        title: { type: 'string' },
        versionId: { type: 'string' },
        versionNumber: { type: 'number' },
        contentMd: { type: 'string' },
      },
      required: ['documentId', 'title', 'versionId', 'versionNumber', 'contentMd'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context, args) => {
      const documentId = String(args.documentId || '').trim();
      if (!documentId) throw new Error('documentId is required');
      return readRuntimeDocument({
        researchJobId: context.researchJobId,
        documentId,
        versionId: String(args.versionId || '').trim() || undefined,
      });
    },
  },
  {
    name: 'document.search',
    description: 'Search within canonical document chunks and return grounded hits.',
    argsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['documentId', 'query'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        title: { type: 'string' },
        query: { type: 'string' },
        hits: { type: 'array', items: { type: 'object' } },
      },
      required: ['documentId', 'query', 'hits'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context, args) => {
      const documentId = String(args.documentId || '').trim();
      const query = String(args.query || '').trim();
      return searchRuntimeDocument({
        researchJobId: context.researchJobId,
        documentId,
        query,
        limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : undefined,
      });
    },
  },
  {
    name: 'document.propose_edit',
    description: 'Create an edit proposal for a canonical document version.',
    argsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        instruction: { type: 'string' },
      },
      required: ['documentId', 'instruction'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        baseVersionId: { type: 'string' },
        proposedContentMd: { type: 'string' },
        changed: { type: 'boolean' },
      },
      required: ['documentId', 'baseVersionId', 'proposedContentMd', 'changed'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const documentId = String(args.documentId || '').trim();
      const instruction = String(args.instruction || '').trim();
      if (!documentId || !instruction) {
        throw new Error('documentId and instruction are required');
      }
      return proposeRuntimeDocumentEdit({
        researchJobId: context.researchJobId,
        branchId: resolveBranchId(context),
        documentId,
        instruction,
        userId: 'runtime-tool',
      });
    },
  },
  {
    name: 'document.apply_edit',
    description: 'Apply an approved edit proposal and create a new document version.',
    argsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        proposedContentMd: { type: 'string' },
        changeSummary: { type: 'string' },
        baseVersionId: { type: 'string' },
      },
      required: ['documentId', 'proposedContentMd'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        versionId: { type: 'string' },
        versionNumber: { type: 'number' },
      },
      required: ['documentId', 'versionId', 'versionNumber'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const documentId = String(args.documentId || '').trim();
      if (!documentId) throw new Error('documentId is required');
      await ensureDocumentBelongsToWorkspace({ researchJobId: context.researchJobId, documentId });
      return applyRuntimeDocumentEdit({
        researchJobId: context.researchJobId,
        branchId: resolveBranchId(context),
        documentId,
        userId: 'runtime-tool',
        proposedContentMd: String(args.proposedContentMd || ''),
        changeSummary: String(args.changeSummary || ''),
        baseVersionId: String(args.baseVersionId || '').trim() || undefined,
      });
    },
  },
  {
    name: 'document.export',
    description: 'Export a document version to PDF, DOCX, or MD.',
    argsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        format: { type: 'string', enum: ['PDF', 'DOCX', 'MD'] },
        versionId: { type: 'string' },
      },
      required: ['documentId', 'format'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        exportId: { type: 'string' },
        documentId: { type: 'string' },
        versionId: { type: 'string' },
        format: { type: 'string' },
        downloadHref: { type: 'string' },
      },
      required: ['exportId', 'documentId', 'versionId', 'format'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const documentId = String(args.documentId || '').trim();
      const format = String(args.format || '').trim().toUpperCase() as 'PDF' | 'DOCX' | 'MD';
      if (!documentId || !format) {
        throw new Error('documentId and format are required');
      }
      return exportRuntimeDocumentVersion({
        researchJobId: context.researchJobId,
        branchId: resolveBranchId(context),
        documentId,
        format,
        versionId: String(args.versionId || '').trim() || undefined,
        userId: 'runtime-tool',
      });
    },
  },
  {
    name: 'document.compare_versions',
    description: 'Compare two document versions and summarize key diffs.',
    argsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        fromVersionId: { type: 'string' },
        toVersionId: { type: 'string' },
      },
      required: ['documentId', 'fromVersionId', 'toVersionId'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        summary: { type: 'object' },
        added: { type: 'array', items: { type: 'string' } },
        removed: { type: 'array', items: { type: 'string' } },
      },
      required: ['documentId', 'summary', 'added', 'removed'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context, args) => {
      return compareRuntimeDocumentVersions({
        researchJobId: context.researchJobId,
        branchId: resolveBranchId(context),
        documentId: String(args.documentId || '').trim(),
        fromVersionId: String(args.fromVersionId || '').trim(),
        toVersionId: String(args.toVersionId || '').trim(),
      });
    },
  },
];
