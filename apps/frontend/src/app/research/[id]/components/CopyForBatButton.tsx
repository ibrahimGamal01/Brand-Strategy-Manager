'use client';

import { useCallback, useMemo, useState } from 'react';
import { Clipboard } from 'lucide-react';
import { toPng } from 'html-to-image';

type CopyForBatButtonProps = {
  recordType: string;
  recordId: string;
  getNode: () => HTMLElement | null;
  size?: 'sm' | 'md';
};

export function CopyForBatButton({ recordType, recordId, getNode, size = 'sm' }: CopyForBatButtonProps) {
  const [copied, setCopied] = useState(false);
  const label = useMemo(() => (copied ? 'Copied' : 'Copy for BAT'), [copied]);

  const handleCopy = useCallback(async () => {
    const metaBlob = new Blob([JSON.stringify({ recordType, recordId })], {
      type: 'application/x-bat-record',
    });

    const node = getNode();
    const items: Record<string, Blob> = { 'application/x-bat-record': metaBlob };

    try {
      if (node) {
        const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 1.5 });
        const res = await fetch(dataUrl);
        const imageBlob = await res.blob();
        items['image/png'] = imageBlob;
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem(items)]);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(JSON.stringify({ recordType, recordId }));
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(JSON.stringify({ recordType, recordId }));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    }
  }, [getNode, recordId, recordType]);

  const base =
    'inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-1 text-[10px] font-semibold text-foreground transition hover:bg-muted';

  const sizeClass = size === 'md' ? 'px-3 py-1.5 text-xs' : '';

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${base} ${sizeClass}`}
      title="Copy screenshot + metadata for BAT chat"
    >
      <Clipboard className="h-3 w-3" />
      {label}
    </button>
  );
}
