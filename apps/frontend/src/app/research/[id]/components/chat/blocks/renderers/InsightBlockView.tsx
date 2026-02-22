import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InsightBlock } from '../types';

interface InsightBlockViewProps {
  block: InsightBlock;
}

const SEVERITY_STYLES: Record<string, { border: string; bg: string; header: string; icon: string }> = {
  high: {
    border: 'border-l-rose-400 border-rose-200',
    bg: 'bg-rose-50/60 dark:bg-rose-900/20',
    header: 'text-rose-700 dark:text-rose-400',
    icon: '🔴',
  },
  medium: {
    border: 'border-l-amber-400 border-amber-200',
    bg: 'bg-amber-50/60 dark:bg-amber-900/20',
    header: 'text-amber-700 dark:text-amber-400',
    icon: '🟡',
  },
  low: {
    border: 'border-l-emerald-400 border-emerald-200',
    bg: 'bg-emerald-50/60 dark:bg-emerald-900/20',
    header: 'text-emerald-700 dark:text-emerald-400',
    icon: '🟢',
  },
};

const DEFAULT_STYLE = {
  border: 'border-l-primary/50 border-border/50',
  bg: 'bg-card/60',
  header: 'text-foreground',
  icon: '💡',
};

export function InsightBlockView({ block }: InsightBlockViewProps) {
  const style = block.severity ? (SEVERITY_STYLES[block.severity] || DEFAULT_STYLE) : DEFAULT_STYLE;

  return (
    <div className={`rounded-lg border border-l-4 p-3 ${style.border} ${style.bg}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm">{style.icon}</span>
        <h4 className={`text-sm font-semibold ${style.header}`}>{block.title}</h4>
      </div>
      <div className="prose prose-sm max-w-none text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.body}</ReactMarkdown>
      </div>
    </div>
  );
}
