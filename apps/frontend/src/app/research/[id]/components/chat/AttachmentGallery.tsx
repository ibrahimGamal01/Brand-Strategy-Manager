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

  const resolveHref = (storagePath: string | null | undefined): string | null => {
    if (!storagePath) return null;
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath;
    return storagePath.startsWith('/') ? storagePath : `/${storagePath}`;
  };

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att) => {
        const href = resolveHref(att.storagePath);
        const label = att.fileName || att.aiSummary || att.recordType || 'attachment';
        return (
          <figure
            key={att.id}
            className="w-24 overflow-hidden rounded-lg border border-border/60 bg-background/70 shadow-sm"
          >
            {String(att.mimeType || '').toLowerCase().includes('pdf') ? (
              <div className="flex h-16 w-full items-center justify-center bg-muted/60 px-2 text-center text-[10px] font-medium text-foreground/80">
                PDF
              </div>
            ) : (
              <div className="relative h-16 w-full bg-muted/60">
                {href ? (
                  <Image
                    src={href}
                    alt={label}
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
            )}
            <figcaption className="px-2 py-1 text-[10px] leading-tight text-muted-foreground">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate hover:text-foreground"
                >
                  {label}
                </a>
              ) : (
                <span className="block truncate">{label}</span>
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
