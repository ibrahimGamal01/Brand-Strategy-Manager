import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { fileManager } from '../services/storage/file-manager';
import { analyzeMediaAsset } from '../services/ai/media-content-analyzer';
import { isOpenAiConfiguredForRealMode } from '../lib/runtime-preflight';

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
 * POST /api/media/:mediaId/analyze
 * Run OpenAI content analysis on a single media asset.
 */
router.post('/:mediaId/analyze', async (req: Request, res: Response) => {
  try {
    const { mediaId } = req.params;
    if (!isOpenAiConfiguredForRealMode()) {
      return res.status(400).json({
        error: 'OpenAI not configured',
        message: 'OPENAI_API_KEY is required to run media analysis.',
      });
    }
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      include: {
        socialPost: { select: { socialProfile: { select: { researchJobId: true } } } },
        clientPostSnapshot: { select: { clientProfileSnapshot: { select: { researchJobId: true } } } },
        competitorPostSnapshot: { select: { competitorProfileSnapshot: { select: { researchJobId: true } } } },
      },
    });
    if (!asset) {
      return res.status(404).json({ error: 'Media not found' });
    }
    if (!asset.isDownloaded || !asset.blobStoragePath) {
      return res.status(400).json({ error: 'Media not downloaded or no file path' });
    }
    const researchJobId =
      asset.socialPost?.socialProfile?.researchJobId ??
      asset.clientPostSnapshot?.clientProfileSnapshot?.researchJobId ??
      asset.competitorPostSnapshot?.competitorProfileSnapshot?.researchJobId ??
      null;
    const result = await analyzeMediaAsset({
      id: asset.id,
      mediaType: asset.mediaType,
      blobStoragePath: asset.blobStoragePath,
      socialPostId: asset.socialPostId,
      clientPostId: asset.clientPostId,
      cleanedPostId: asset.cleanedPostId,
      researchJobId,
    });
    if (!result.success) {
      return res.status(422).json({
        success: false,
        error: result.error,
        mediaAssetId: asset.id,
      });
    }
    return res.json({
      success: true,
      mediaAssetId: asset.id,
      analysisVisual: result.analysisVisual,
      analysisTranscript: result.analysisTranscript,
      analysisOverall: result.analysisOverall,
    });
  } catch (error: any) {
    console.error('[Media API] Analyze error:', error);
    res.status(500).json({ error: 'Analyze failed', message: error.message || 'Unknown error' });
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
