import { prisma } from '../../lib/prisma';

export async function attachScreenshotsToMessage(messageId: string, attachmentIds: string[]) {
  if (!attachmentIds?.length) return;
  await prisma.screenshotAttachment.updateMany({
    where: { id: { in: attachmentIds } },
    data: { chatMessageId: messageId },
  });
}
