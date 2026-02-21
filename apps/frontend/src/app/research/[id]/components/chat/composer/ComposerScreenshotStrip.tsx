'use client';

import Image from 'next/image';
import { X } from 'lucide-react';
import { AttachmentChip } from './useScreenshotPaste';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function ComposerScreenshotStrip({ attachments, onRemove }: { attachments: AttachmentChip[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-2 rounded-md border border-border/60 bg-background/70 px-2 py-1 shadow-sm"
        >
          {att.storagePath ? (
            <div className="relative h-10 w-10 overflow-hidden rounded">
              <Image
                src={`/${att.storagePath}`}
                alt={att.label}
                fill
                className="object-cover"
                sizes="40px"
              />
            </div>
          ) : (
            <Badge variant="outline" className="text-[10px] uppercase">
              img
            </Badge>
          )}
          <div className="text-xs leading-tight max-w-[180px]">
            <div className="truncate font-semibold">{att.label}</div>
            <div className="text-[10px] text-muted-foreground">
              {att.status === 'uploading' ? 'Uploading…' : att.status === 'error' ? 'Error' : 'Ready'}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onRemove(att.id)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
