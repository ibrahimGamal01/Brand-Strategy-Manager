'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatSavedBlock } from './types';

interface ChatSavedPanelProps {
  blocks: ChatSavedBlock[];
  onUnpin: (block: ChatSavedBlock) => void;
  isLoading?: boolean;
  messageCount?: number;
}

type Tab = 'pinned' | 'stats' | 'export';

function blockLabel(block: ChatSavedBlock) {
  const type = block.blockData?.type || 'block';
  const title = block.blockData?.title ? ` - ${block.blockData.title}` : '';
  return `${type}${title}`;
}

function blockPreview(block: ChatSavedBlock) {
  const data = block.blockData as Record<string, any> | null;
  if (!data) return 'Pinned from chat.';
  if (data.type === 'table' && Array.isArray(data.columns)) {
    return `Cols: ${(data.columns as string[]).slice(0, 3).join(', ')}${data.columns.length > 3 ? '…' : ''}`;
  }
  if (data.type === 'metric_cards' && Array.isArray(data.cards)) {
    return (data.cards as Array<{ label: string }>).map((c) => c.label).slice(0, 3).join(', ');
  }
  if (data.type === 'insight') return String(data.body || '').slice(0, 80);
  if (data.type === 'comparison') return `${(data.left as any)?.title || 'A'} vs ${(data.right as any)?.title || 'B'}`;
  if (data.type === 'swot') return 'SWOT analysis';
  if (data.type === 'poll') return String(data.question || '').slice(0, 60);
  if (data.type === 'brand_voice_meter') return 'Brand voice profile';
  if (data.type === 'moodboard') return 'Visual direction';
  if (data.type === 'scoreboard') return 'Competitor ranking';
  return 'Pinned from chat.';
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-3 text-center">
      <p className="text-base">{icon}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function downloadAllPinned(blocks: ChatSavedBlock[]) {
  if (!blocks.length) return;
  const lines: string[] = ['# BAT Strategy Brief\n', `Generated: ${new Date().toLocaleString()}\n`];
  blocks.forEach((block, i) => {
    lines.push(`\n## ${i + 1}. ${blockLabel(block)}`);
    lines.push(blockPreview(block));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bat-strategy-brief.md';
  a.click();
  URL.revokeObjectURL(url);
}

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

export function ChatSavedPanel({ blocks, onUnpin, isLoading, messageCount = 0 }: ChatSavedPanelProps) {
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
    <section className="flex flex-col rounded-xl border border-border/70 bg-card/60 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold">Context Panel</h3>
            <p className="text-[10px] text-muted-foreground">Saved insights and session info</p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase">{blocks.length} pinned</Badge>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {([['pinned', '📌 Pinned'], ['stats', '📊 Stats'], ['export', '⬇ Export']] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all ${activeTab === tab
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        <AnimatePresence mode="wait">
          {activeTab === 'pinned' && (
            <motion.div
              key="pinned"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="space-y-2"
            >
              {isLoading ? (
                <p className="text-xs text-muted-foreground">Loading...</p>
              ) : blocks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-background/40 p-4 text-center">
                  <p className="text-[11px] text-muted-foreground">Pin blocks to save them here.</p>
                </div>
              ) : (
                blocks.map((block) => (
                  <div key={block.id} className="rounded-lg border border-border/50 bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{BLOCK_TYPE_ICONS[block.blockData?.type || ''] || '📎'}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {block.blockData?.type || 'block'}
                        </Badge>
                      </div>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onUnpin(block)}>
                        Unpin
                      </Button>
                    </div>
                    <p className="text-xs font-medium">{blockLabel(block)}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{blockPreview(block)}</p>
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
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Messages" value={messageCount} icon="💬" />
                <StatCard label="Pinned Blocks" value={blocks.length} icon="📌" />
              </div>

              {typeSummary.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Block Types
                  </p>
                  <div className="space-y-1.5">
                    {typeSummary.map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span>{BLOCK_TYPE_ICONS[type] || '📎'}</span>
                          <span className="capitalize text-foreground">{type.replace(/_/g, ' ')}</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">{count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'export' && (
            <motion.div
              key="export"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="space-y-3"
            >
              <p className="text-xs text-muted-foreground">
                Export all pinned blocks as a strategy brief markdown file.
              </p>
              <Button
                className="w-full gap-2"
                variant="outline"
                disabled={blocks.length === 0}
                onClick={() => downloadAllPinned(blocks)}
              >
                ⬇ Download Brief ({blocks.length} blocks)
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
