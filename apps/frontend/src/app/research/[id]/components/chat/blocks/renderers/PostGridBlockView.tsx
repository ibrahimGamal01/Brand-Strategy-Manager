import type { PostGridBlock } from '../types';

interface PostGridBlockViewProps {
  block: PostGridBlock;
}

export function PostGridBlockView({ block }: PostGridBlockViewProps) {
  if (!block.postIds?.length) {
    return <p className="text-xs text-muted-foreground">No posts referenced.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {block.postIds.map((postId) => (
        <span
          key={`${block.blockId}-${postId}`}
          className="rounded-full border border-border/60 bg-card/70 px-3 py-1 text-xs font-mono"
        >
          {postId}
        </span>
      ))}
    </div>
  );
}

