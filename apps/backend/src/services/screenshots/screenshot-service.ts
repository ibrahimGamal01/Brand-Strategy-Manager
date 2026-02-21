import { saveScreenshotBuffer } from './screenshot-storage';
import { resolveRecordContext, ResolvedRecordContext } from './screenshot-record-resolver';
import { runScreenshotOcr } from './screenshot-ocr';
import { prisma } from '../../lib/prisma';

export type ScreenshotProcessResult = {
  screenshotId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  isAppScreenshot: boolean;
  recordContext?: ResolvedRecordContext | null;
  ocrText?: string | null;
  aiSummary?: string | null;
};

export async function processScreenshot(params: {
  researchJobId: string;
  buffer: Buffer;
  mimeType: string;
  recordType?: string | null;
  recordId?: string | null;
  chatMessageId?: string | null;
}): Promise<ScreenshotProcessResult> {
  const saved = await saveScreenshotBuffer(params.researchJobId, params.buffer, params.mimeType);

  const recordContext = await resolveRecordContext(params.recordType, params.recordId);
  const isAppScreenshot = Boolean(recordContext);
  const ocr = recordContext ? { aiSummary: null, ocrText: null } : await runScreenshotOcr(saved.absPath);

  await prisma.screenshotAttachment.create({
    data: {
      id: saved.id,
      researchJobId: params.researchJobId,
      chatMessageId: params.chatMessageId ?? null,
      storagePath: saved.storagePath,
      mimeType: saved.mimeType,
      fileSizeBytes: saved.sizeBytes,
      isAppScreenshot,
      recordType: params.recordType ?? null,
      recordId: params.recordId ?? null,
      ocrText: ocr.ocrText,
      aiSummary: ocr.aiSummary || recordContext?.summary || null,
    },
  });

  return {
    screenshotId: saved.id,
    storagePath: saved.storagePath,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    isAppScreenshot,
    recordContext,
    ocrText: ocr.ocrText,
    aiSummary: ocr.aiSummary || recordContext?.summary || null,
  };
}
