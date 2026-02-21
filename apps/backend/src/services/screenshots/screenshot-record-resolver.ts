import { prisma } from '../../lib/prisma';

export type ResolvedRecordContext = {
  recordType: string;
  recordId: string;
  summary: string;
  data: Record<string, unknown>;
};

export async function resolveRecordContext(
  recordType?: string | null,
  recordId?: string | null
): Promise<ResolvedRecordContext | null> {
  if (!recordType || !recordId) return null;
  const type = recordType.trim().toLowerCase();
  switch (type) {
    case 'social_post': {
      const post = await prisma.socialPost.findUnique({ where: { id: recordId } });
      if (!post) return null;
      const profile = await prisma.socialProfile.findUnique({
        where: { id: post.socialProfileId },
        select: { platform: true, handle: true },
      });
      const summary = `${profile?.platform || 'social'} post by ${profile?.handle || 'unknown'} · ${post.likesCount ?? 0} likes`;
      return { recordType: type, recordId, summary, data: { ...post, platform: profile?.platform, platformHandle: profile?.handle } as any };
    }
    case 'client_post': {
      const post = await prisma.clientPost.findUnique({ where: { id: recordId } });
      if (!post) return null;
      const summary = `Client post · ${post.likes ?? 0} likes`;
      return { recordType: type, recordId, summary, data: post as any };
    }
    case 'competitor': {
      const competitor = await prisma.discoveredCompetitor.findUnique({ where: { id: recordId } });
      if (!competitor) return null;
      const summary = `Competitor @${competitor.handle ?? ''} (${competitor.platform ?? ''})`;
      return { recordType: type, recordId, summary, data: competitor as any };
    }
    case 'calendar_slot': {
      const slot = await prisma.calendarSlot.findUnique({ where: { id: recordId } });
      if (!slot) return null;
      const summary = `Calendar slot ${slot.platform ?? ''} · ${slot.theme ?? slot.contentType ?? ''}`;
      return { recordType: type, recordId, summary, data: slot as any };
    }
    case 'media_asset': {
      const asset = await prisma.mediaAsset.findUnique({ where: { id: recordId } });
      if (!asset) return null;
      const summary = `Media asset ${asset.mediaType ?? ''}`;
      return { recordType: type, recordId, summary, data: asset as any };
    }
    default:
      return null;
  }
}
