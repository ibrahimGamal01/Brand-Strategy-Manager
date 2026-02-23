import { prisma } from '../../lib/prisma';

export async function createFileAttachment(params: {
  researchJobId: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  fileSizeBytes?: number | null;
  chatMessageId?: string | null;
}) {
  return prisma.fileAttachment.create({
    data: {
      researchJobId: params.researchJobId,
      chatMessageId: params.chatMessageId ?? null,
      fileName: params.fileName,
      storagePath: params.storagePath,
      mimeType: params.mimeType,
      fileSizeBytes: params.fileSizeBytes ?? null,
    },
  });
}

export async function attachFileAttachmentsToMessage(messageId: string, attachmentIds: string[]): Promise<void> {
  if (!attachmentIds.length) return;
  await prisma.fileAttachment.updateMany({
    where: {
      id: { in: attachmentIds },
    },
    data: {
      chatMessageId: messageId,
    },
  });
}
