import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProcessEventLevel, ProcessEventType, WorkspaceDocumentExportFormat } from '@prisma/client';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { prisma } from '../../lib/prisma';
import { STORAGE_ROOT } from '../storage/storage-root';
import { createFileAttachment } from '../chat/file-attachments';
import { renderPdfFromHtml } from './pdf-renderer';
import { ingestWorkspaceDocument, emitWorkspaceDocumentRuntimeEvent } from './ingestion/ingestion-orchestrator';
import { buildDocumentChunks } from './ingestion/chunker';

export type RuntimeUploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type UploadedWorkspaceDocument = {
  id: string;
  title: string;
  originalFileName: string;
  mimeType: string;
  storagePath: string;
  parserStatus: 'PENDING' | 'PARSING' | 'READY' | 'NEEDS_REVIEW' | 'FAILED';
  parserQualityScore: number | null;
  latestVersionId: string | null;
  ingestionRunId?: string;
  warnings: string[];
  branchId: string;
  attachmentId?: string;
};

type SourceKind = 'UPLOADED' | 'GENERATED' | 'IMPORTED';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 10;

function sanitizeFileName(value: string): string {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function stripExtension(fileName: string): string {
  const normalized = String(fileName || '').trim();
  const dot = normalized.lastIndexOf('.');
  if (dot <= 0) return normalized;
  return normalized.slice(0, dot);
}

function ensureAbsolutePathForStorage(storagePath: string): string {
  const normalized = String(storagePath || '').trim();
  if (!normalized) throw new Error('storagePath is required');
  if (path.isAbsolute(normalized)) return normalized;
  if (normalized.startsWith('storage/')) {
    return path.join(STORAGE_ROOT, normalized.replace(/^storage\//, ''));
  }
  if (normalized.startsWith('/storage/')) {
    return path.join(STORAGE_ROOT, normalized.replace(/^\/storage\//, ''));
  }
  return path.join(STORAGE_ROOT, normalized);
}

function toStorageRelativePath(absPath: string): string {
  const rel = path.relative(STORAGE_ROOT, absPath).split(path.sep).join('/');
  return `storage/${rel}`;
}

function toStorageHref(storagePath: string): string {
  const normalized = String(storagePath || '').trim();
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('/storage/')) return normalized;
  if (normalized.startsWith('storage/')) return `/${normalized}`;
  return `/storage/${normalized.replace(/^\/+/, '')}`;
}

function allowedMime(mimeType: string, fileName: string): boolean {
  const mime = String(mimeType || '').toLowerCase();
  const ext = String(path.extname(fileName || '') || '').toLowerCase();
  if (['.pdf', '.docx', '.xlsx', '.csv', '.txt', '.md', '.markdown', '.html', '.htm', '.pptx'].includes(ext)) {
    return true;
  }
  return (
    mime.includes('application/pdf') ||
    mime.includes('wordprocessingml') ||
    mime.includes('spreadsheetml') ||
    mime.includes('application/vnd.ms-excel') ||
    mime.includes('text/csv') ||
    mime.includes('text/plain') ||
    mime.includes('text/markdown') ||
    mime.includes('text/html') ||
    mime.includes('presentationml')
  );
}

function markdownToBasicHtml(markdown: string, title: string): string {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const body: string[] = [];
  let inList = false;

  const flushList = () => {
    if (inList) {
      body.push('</ul>');
      inList = false;
    }
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) {
      flushList();
      body.push('<p></p>');
      continue;
    }

    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (/^###\s+/.test(line)) {
      flushList();
      body.push(`<h3>${escaped.replace(/^###\s+/, '')}</h3>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushList();
      body.push(`<h2>${escaped.replace(/^##\s+/, '')}</h2>`);
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushList();
      body.push(`<h1>${escaped.replace(/^#\s+/, '')}</h1>`);
      continue;
    }
    if (/^-\s+/.test(line)) {
      if (!inList) {
        body.push('<ul>');
        inList = true;
      }
      body.push(`<li>${escaped.replace(/^-\s+/, '')}</li>`);
      continue;
    }

    flushList();
    body.push(`<p>${escaped}</p>`);
  }

  flushList();

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/[<>]/g, '')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #121212; font-size: 12pt; line-height: 1.6; padding: 26px; }
    h1,h2,h3 { color: #0f172a; margin: 16px 0 8px; }
    p { margin: 8px 0; }
    ul { margin: 6px 0 10px 20px; }
    li { margin: 4px 0; }
  </style>
</head>
<body>
${body.join('\n')}
</body>
</html>`;
}

async function markdownToDocxBuffer(markdown: string): Promise<Buffer> {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const children: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      children.push(new Paragraph({ text: '' }));
      continue;
    }

    if (/^#\s+/.test(line)) {
      children.push(
        new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({ text: line.replace(/^#\s+/, ''), bold: true, size: 36 })],
        })
      );
      continue;
    }

    if (/^##\s+/.test(line)) {
      children.push(
        new Paragraph({
          spacing: { after: 180 },
          children: [new TextRun({ text: line.replace(/^##\s+/, ''), bold: true, size: 30 })],
        })
      );
      continue;
    }

    if (/^###\s+/.test(line)) {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [new TextRun({ text: line.replace(/^###\s+/, ''), bold: true, size: 26 })],
        })
      );
      continue;
    }

    if (/^-\s+/.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 120 },
          children: [new TextRun({ text: line.replace(/^-\s+/, '') })],
        })
      );
      continue;
    }

    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: line })],
      })
    );
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}

async function saveBuffer(input: {
  researchJobId: string;
  scope: 'uploads' | 'exports';
  fileName: string;
  buffer: Buffer;
}): Promise<{ storagePath: string; fileSizeBytes: number }> {
  const dir = path.join(STORAGE_ROOT, 'documents', input.researchJobId, input.scope);
  await fs.mkdir(dir, { recursive: true });

  const fileName = sanitizeFileName(input.fileName) || `${input.scope}-${Date.now()}`;
  const absPath = path.join(dir, fileName);
  await fs.writeFile(absPath, input.buffer);
  const stats = await fs.stat(absPath);

  return {
    storagePath: toStorageRelativePath(absPath),
    fileSizeBytes: stats.size,
  };
}

function buildChangeSummary(instruction: string): string {
  const trimmed = String(instruction || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Applied document edits';
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function buildQuotedTextRegex(value: string): RegExp | null {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  const tokens = compact
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return null;
  return new RegExp(tokens.join('\\s+'), 'i');
}

function parseQuotedEditInstruction(instruction: string): {
  quotedText?: string;
  replacementText?: string;
} {
  const prompt = String(instruction || '').trim();
  if (!prompt) return {};

  const patterns: RegExp[] = [
    /replace\s+[“"]([^”"]+)[”"]\s+with\s+[“"]([^”"]*)[”"]/i,
    /replace\s+'([^']+)'\s+with\s+'([^']*)'/i,
    /change\s+[“"]([^”"]+)[”"]\s+(?:to|into)\s+[“"]([^”"]*)[”"]/i,
    /change\s+'([^']+)'\s+(?:to|into)\s+'([^']*)'/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const quotedText = String(match[1] || '').trim();
    const replacementText = String(match[2] || '').trim();
    if (quotedText) {
      return {
        quotedText,
        replacementText,
      };
    }
  }

  const quotedParts = Array.from(
    prompt.matchAll(/[“"]([^”"]{2,320})[”"]|'([^']{2,320})'/g),
    (match) => String(match[1] || match[2] || '').trim()
  ).filter(Boolean);
  if (
    quotedParts.length >= 2 &&
    /\b(replace|change|rewrite|update|swap)\b/i.test(prompt)
  ) {
    return {
      quotedText: quotedParts[0],
      replacementText: quotedParts[1],
    };
  }

  if (quotedParts.length >= 1 && /\b(remove|delete)\b/i.test(prompt)) {
    return {
      quotedText: quotedParts[0],
      replacementText: '',
    };
  }

  if (
    quotedParts.length >= 1 &&
    /\b(edit|rewrite|update|change|replace|quote|quoted|around|section)\b/i.test(prompt)
  ) {
    return {
      quotedText: quotedParts[0],
    };
  }

  return {};
}

type ProposedContentMeta = {
  contentMd: string;
  anchor?: {
    quotedText: string;
    replacementText?: string;
    matched: boolean;
    matchType?: 'exact' | 'whitespace';
    matchCount?: number;
  };
};

function createProposedContent(
  current: string,
  instruction: string,
  options?: {
    quotedText?: string;
    replacementText?: string;
  }
): ProposedContentMeta {
  const text = String(current || '').trim();
  const prompt = String(instruction || '').trim();
  if (!prompt) return { contentMd: text };

  const parsed = parseQuotedEditInstruction(prompt);
  const quotedText = String(options?.quotedText || parsed.quotedText || '').trim();
  const replacementText =
    options?.replacementText !== undefined
      ? String(options.replacementText)
      : parsed.replacementText !== undefined
        ? String(parsed.replacementText)
        : undefined;

  if (quotedText) {
    const exactOccurrences = text.split(quotedText).length - 1;
    if (exactOccurrences > 0) {
      if (replacementText !== undefined) {
        return {
          contentMd: text.replace(quotedText, replacementText),
          anchor: {
            quotedText,
            replacementText,
            matched: true,
            matchType: 'exact',
            matchCount: exactOccurrences,
          },
        };
      }
      return {
        contentMd: text,
        anchor: {
          quotedText,
          replacementText,
          matched: true,
          matchType: 'exact',
          matchCount: exactOccurrences,
        },
      };
    }

    const quoteRegex = buildQuotedTextRegex(quotedText);
    if (quoteRegex) {
      const matched = quoteRegex.exec(text);
      if (matched?.[0]) {
        if (replacementText !== undefined) {
          return {
            contentMd: text.replace(quoteRegex, replacementText),
            anchor: {
              quotedText,
              replacementText,
              matched: true,
              matchType: 'whitespace',
              matchCount: 1,
            },
          };
        }
        return {
          contentMd: text,
          anchor: {
            quotedText,
            replacementText,
            matched: true,
            matchType: 'whitespace',
            matchCount: 1,
          },
        };
      }
    }

    return {
      contentMd: text,
      anchor: {
        quotedText,
        replacementText,
        matched: false,
      },
    };
  }

  const replaceMatch = prompt.match(/replace\s+"([^"]+)"\s+with\s+"([^"]+)"/i);
  if (replaceMatch) {
    const from = replaceMatch[1];
    const to = replaceMatch[2];
    if (from) {
      return { contentMd: text.split(from).join(to) };
    }
  }

  if (/\b(summarize|shorten|concise)\b/i.test(prompt)) {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const kept = lines.slice(0, Math.max(8, Math.ceil(lines.length * 0.45)));
    return {
      contentMd: [
        '# Concise Version',
        ...kept,
        '',
        '## Notes',
        '- This concise version was generated from the latest canonical draft.',
        `- Requested instruction: ${prompt}`,
      ].join('\n'),
    };
  }

  if (/\b(client version|client-friendly|board-ready|executive)\b/i.test(prompt)) {
    return {
      contentMd: [
        '# Client Version',
        text,
        '',
        '## Editorial Note',
        `- Adapted per request: ${prompt}`,
      ].join('\n'),
    };
  }

  return {
    contentMd: [
      text,
      '',
      '## Requested Edit Notes',
      `- ${prompt}`,
    ].join('\n'),
  };
}

export async function uploadRuntimeDocuments(input: {
  researchJobId: string;
  branchId: string;
  userId: string;
  files: RuntimeUploadFile[];
  title?: string;
  sourceKind?: SourceKind;
}) {
  const files = input.files || [];
  if (!files.length) {
    throw new Error('No files uploaded.');
  }
  if (files.length > MAX_FILES_PER_MESSAGE) {
    throw new Error(`You can upload up to ${MAX_FILES_PER_MESSAGE} files per message.`);
  }

  const workspace = await prisma.researchJob.findUnique({
    where: { id: input.researchJobId },
    select: { id: true, clientId: true },
  });
  if (!workspace || !workspace.clientId) {
    throw new Error('Workspace not found.');
  }

  const uploaded: UploadedWorkspaceDocument[] = [];

  for (const file of files) {
    if (!allowedMime(file.mimetype, file.originalname)) {
      throw new Error(`Unsupported file type: ${file.originalname}`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds 25MB limit: ${file.originalname}`);
    }

    const safeOriginal = sanitizeFileName(file.originalname) || `${Date.now()}-${randomUUID()}.bin`;
    const saved = await saveBuffer({
      researchJobId: input.researchJobId,
      scope: 'uploads',
      fileName: `${Date.now()}-${randomUUID()}-${safeOriginal}`,
      buffer: file.buffer,
    });

    const attachment = await createFileAttachment({
      researchJobId: input.researchJobId,
      fileName: file.originalname,
      storagePath: saved.storagePath,
      mimeType: file.mimetype || 'application/octet-stream',
      fileSizeBytes: file.size,
    });

    const titleBase = input.title?.trim() || stripExtension(file.originalname) || 'Uploaded document';

    const document = await prisma.workspaceDocument.create({
      data: {
        researchJobId: input.researchJobId,
        clientId: workspace.clientId,
        sourceKind: input.sourceKind || 'UPLOADED',
        sourceAttachmentId: attachment.id,
        title: titleBase,
        originalFileName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        storagePath: saved.storagePath,
        parserStatus: 'PENDING',
      },
    });

    const ingestion = await ingestWorkspaceDocument({
      researchJobId: input.researchJobId,
      branchId: input.branchId,
      documentId: document.id,
      fileName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      buffer: file.buffer,
      initiatedBy: input.userId,
    });

    const refreshed = await prisma.workspaceDocument.findUnique({
      where: { id: document.id },
      select: {
        id: true,
        title: true,
        originalFileName: true,
        mimeType: true,
        storagePath: true,
        parserStatus: true,
        parserQualityScore: true,
        latestVersionId: true,
      },
    });

    await prisma.chatBranchMessage.create({
      data: {
        branchId: input.branchId,
        role: 'ASSISTANT',
        content:
          ingestion.status === 'FAILED'
            ? `I uploaded **${file.originalname}**, but parsing failed. You can still reference the raw file or retry parsing.`
            : ingestion.status === 'NEEDS_REVIEW'
              ? `I uploaded **${file.originalname}** and created a draft, but parsing quality needs review before heavy edits.`
              : `Your document **${file.originalname}** is ready. I parsed it into a canonical draft and linked quick actions below.`,
        blocksJson: {
          type: ingestion.status === 'FAILED' ? 'document_parse_needs_review' : 'document_ready',
          documentId: document.id,
          versionId: refreshed?.latestVersionId || ingestion.versionId || null,
          title: refreshed?.title || titleBase,
          originalFileName: file.originalname,
          qualityScore: refreshed?.parserQualityScore || ingestion.qualityScore || null,
          parser: ingestion.parser,
          warnings: ingestion.warnings,
          chunkCount: ingestion.chunkCount || null,
          pagesParsed: ingestion.pagesParsed || null,
          pagesTotal: ingestion.pagesTotal || null,
          actions: [
            { label: 'Summarize', action: 'document.read', payload: { documentId: document.id } },
            {
              label: 'Generate client version',
              action: 'document.propose_edit',
              payload: { documentId: document.id, instruction: 'Create a client-friendly version' },
            },
            { label: 'Export PDF', action: 'document.export', payload: { documentId: document.id, format: 'PDF' } },
            { label: 'Export DOCX', action: 'document.export', payload: { documentId: document.id, format: 'DOCX' } },
          ],
        },
        clientVisible: true,
      },
    });

    uploaded.push({
      id: document.id,
      title: refreshed?.title || titleBase,
      originalFileName: refreshed?.originalFileName || file.originalname,
      mimeType: refreshed?.mimeType || file.mimetype,
      storagePath: refreshed?.storagePath || saved.storagePath,
      parserStatus: (refreshed?.parserStatus || 'PENDING') as UploadedWorkspaceDocument['parserStatus'],
      parserQualityScore: refreshed?.parserQualityScore || null,
      latestVersionId: refreshed?.latestVersionId || null,
      ingestionRunId: ingestion.ingestionRunId,
      warnings: ingestion.warnings,
      branchId: input.branchId,
      attachmentId: attachment.id,
    });
  }

  return { documents: uploaded };
}

export async function listRuntimeDocuments(input: {
  researchJobId: string;
  branchId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(120, Number(input.limit || 40)));
  const docs = await prisma.workspaceDocument.findMany({
    where: { researchJobId: input.researchJobId },
    include: {
      versions: {
        where: { branchId: input.branchId },
        orderBy: { versionNumber: 'desc' },
        take: 8,
      },
      exports: {
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
      ingestionRuns: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    parserStatus: doc.parserStatus,
    parserQualityScore: doc.parserQualityScore,
    latestVersionId: doc.latestVersionId,
    storagePath: doc.storagePath,
    storageHref: toStorageHref(doc.storagePath),
    versionCount: doc.versions.length,
    latestVersion: doc.versions[0]
      ? {
          id: doc.versions[0].id,
          versionNumber: doc.versions[0].versionNumber,
          changeSummary: doc.versions[0].changeSummary,
          createdAt: doc.versions[0].createdAt.toISOString(),
          createdBy: doc.versions[0].createdBy,
          contentMd: doc.versions[0].contentMd,
        }
      : null,
    exports: doc.exports.map((entry) => ({
      id: entry.id,
      format: entry.format,
      storagePath: entry.storagePath,
      storageHref: toStorageHref(entry.storagePath),
      mimeType: entry.mimeType,
      fileSizeBytes: entry.fileSizeBytes,
      createdAt: entry.createdAt.toISOString(),
    })),
    latestIngestion: doc.ingestionRuns[0]
      ? {
          id: doc.ingestionRuns[0].id,
          status: doc.ingestionRuns[0].status,
          parser: doc.ingestionRuns[0].parser,
          warnings: Array.isArray(doc.ingestionRuns[0].warningsJson) ? (doc.ingestionRuns[0].warningsJson as string[]) : [],
          createdAt: doc.ingestionRuns[0].createdAt.toISOString(),
        }
      : null,
  }));
}

export async function getRuntimeDocumentDetail(input: {
  researchJobId: string;
  branchId: string;
  documentId: string;
}) {
  const doc = await prisma.workspaceDocument.findFirst({
    where: {
      id: input.documentId,
      researchJobId: input.researchJobId,
    },
    include: {
      versions: {
        where: { branchId: input.branchId },
        orderBy: { versionNumber: 'desc' },
        take: 24,
      },
      exports: {
        orderBy: { createdAt: 'desc' },
        take: 24,
      },
      ingestionRuns: {
        orderBy: { createdAt: 'desc' },
        take: 6,
      },
    },
  });

  if (!doc) throw new Error('Document not found');

  return {
    id: doc.id,
    title: doc.title,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    parserStatus: doc.parserStatus,
    parserQualityScore: doc.parserQualityScore,
    latestVersionId: doc.latestVersionId,
    storagePath: doc.storagePath,
    storageHref: toStorageHref(doc.storagePath),
    versions: doc.versions.map((version) => ({
      id: version.id,
      branchId: version.branchId,
      versionNumber: version.versionNumber,
      contentMd: version.contentMd,
      changeSummary: version.changeSummary,
      patchJson: version.patchJson,
      createdBy: version.createdBy,
      createdAt: version.createdAt.toISOString(),
      runId: version.runId,
    })),
    exports: doc.exports.map((entry) => ({
      id: entry.id,
      format: entry.format,
      storagePath: entry.storagePath,
      storageHref: toStorageHref(entry.storagePath),
      mimeType: entry.mimeType,
      fileSizeBytes: entry.fileSizeBytes,
      createdAt: entry.createdAt.toISOString(),
      createdBy: entry.createdBy,
    })),
    ingestionRuns: doc.ingestionRuns.map((run) => ({
      id: run.id,
      status: run.status,
      parser: run.parser,
      warnings: Array.isArray(run.warningsJson) ? (run.warningsJson as string[]) : [],
      pagesTotal: run.pagesTotal,
      pagesParsed: run.pagesParsed,
      startedAt: run.startedAt?.toISOString() || null,
      endedAt: run.endedAt?.toISOString() || null,
      createdAt: run.createdAt.toISOString(),
    })),
  };
}

export async function proposeRuntimeDocumentEdit(input: {
  researchJobId: string;
  branchId: string;
  documentId: string;
  instruction: string;
  userId: string;
  quotedText?: string;
  replacementText?: string;
}) {
  const detail = await getRuntimeDocumentDetail({
    researchJobId: input.researchJobId,
    branchId: input.branchId,
    documentId: input.documentId,
  });

  const latest = detail.versions[0];
  if (!latest) throw new Error('No document version found to edit');

  const instruction = String(input.instruction || '').trim();
  if (!instruction) {
    throw new Error('instruction is required');
  }

  const proposal = createProposedContent(latest.contentMd, instruction, {
    ...(typeof input.quotedText === 'string' && input.quotedText.trim()
      ? { quotedText: input.quotedText.trim() }
      : {}),
    ...(typeof input.replacementText === 'string' ? { replacementText: input.replacementText } : {}),
  });
  const proposedContentMd = proposal.contentMd;
  const changed = proposedContentMd !== latest.contentMd;
  const changeSummary =
    proposal.anchor?.quotedText && proposal.anchor.matched
      ? `Updated quoted text: "${proposal.anchor.quotedText.slice(0, 100)}${proposal.anchor.quotedText.length > 100 ? '...' : ''}"`
      : buildChangeSummary(instruction);

  await emitWorkspaceDocumentRuntimeEvent({
    branchId: input.branchId,
    processType: ProcessEventType.PROCESS_LOG,
    eventName: 'document.edit_proposed',
    message: changed ? `Proposed edit for ${detail.title}.` : `No effective edit changes detected for ${detail.title}.`,
    payload: {
      documentId: detail.id,
      versionId: latest.id,
      instruction,
      changed,
      ...(proposal.anchor ? { anchor: proposal.anchor } : {}),
      mode: 'proposal',
    },
    toolName: 'document.propose_edit',
    level: changed ? ProcessEventLevel.INFO : ProcessEventLevel.WARN,
    status: changed ? 'info' : 'warn',
  });

  await prisma.chatBranchMessage.create({
    data: {
      branchId: input.branchId,
      role: 'ASSISTANT',
      content: changed
        ? `I prepared an edit proposal for **${detail.title}**. Review and apply when ready.`
        : `I reviewed **${detail.title}**, but the proposal produced no material changes.`,
      blocksJson: {
        type: 'document_edit_proposal',
        documentId: detail.id,
        baseVersionId: latest.id,
        baseVersionNumber: latest.versionNumber,
        instruction,
        proposedContentMd,
        changed,
        changeSummary,
        ...(proposal.anchor ? { anchor: proposal.anchor } : {}),
        preview: {
          beforeChars: latest.contentMd.length,
          afterChars: proposedContentMd.length,
        },
        actions: changed
          ? [
              {
                label: 'Apply edit',
                action: 'document.apply_edit',
                payload: {
                  documentId: detail.id,
                  proposedContentMd,
                  changeSummary,
                  baseVersionId: latest.id,
                },
              },
              {
                label: 'Export PDF',
                action: 'document.export',
                payload: { documentId: detail.id, format: 'PDF' },
              },
            ]
          : [
              {
                label: 'Try another edit',
                action: 'document.propose_edit',
                payload: { documentId: detail.id },
              },
            ],
      },
      clientVisible: true,
    },
  });

  return {
    documentId: detail.id,
    baseVersionId: latest.id,
    baseVersionNumber: latest.versionNumber,
    instruction,
    proposedContentMd,
    changed,
    changeSummary,
    ...(proposal.anchor ? { anchor: proposal.anchor } : {}),
    preview: {
      beforeChars: latest.contentMd.length,
      afterChars: proposedContentMd.length,
    },
  };
}

export async function applyRuntimeDocumentEdit(input: {
  researchJobId: string;
  branchId: string;
  documentId: string;
  userId: string;
  proposedContentMd: string;
  changeSummary?: string;
  baseVersionId?: string;
  runId?: string;
}) {
  const detail = await getRuntimeDocumentDetail({
    researchJobId: input.researchJobId,
    branchId: input.branchId,
    documentId: input.documentId,
  });

  const latest = detail.versions[0];
  if (!latest) throw new Error('No document version found to apply edits to');

  const contentMd = String(input.proposedContentMd || '').trim();
  if (!contentMd) throw new Error('proposedContentMd is required');

  const nextVersionNumber = latest.versionNumber + 1;
  const changeSummary = String(input.changeSummary || '').trim() || 'Applied chat document edit';
  const chunks = buildDocumentChunks({
    markdown: contentMd,
    sectionMap: [{ headingPath: 'Document', startOffset: 0, endOffset: contentMd.length }],
  });

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.workspaceDocumentVersion.create({
      data: {
        documentId: detail.id,
        branchId: input.branchId,
        versionNumber: nextVersionNumber,
        contentMd,
        changeSummary,
        patchJson: {
          baseVersionId: input.baseVersionId || latest.id,
          baseVersionNumber: latest.versionNumber,
          instructionSummary: changeSummary,
        },
        createdBy: input.userId,
        runId: input.runId || null,
      },
    });

    if (chunks.length > 0) {
      await tx.workspaceDocumentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId: detail.id,
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
      where: { id: detail.id },
      data: {
        latestVersionId: created.id,
        parserStatus: 'READY',
      },
    });

    return created;
  });

  await emitWorkspaceDocumentRuntimeEvent({
    branchId: input.branchId,
    processType: ProcessEventType.PROCESS_RESULT,
    eventName: 'document.edit_applied',
    message: `Applied document edit and created version ${nextVersionNumber}.`,
    payload: {
      documentId: detail.id,
      versionId: version.id,
      versionNumber: nextVersionNumber,
      chunkCount: chunks.length,
      baseVersionId: input.baseVersionId || latest.id,
    },
    toolName: 'document.apply_edit',
  });

  await prisma.chatBranchMessage.create({
    data: {
      branchId: input.branchId,
      role: 'ASSISTANT',
      content: `Applied your edit to **${detail.title}** and created version ${nextVersionNumber}.`,
      blocksJson: {
        type: 'document_edit_applied',
        documentId: detail.id,
        versionId: version.id,
        versionNumber: nextVersionNumber,
        changeSummary,
        actions: [
          { label: 'Continue editing', action: 'document.propose_edit', payload: { documentId: detail.id } },
          { label: 'Export PDF', action: 'document.export', payload: { documentId: detail.id, format: 'PDF' } },
          { label: 'Export DOCX', action: 'document.export', payload: { documentId: detail.id, format: 'DOCX' } },
        ],
      },
      clientVisible: true,
    },
  });

  return {
    documentId: detail.id,
    versionId: version.id,
    versionNumber: nextVersionNumber,
    changeSummary,
  };
}

function extensionForFormat(format: WorkspaceDocumentExportFormat): string {
  if (format === WorkspaceDocumentExportFormat.PDF) return 'pdf';
  if (format === WorkspaceDocumentExportFormat.DOCX) return 'docx';
  return 'md';
}

function mimeTypeForFormat(format: WorkspaceDocumentExportFormat): string {
  if (format === WorkspaceDocumentExportFormat.PDF) return 'application/pdf';
  if (format === WorkspaceDocumentExportFormat.DOCX) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'text/markdown';
}

export async function exportRuntimeDocumentVersion(input: {
  researchJobId: string;
  branchId: string;
  documentId: string;
  format: 'PDF' | 'DOCX' | 'MD';
  versionId?: string;
  userId: string;
}) {
  const detail = await getRuntimeDocumentDetail({
    researchJobId: input.researchJobId,
    branchId: input.branchId,
    documentId: input.documentId,
  });

  const format = String(input.format || 'PDF').toUpperCase() as WorkspaceDocumentExportFormat;
  if (![WorkspaceDocumentExportFormat.PDF, WorkspaceDocumentExportFormat.DOCX, WorkspaceDocumentExportFormat.MD].includes(format)) {
    throw new Error('format must be one of PDF, DOCX, MD');
  }

  const version =
    (input.versionId
      ? detail.versions.find((entry) => entry.id === input.versionId)
      : detail.versions[0]) || detail.versions[0];

  if (!version) {
    throw new Error('No version available for export');
  }

  await emitWorkspaceDocumentRuntimeEvent({
    branchId: input.branchId,
    processType: ProcessEventType.PROCESS_PROGRESS,
    eventName: 'document.export_started',
    message: `Exporting ${detail.title} as ${format}.`,
    payload: {
      documentId: detail.id,
      versionId: version.id,
      format,
    },
    toolName: 'document.export',
  });

  const ext = extensionForFormat(format);
  const safeTitle = sanitizeFileName(detail.title) || 'document';
  const fileName = `${safeTitle}-${version.versionNumber}-${Date.now()}.${ext}`;

  let buffer: Buffer;
  if (format === WorkspaceDocumentExportFormat.MD) {
    buffer = Buffer.from(version.contentMd, 'utf8');
  } else if (format === WorkspaceDocumentExportFormat.DOCX) {
    buffer = await markdownToDocxBuffer(version.contentMd);
  } else {
    const html = markdownToBasicHtml(version.contentMd, detail.title);
    buffer = await renderPdfFromHtml(html);
  }

  const stored = await saveBuffer({
    researchJobId: input.researchJobId,
    scope: 'exports',
    fileName,
    buffer,
  });

  const workspace = await prisma.researchJob.findUnique({
    where: { id: input.researchJobId },
    select: { clientId: true },
  });

  const mimeType = mimeTypeForFormat(format);
  const exportRow = await prisma.workspaceDocumentExport.create({
    data: {
      documentId: detail.id,
      documentVersionId: version.id,
      format,
      storagePath: stored.storagePath,
      mimeType,
      fileSizeBytes: stored.fileSizeBytes,
      createdBy: input.userId,
    },
  });

  if (workspace?.clientId) {
    await prisma.clientDocument.create({
      data: {
        clientId: workspace.clientId,
        docType: 'OTHER',
        fileName,
        filePath: stored.storagePath,
        mimeType,
        fileSizeBytes: stored.fileSizeBytes,
        extractedText: format === WorkspaceDocumentExportFormat.MD ? version.contentMd : null,
        isProcessed: true,
      },
    });
  }

  await createFileAttachment({
    researchJobId: input.researchJobId,
    fileName,
    storagePath: stored.storagePath,
    mimeType,
    fileSizeBytes: stored.fileSizeBytes,
  });

  await emitWorkspaceDocumentRuntimeEvent({
    branchId: input.branchId,
    processType: ProcessEventType.PROCESS_RESULT,
    eventName: 'document.export_completed',
    message: `Exported ${detail.title} as ${format}.`,
    payload: {
      documentId: detail.id,
      versionId: version.id,
      exportId: exportRow.id,
      format,
      storagePath: stored.storagePath,
      storageHref: toStorageHref(stored.storagePath),
      fileSizeBytes: stored.fileSizeBytes,
    },
    toolName: 'document.export',
  });

  await prisma.chatBranchMessage.create({
    data: {
      branchId: input.branchId,
      role: 'ASSISTANT',
      content: `Export complete for **${detail.title}** (${format}).`,
      blocksJson: {
        type: 'document_export_result',
        documentId: detail.id,
        versionId: version.id,
        exportId: exportRow.id,
        format,
        fileSizeBytes: stored.fileSizeBytes,
        downloadHref: toStorageHref(stored.storagePath),
      },
      clientVisible: true,
    },
  });

  return {
    exportId: exportRow.id,
    documentId: detail.id,
    versionId: version.id,
    format,
    mimeType,
    storagePath: stored.storagePath,
    downloadHref: toStorageHref(stored.storagePath),
    fileSizeBytes: stored.fileSizeBytes,
    createdAt: exportRow.createdAt.toISOString(),
  };
}

export async function searchRuntimeDocument(input: {
  researchJobId: string;
  documentId: string;
  query: string;
  limit?: number;
}) {
  const query = String(input.query || '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  const doc = await prisma.workspaceDocument.findFirst({
    where: { id: input.documentId, researchJobId: input.researchJobId },
    select: { id: true, latestVersionId: true, title: true },
  });
  if (!doc || !doc.latestVersionId) throw new Error('Document not found');

  const chunks = await prisma.workspaceDocumentChunk.findMany({
    where: {
      documentId: doc.id,
      documentVersionId: doc.latestVersionId,
    },
    orderBy: { chunkIndex: 'asc' },
    take: 600,
  });

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .slice(0, 8);

  const scored = chunks
    .map((chunk) => {
      const hay = `${chunk.headingPath || ''}\n${chunk.text}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const count = hay.split(term).length - 1;
        score += count;
      }
      return { chunk, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, Math.max(1, Math.min(30, Number(input.limit || 8))));

  return {
    documentId: doc.id,
    title: doc.title,
    query,
    hits: scored.map((entry) => ({
      chunkIndex: entry.chunk.chunkIndex,
      headingPath: entry.chunk.headingPath,
      text: entry.chunk.text,
      score: entry.score,
      tokenCount: entry.chunk.tokenCount,
    })),
  };
}

export async function compareRuntimeDocumentVersions(input: {
  researchJobId: string;
  branchId: string;
  documentId: string;
  fromVersionId: string;
  toVersionId: string;
}) {
  const detail = await getRuntimeDocumentDetail({
    researchJobId: input.researchJobId,
    branchId: input.branchId,
    documentId: input.documentId,
  });

  const from = detail.versions.find((entry) => entry.id === input.fromVersionId);
  const to = detail.versions.find((entry) => entry.id === input.toVersionId);

  if (!from || !to) throw new Error('Both versions must exist on this branch');

  const fromLines = from.contentMd.split('\n');
  const toLines = to.contentMd.split('\n');
  const added = toLines.filter((line) => !fromLines.includes(line)).slice(0, 30);
  const removed = fromLines.filter((line) => !toLines.includes(line)).slice(0, 30);

  return {
    documentId: detail.id,
    fromVersion: { id: from.id, versionNumber: from.versionNumber },
    toVersion: { id: to.id, versionNumber: to.versionNumber },
    summary: {
      fromChars: from.contentMd.length,
      toChars: to.contentMd.length,
      addedLines: added.length,
      removedLines: removed.length,
    },
    added,
    removed,
  };
}

export function normalizeDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

export async function buildDocumentGroundingHint(input: {
  researchJobId: string;
  documentIds: string[];
}): Promise<string> {
  const ids = normalizeDocumentIds(input.documentIds);
  if (!ids.length) return '';

  const docs = await prisma.workspaceDocument.findMany({
    where: {
      researchJobId: input.researchJobId,
      id: { in: ids },
    },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
    take: 8,
  });

  if (!docs.length) return '';

  const lines: string[] = ['Document context from attached workspace docs:'];
  for (const [index, doc] of docs.entries()) {
    const latest = doc.versions[0];
    const snippet = String(latest?.contentMd || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 340);
    lines.push(
      `${index + 1}. [document:${doc.id}] ${doc.title} (${doc.originalFileName})${latest ? ` v${latest.versionNumber}` : ''}${snippet ? ` -> ${snippet}` : ''}`
    );
  }

  return lines.join('\n');
}

export async function resolveAttachmentDocumentIds(input: {
  researchJobId: string;
  attachmentIds: string[];
}): Promise<string[]> {
  const attachmentIds = input.attachmentIds.filter(Boolean).slice(0, 20);
  if (!attachmentIds.length) return [];

  const docs = await prisma.workspaceDocument.findMany({
    where: {
      researchJobId: input.researchJobId,
      sourceAttachmentId: { in: attachmentIds },
    },
    select: { id: true },
    take: 20,
  });

  return docs.map((doc) => doc.id);
}

export async function readRuntimeDocument(input: {
  researchJobId: string;
  documentId: string;
  versionId?: string;
}) {
  const doc = await prisma.workspaceDocument.findFirst({
    where: { id: input.documentId, researchJobId: input.researchJobId },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 16,
      },
    },
  });

  if (!doc) throw new Error('Document not found');

  const selected =
    (input.versionId
      ? doc.versions.find((entry) => entry.id === input.versionId)
      : doc.versions[0]) || doc.versions[0];

  if (!selected) {
    throw new Error('No version available for this document');
  }

  return {
    documentId: doc.id,
    title: doc.title,
    versionId: selected.id,
    versionNumber: selected.versionNumber,
    contentMd: selected.contentMd,
    changeSummary: selected.changeSummary,
  };
}

export async function hydrateDocumentIdsFromMessageInput(input: {
  researchJobId: string;
  documentIds?: unknown;
  attachmentIds?: unknown;
}) {
  const fromMessage = normalizeDocumentIds(input.documentIds);
  const attachmentIds = normalizeDocumentIds(input.attachmentIds);
  const derived = await resolveAttachmentDocumentIds({
    researchJobId: input.researchJobId,
    attachmentIds,
  });

  return Array.from(new Set([...fromMessage, ...derived])).slice(0, 20);
}

export async function ensureDocumentBelongsToWorkspace(input: {
  researchJobId: string;
  documentId: string;
}) {
  const exists = await prisma.workspaceDocument.findFirst({
    where: { id: input.documentId, researchJobId: input.researchJobId },
    select: { id: true },
  });
  if (!exists) throw new Error('Document not found in workspace');
}

export function maxUploadBytes() {
  return MAX_FILE_SIZE_BYTES;
}

export function maxUploadFiles() {
  return MAX_FILES_PER_MESSAGE;
}

export function storageHrefFromPath(storagePath: string) {
  return toStorageHref(storagePath);
}

export async function loadDocumentBinary(storagePath: string): Promise<Buffer> {
  const absPath = ensureAbsolutePathForStorage(storagePath);
  return fs.readFile(absPath);
}
