'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/api/http';

export type AttachmentChip = {
  id: string;
  label: string;
  status: 'uploading' | 'ready' | 'error';
  storagePath?: string;
  aiSummary?: string | null;
  recordType?: string | null;
  recordId?: string | null;
};

function parseBatRecord(payload?: string | null): { recordType?: string; recordId?: string } {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload);
    return { recordType: parsed.recordType, recordId: parsed.recordId };
  } catch {
    return {};
  }
}

export function useScreenshotPaste(researchJobId: string) {
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const items = event.clipboardData.items;
      const imageItem = Array.from(items).find((i) => i.type.startsWith('image/'));
      if (!imageItem) return;
      event.preventDefault();

      const recordMetaItem = Array.from(items).find((i) => i.type === 'application/x-bat-record');
      let recordMeta: { recordType?: string; recordId?: string } = {};
      if (recordMetaItem) {
        const text = await new Promise<string>((resolve) => {
          recordMetaItem.getAsString((s) => resolve(s));
        });
        recordMeta = parseBatRecord(text);
      }

      const file = imageItem.getAsFile();
      if (!file) return;

      const tempId = `pending-${Date.now()}`;
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          label: 'Uploading screenshot…',
          status: 'uploading',
        },
      ]);

      try {
        const form = new FormData();
        form.append('image', file);
        if (recordMeta.recordType) form.append('recordType', recordMeta.recordType);
        if (recordMeta.recordId) form.append('recordId', recordMeta.recordId);

        const resp = await apiFetch<{ screenshot: any }>(`/research-jobs/${researchJobId}/screenshots`, {
          method: 'POST',
          body: form as any,
        });

        const chip: AttachmentChip = {
          id: resp.screenshot.screenshotId,
          label: resp.screenshot.aiSummary || 'Screenshot attached',
          status: 'ready',
          storagePath: resp.screenshot.storagePath,
          aiSummary: resp.screenshot.aiSummary,
          recordType: resp.screenshot.recordContext?.recordType || recordMeta.recordType,
          recordId: resp.screenshot.recordContext?.recordId || recordMeta.recordId,
        };
        setAttachments((prev) => prev.map((a) => (a.id === tempId ? chip : a)));
      } catch (error: any) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? { ...a, status: 'error', label: error?.message || 'Upload failed' }
              : a
          )
        );
      }
    },
    [researchJobId]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  return { attachments, handlePaste, removeAttachment, clearAttachments, setAttachments };
}
