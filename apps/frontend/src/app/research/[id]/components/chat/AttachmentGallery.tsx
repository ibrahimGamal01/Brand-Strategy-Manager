import { useEffect, useRef } from 'react';
import Image from 'next/image';
import type { ChatAttachment } from './types';

type AttachmentGalleryProps = {
  attachments?: ChatAttachment[] | null;
  onView?: (attachment: ChatAttachment) => void;
};

export function AttachmentGallery({ attachments, onView }: AttachmentGalleryProps) {
  const viewedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!attachments || !onView) return;
    attachments.forEach((att) => {
      if (!att?.id || viewedRef.current.has(att.id)) return;
      viewedRef.current.add(att.id);
      onView(att);
    });
  }, [attachments, onView]);

  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att) => (
        <figure
          key={att.id}
          className="w-24 overflow-hidden rounded-lg border border-border/60 bg-background/70 shadow-sm"
        >
          <div className="relative h-16 w-full bg-muted/60">
            {att.storagePath ? (
              <Image
                src={`/${att.storagePath}`}
                alt={att.aiSummary || 'attachment'}
                fill
                sizes="96px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                pending
              </div>
            )}
          </div>
          <figcaption className="px-2 py-1 text-[10px] leading-tight text-muted-foreground truncate">
            {att.aiSummary || att.recordType || 'attachment'}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
