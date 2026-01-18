import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { fileManager } from '../services/storage/file-manager';

const router = Router();

/**
 * GET /api/media/post/:postId
 * Get all media assets for a specific post
 */
router.get('/post/:postId', async (req: Request, res: Response) => {
  try {
    const { postId } = req.params;

    const mediaAssets = await prisma.mediaAsset.findMany({
      where: {
        OR: [
          { clientPostId: postId },
          { cleanedPostId: postId },
        ],
      },
    });

    // Convert storage paths to URLs
    const mediaWithUrls = mediaAssets.map(asset => ({
      ...asset,
      url: fileManager.toUrl(asset.blobStoragePath || ''),
      thumbnailUrl: asset.thumbnailPath ? fileManager.toUrl(asset.thumbnailPath) : null,
    }));

    res.json(mediaWithUrls);
  } catch (error: any) {
    console.error('[Media API] Error fetching media:', error);
    res.status(500).json({ error: 'Failed to fetch media', details: error.message });
  }
});

/**
 * GET /api/media/:mediaId
 * Get single media asset metadata
 */
router.get('/:mediaId', async (req: Request, res: Response) => {
  try {
    const media = await prisma.mediaAsset.findUnique({
      where: { id: req.params.mediaId },
    });

    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    res.json({
      ...media,
      url: fileManager.toUrl(media.blobStoragePath || ''),
      thumbnailUrl: media.thumbnailPath ? fileManager.toUrl(media.thumbnailPath) : null,
    });
  } catch (error: any) {
    console.error('[Media API] Error fetching media:', error);
    res.status(500).json({ error: 'Failed to fetch media', details: error.message });
  }
});

export default router;
