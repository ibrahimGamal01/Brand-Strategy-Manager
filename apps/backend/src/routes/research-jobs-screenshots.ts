import { Router } from 'express';
import multer from 'multer';
import { processScreenshot } from '../services/screenshots/screenshot-service';

const upload = multer();
const router = Router();

router.post('/:id/screenshots', upload.single('image'), async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Missing image file' });
    }
    const recordType = typeof req.body?.recordType === 'string' ? req.body.recordType : undefined;
    const recordId = typeof req.body?.recordId === 'string' ? req.body.recordId : undefined;

    const result = await processScreenshot({
      researchJobId,
      buffer: file.buffer,
      mimeType: file.mimetype || 'image/png',
      recordType,
      recordId,
    });

    return res.json({ screenshot: result });
  } catch (error: any) {
    console.error('[Screenshots] Failed to process screenshot:', error);
    return res.status(500).json({ error: 'Failed to process screenshot', details: error.message });
  }
});

export default router;
