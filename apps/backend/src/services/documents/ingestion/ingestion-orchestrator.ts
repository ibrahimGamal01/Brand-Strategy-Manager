import { ProcessEventLevel, ProcessEventType, WorkspaceDocumentIngestionStatus, WorkspaceDocumentParserStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { attachRuntimeEventV2Payload } from '../../chat/runtime/event-contract';
import { publishProcessEvent } from '../../chat/runtime/process-event-bus';
import { detectDocumentFile } from './detect-file';
import { runOcrFallbackIfNeeded } from './ocr-fallback';
import { parseCsvDocument } from './parsers/csv-parser';
import { parseDocxDocument } from './parsers/docx-parser';
import { parsePdfDocument } from './parsers/pdf-parser';
import { parsePptxDocument } from './parsers/pptx-parser';
import { parseTextDocument } from './parsers/text-parser';
import { parseXlsxDocument } from './parsers/xlsx-parser';
import { scoreParseQuality } from './quality-scorer';
import { toCanonicalMarkdown } from './canonicalize';
import { buildDocumentChunks } from './chunker';
import type { DocumentParseResult, SupportedDocumentParser } from './types';

export type DocumentIngestionInput = {
  researchJobId: string;
  branchId?: string | null;
  documentId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  initiatedBy: string;
};

export type DocumentIngestionOutput = {
  ingestionRunId: string;
  parser: SupportedDocumentParser;
  status: 'READY' | 'NEEDS_REVIEW' | 'FAILED';
  qualityScore?: number;
  warnings: string[];
  versionId?: string;
  pagesTotal?: number;
  pagesParsed?: number;
  chunkCount?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function emitDocumentEvent(input: {
  branchId?: string | null;
  type: ProcessEventType;
  level?: ProcessEventLevel;
  eventName: string;
  message: string;
  payload?: Record<string, unknown>;
  status?: 'info' | 'warn' | 'error';
  runId?: string;
  toolName?: string;
}) {
  const branchId = String(input.branchId || '').trim();
  if (!branchId) return;

  const payload = attachRuntimeEventV2Payload({
    type: input.type,
    level: input.level || ProcessEventLevel.INFO,
    message: input.message,
    payload: {
      ...(input.payload || {}),
      eventV2: {
        version: 2,
        event: input.eventName,
        phase: 'tools',
        status: input.status || (input.level === ProcessEventLevel.ERROR ? 'error' : input.level === ProcessEventLevel.WARN ? 'warn' : 'info'),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        createdAt: new Date().toISOString(),
      },
    },
  });

  const event = await prisma.processEvent.create({
    data: {
      branchId,
      type: input.type,
      level: input.level || ProcessEventLevel.INFO,
      message: input.message,
      payloadJson: payload as any,
    },
  });

  publishProcessEvent(event);
}

async function parseByParser(input: {
  parser: SupportedDocumentParser;
  mimeType: string;
  buffer: Buffer;
}): Promise<DocumentParseResult> {
  switch (input.parser) {
    case 'text':
      return parseTextDocument({ buffer: input.buffer, mimeType: input.mimeType });
    case 'csv':
      return parseCsvDocument({ buffer: input.buffer });
    case 'xlsx':
      return parseXlsxDocument({ buffer: input.buffer });
    case 'docx':
      return parseDocxDocument({ buffer: input.buffer });
    case 'pptx':
      return parsePptxDocument({ buffer: input.buffer });
    case 'pdf':
      return parsePdfDocument({ buffer: input.buffer });
    default:
      return {
        parser: 'unknown',
        text: '',
        sections: [],
        warnings: ['Unsupported document type.'],
        needsReview: true,
      };
  }
}

export async function ingestWorkspaceDocument(input: DocumentIngestionInput): Promise<DocumentIngestionOutput> {
  const detection = detectDocumentFile(input.fileName, input.mimeType);
  const parser = detection.parser;

  const ingestionRun = await prisma.workspaceDocumentIngestionRun.create({
    data: {
      researchJobId: input.researchJobId,
      branchId: input.branchId || null,
      documentId: input.documentId,
      status: WorkspaceDocumentIngestionStatus.QUEUED,
      parser,
      startedAt: new Date(),
    },
  });

  await prisma.workspaceDocument.update({
    where: { id: input.documentId },
    data: {
      parserStatus: WorkspaceDocumentParserStatus.PARSING,
      parserMetaJson: {
        parser,
        extension: detection.extension,
        mimeType: detection.mimeType,
        isBinary: detection.isBinary,
      },
    },
  });

  await emitDocumentEvent({
    branchId: input.branchId,
    type: ProcessEventType.PROCESS_LOG,
    eventName: 'document.upload_received',
    message: `Upload received: ${input.fileName}`,
    payload: {
      documentId: input.documentId,
      ingestionRunId: ingestionRun.id,
      parser,
      fileName: input.fileName,
      mimeType: input.mimeType,
      initiatedBy: input.initiatedBy,
    },
    toolName: 'document.ingest',
  });

  try {
    await prisma.workspaceDocumentIngestionRun.update({
      where: { id: ingestionRun.id },
      data: { status: WorkspaceDocumentIngestionStatus.RUNNING },
    });

    await emitDocumentEvent({
      branchId: input.branchId,
      type: ProcessEventType.PROCESS_PROGRESS,
      eventName: 'document.parse_started',
      message: `Parsing ${parser.toUpperCase()} document ${input.fileName}`,
      payload: {
        documentId: input.documentId,
        ingestionRunId: ingestionRun.id,
        parser,
      },
      toolName: 'document.ingest',
    });

    const parsed = await parseByParser({ parser, mimeType: input.mimeType, buffer: input.buffer });
    const ocrFallback = await runOcrFallbackIfNeeded({ parser, parseResult: parsed });

    let normalized = parsed;
    if (ocrFallback.applied && ocrFallback.text) {
      normalized = {
        ...normalized,
        text: ocrFallback.text,
        sections: [
          {
            headingPath: 'OCR Extracted',
            text: ocrFallback.text,
          },
        ],
        warnings: [...normalized.warnings, ...ocrFallback.warnings],
      };
    } else if (ocrFallback.warnings.length > 0) {
      normalized = {
        ...normalized,
        warnings: [...normalized.warnings, ...ocrFallback.warnings],
      };
    }

    const quality = scoreParseQuality(normalized);
    const canonical = toCanonicalMarkdown(normalized);
    const chunks = buildDocumentChunks({
      markdown: canonical.markdown,
      sectionMap: canonical.sectionMap,
    });

    const version = await prisma.$transaction(async (tx) => {
      const latest = await tx.workspaceDocumentVersion.findFirst({
        where: { documentId: input.documentId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber = (latest?.versionNumber || 0) + 1;

      const created = await tx.workspaceDocumentVersion.create({
        data: {
          documentId: input.documentId,
          branchId: String(input.branchId || '').trim() || 'global',
          versionNumber,
          contentMd: canonical.markdown,
          changeSummary: versionNumber === 1 ? 'Initial parsed canonical draft' : 'Updated canonical draft',
          patchJson: {
            parser,
            qualityScore: quality.score,
            qualityReasons: quality.reasons,
            sectionCount: normalized.sections.length,
            warningCount: normalized.warnings.length,
          },
          createdBy: input.initiatedBy,
        },
      });

      if (chunks.length > 0) {
        await tx.workspaceDocumentChunk.createMany({
          data: chunks.map((chunk) => ({
            documentId: input.documentId,
            documentVersionId: created.id,
            chunkIndex: chunk.chunkIndex,
            headingPath: chunk.headingPath || null,
            text: chunk.text,
            tokenCount: chunk.tokenCount,
            tableJson: chunk.tableJson ? (chunk.tableJson as any) : undefined,
          })),
        });
      }

      await tx.workspaceDocument.update({
        where: { id: input.documentId },
        data: {
          latestVersionId: created.id,
          parserStatus: quality.needsReview ? WorkspaceDocumentParserStatus.NEEDS_REVIEW : WorkspaceDocumentParserStatus.READY,
          parserQualityScore: quality.score,
          parserMetaJson: {
            parser,
            sectionCount: normalized.sections.length,
            warningCount: normalized.warnings.length,
            pagesTotal: normalized.pagesTotal,
            pagesParsed: normalized.pagesParsed,
            chunkCount: chunks.length,
            qualityReasons: quality.reasons,
          },
        },
      });

      await tx.workspaceDocumentIngestionRun.update({
        where: { id: ingestionRun.id },
        data: {
          status: quality.needsReview
            ? WorkspaceDocumentIngestionStatus.NEEDS_REVIEW
            : WorkspaceDocumentIngestionStatus.COMPLETED,
          warningsJson: normalized.warnings as any,
          pagesTotal: normalized.pagesTotal,
          pagesParsed: normalized.pagesParsed,
          endedAt: new Date(),
        },
      });

      return created;
    });

    await emitDocumentEvent({
      branchId: input.branchId,
      type: quality.needsReview ? ProcessEventType.PROCESS_LOG : ProcessEventType.PROCESS_RESULT,
      level: quality.needsReview ? ProcessEventLevel.WARN : ProcessEventLevel.INFO,
      eventName: quality.needsReview ? 'document.parse_needs_review' : 'document.parse_completed',
      message: quality.needsReview
        ? `Document parsed with warnings and needs review (${Math.round(quality.score * 100)}%).`
        : `Document parsed and ready (${Math.round(quality.score * 100)}%).`,
      payload: {
        documentId: input.documentId,
        versionId: version.id,
        ingestionRunId: ingestionRun.id,
        parser,
        qualityScore: quality.score,
        warnings: normalized.warnings,
        reasons: quality.reasons,
        chunkCount: chunks.length,
      },
      status: quality.needsReview ? 'warn' : 'info',
      toolName: 'document.ingest',
    });

    if (chunks.length > 0) {
      await emitDocumentEvent({
        branchId: input.branchId,
        type: ProcessEventType.PROCESS_LOG,
        eventName: 'document.chunking_completed',
        message: `Chunked document for citations (${chunks.length} chunk${chunks.length === 1 ? '' : 's'}).`,
        payload: {
          documentId: input.documentId,
          versionId: version.id,
          ingestionRunId: ingestionRun.id,
          chunkCount: chunks.length,
        },
        toolName: 'document.ingest',
      });
    }

    return {
      ingestionRunId: ingestionRun.id,
      parser,
      status: quality.needsReview ? 'NEEDS_REVIEW' : 'READY',
      qualityScore: quality.score,
      warnings: normalized.warnings,
      versionId: version.id,
      pagesTotal: normalized.pagesTotal,
      pagesParsed: normalized.pagesParsed,
      chunkCount: chunks.length,
    };
  } catch (error: any) {
    const message = String(error?.message || error || 'Unknown ingestion failure');
    await prisma.$transaction(async (tx) => {
      await tx.workspaceDocumentIngestionRun.update({
        where: { id: ingestionRun.id },
        data: {
          status: WorkspaceDocumentIngestionStatus.FAILED,
          warningsJson: [message] as any,
          endedAt: new Date(),
        },
      });
      await tx.workspaceDocument.update({
        where: { id: input.documentId },
        data: {
          parserStatus: WorkspaceDocumentParserStatus.FAILED,
          parserMetaJson: {
            parser,
            error: message,
          },
        },
      });
    });

    await emitDocumentEvent({
      branchId: input.branchId,
      type: ProcessEventType.FAILED,
      level: ProcessEventLevel.ERROR,
      eventName: 'document.parse_failed',
      message: `Failed to parse document ${input.fileName}: ${message}`,
      payload: {
        documentId: input.documentId,
        ingestionRunId: ingestionRun.id,
        parser,
        error: message,
      },
      status: 'error',
      toolName: 'document.ingest',
    });

    return {
      ingestionRunId: ingestionRun.id,
      parser,
      status: 'FAILED',
      warnings: [message],
    };
  }
}

export async function emitWorkspaceDocumentRuntimeEvent(input: {
  branchId?: string | null;
  processType: ProcessEventType;
  message: string;
  eventName: string;
  payload?: Record<string, unknown>;
  level?: ProcessEventLevel;
  status?: 'info' | 'warn' | 'error';
  toolName?: string;
}) {
  await emitDocumentEvent({
    branchId: input.branchId,
    type: input.processType,
    message: input.message,
    eventName: input.eventName,
    payload: input.payload,
    level: input.level,
    status: input.status,
    toolName: input.toolName,
  });
}
