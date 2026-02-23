'use client';

import { useMemo, useState } from 'react';
import { X, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatSavedBlock } from './types';

interface SidebarContextPanelProps {
  blocks: ChatSavedBlock[];
  onUnpin: (block: ChatSavedBlock) => void;
  isLoading?: boolean;
  messageCount?: number;
}

type Tab = 'pinned' | 'stats' | 'export';

const BLOCK_TYPE_ICONS: Record<string, string> = {
  insight: '💡',
  table: '📋',
  metric_cards: '📊',
  comparison: '⚔️',
  swot: '📊',
  poll: '🗳️',
  scoreboard: '🏆',
  moodboard: '🎨',
  brand_voice_meter: '🎙️',
  timeline: '📅',
  funnel: '⬇️',
  chart: '📈',
  source_list: '📎',
  action_buttons: '⚡',
};

function blockLabel(block: ChatSavedBlock) {
  const type = block.blockData?.type || 'block';
  const title = block.blockData?.title ? ` · ${block.blockData.title}` : '';
  return `${type}${title}`;
}

function downloadAllPinned(blocks: ChatSavedBlock[]) {
  if (!blocks.length) return;
  const lines: string[] = ['# BAT Strategy Brief\n', `Generated: ${new Date().toLocaleString()}\n`];
  blocks.forEach((block, i) => {
    lines.push(`\n## ${i + 1}. ${blockLabel(block)}`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bat-strategy-brief.md';
  a.click();
  URL.revokeObjectURL(url);
}

export function SidebarContextPanel({
  blocks,
  onUnpin,
  isLoading,
  messageCount = 0,
}: SidebarContextPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('pinned');

  const typeSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    blocks.forEach((b) => {
      const t = b.blockData?.type || 'block';
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts);
  }, [blocks]);

  return (
    <div className="border-t border-border/40 bg-card/40 flex-shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-border/40 px-2 pt-1.5 gap-0.5">
        {([['pinned', '📌'], ['stats', '📊'], ['export', '⬇']] as [Tab, string][]).map(([tab, icon]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center justify-center gap-1 rounded-t px-1.5 py-1 text-[10px] font-medium transition-all ${
              activeTab === tab
                ? 'bg-background text-foreground border border-border/40 border-b-background -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>{icon}</span>
            <span className="capitalize">{tab}</span>
            {tab === 'pinned' && blocks.length > 0 && (
              <span className="ml-0.5 rounded-full bg-primary/10 text-primary px-1 text-[9px] font-bold">
                {blocks.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-h-[160px] overflow-y-auto custom-scrollbar p-2">
        <AnimatePresence mode="wait">
          {activeTab === 'pinned' && (
            <motion.div
              key="pinned"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="space-y-1"
            >
              {isLoading ? (
                <p className="text-[10px] text-muted-foreground text-center py-2">Loading...</p>
              ) : blocks.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-3">
                  Pin blocks to save them here.
                </p>
              ) : (
                blocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center gap-1.5 rounded border border-border/40 bg-background/50 px-2 py-1.5"
                  >
                    <span className="text-xs flex-shrink-0">
                      {BLOCK_TYPE_ICONS[block.blockData?.type || ''] || '📎'}
                    </span>
                    <span className="flex-1 min-w-0 text-[10px] text-foreground/80 truncate">
                      {blockLabel(block)}
                    </span>
                    <button
                      onClick={() => onUnpin(block)}
                      className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      title="Unpin"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))
              )}
            </motion.div>
          )}

          {activeTab === 'stats' && (
            <motion.div
              key="stats"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded border border-border/40 bg-background/50 p-2 text-center">
                  <p className="text-sm font-bold">{messageCount}</p>
                  <p className="text-[9px] text-muted-foreground">Messages</p>
                </div>
                <div className="rounded border border-border/40 bg-background/50 p-2 text-center">
                  <p className="text-sm font-bold">{blocks.length}</p>
                  <p className="text-[9px] text-muted-foreground">Pinned</p>
                </div>
              </div>
              {typeSummary.length > 0 && (
                <div className="mt-2 space-y-1">
                  {typeSummary.map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-1 text-foreground/70 capitalize">
                        <span>{BLOCK_TYPE_ICONS[type] || '📎'}</span>
                        <span>{type.replace(/_/g, ' ')}</span>
                      </div>
                      <Badge variant="secondary" className="text-[9px] h-4">{count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'export' && (
            <motion.div
              key="export"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="py-1"
            >
              <p className="text-[10px] text-muted-foreground mb-2">
                Download all pinned blocks as a strategy brief.
              </p>
              <Button
                className="w-full h-7 text-[11px] gap-1.5"
                variant="outline"
                disabled={blocks.length === 0}
                onClick={() => downloadAllPinned(blocks)}
              >
                <Download className="h-3 w-3" />
                Brief ({blocks.length} blocks)
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
