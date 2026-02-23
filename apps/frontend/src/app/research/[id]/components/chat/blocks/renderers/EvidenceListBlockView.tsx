import type { EvidenceListBlock } from '../types';

type EvidenceListBlockViewProps = {
  block: EvidenceListBlock;
};

export function EvidenceListBlockView({ block }: EvidenceListBlockViewProps) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (!items.length) return null;

  return (
    <section className="space-y-3">
      {block.title ? (
        <header className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {block.title}
        </header>
      ) : null}
      {block.caption ? <p className="text-xs text-muted-foreground">{block.caption}</p> : null}
      <ul className="space-y-2">
        {items.map((item, index) => {
          const href = item.url || item.internalLink || '';
          const label = item.title || `Evidence ${index + 1}`;
          return (
            <li key={item.id || `${label}-${index}`} className="rounded-lg border border-border/60 bg-background/60 p-3">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {label}
                </a>
              ) : (
                <p className="text-sm font-medium text-foreground">{label}</p>
              )}
              {(item.source || item.note) ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[item.source, item.note].filter(Boolean).join(' • ')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

