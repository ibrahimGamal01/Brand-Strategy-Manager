import { Router } from 'express';
import {
  generateDocumentForResearchJob,
  getGeneratedDocumentById,
  listGeneratedDocuments,
} from '../services/documents/document-service';
import type { DocumentPlan } from '../services/documents/document-spec';
import { createFileAttachment } from '../services/chat/file-attachments';
import { PdfRendererUnavailableError } from '../services/documents/pdf-renderer';

const router = Router();

router.post('/:id/documents/generate', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const body = (req.body || {}) as Partial<DocumentPlan> & { attachToChat?: boolean };
    const result = await generateDocumentForResearchJob(researchJobId, body);
    const shouldCreateAttachment = body.attachToChat !== false;
    let attachmentId: string | null = null;

    if (shouldCreateAttachment) {
      const attachment = await createFileAttachment({
        researchJobId,
        fileName: result.title ? `${result.title}.pdf` : 'document.pdf',
        storagePath: result.storagePath,
        mimeType: result.mimeType,
        fileSizeBytes: result.sizeBytes,
      });
      attachmentId = attachment.id;
    }

    return res.json({ ok: true, document: result, attachmentId });
  } catch (error: any) {
    console.error('[Documents] Failed to generate document:', error);
    if (error instanceof PdfRendererUnavailableError) {
      return res.status(503).json({
        error: 'PDF generation is temporarily unavailable',
        details: error.message,
      });
    }
    return res.status(500).json({ error: 'Failed to generate document', details: error.message });
  }
});

router.get('/:id/documents', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const documents = await listGeneratedDocuments(researchJobId);
    return res.json({
      documents: documents.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        filePath: doc.filePath,
        mimeType: doc.mimeType,
        fileSizeBytes: doc.fileSizeBytes,
        uploadedAt: doc.uploadedAt,
      })),
    });
  } catch (error: any) {
    console.error('[Documents] Failed to list documents:', error);
    return res.status(500).json({ error: 'Failed to list documents', details: error.message });
  }
});

router.get('/:id/documents/:docId', async (req, res) => {
  try {
    const { id: researchJobId, docId } = req.params;
    const document = await getGeneratedDocumentById(researchJobId, docId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    return res.json({
      document: {
        id: document.id,
        fileName: document.fileName,
        filePath: document.filePath,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
        uploadedAt: document.uploadedAt,
      },
    });
  } catch (error: any) {
    console.error('[Documents] Failed to fetch document:', error);
    return res.status(500).json({ error: 'Failed to fetch document', details: error.message });
  }
});

export default router;
