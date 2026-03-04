import { prisma } from '../../lib/prisma';

export async function reserveSlackEventReceipt(input: {
  slackTeamId: string;
  eventId: string;
  eventType: string;
  payload?: Record<string, unknown> | null;
}): Promise<boolean> {
  try {
    await prisma.slackEventReceipt.create({
      data: {
        slackTeamId: input.slackTeamId,
        eventId: input.eventId,
        eventType: input.eventType,
        payloadJson: (input.payload || null) as any,
      },
    });
    return true;
  } catch (error: any) {
    if (String(error?.code || '') === 'P2002') {
      return false;
    }
    throw error;
  }
}
