'use client';

import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  ChatIntelligenceCrudPanel,
  type IntelligenceCrudRequest,
} from './ChatIntelligenceCrudPanel';
import type { IntelligenceSectionKey } from './intelligence-crud';

interface CrudDrawerProps {
  open: boolean;
  onClose: () => void;
  onRunCrud: (request: IntelligenceCrudRequest) => Promise<unknown>;
  onOpenSection: (section: IntelligenceSectionKey) => void;
}

export function CrudDrawer({ open, onClose, onRunCrud, onOpenSection }: CrudDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop (subtle) */}
          <motion.div
            key="crud-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40 bg-background/30 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.div
            key="crud-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.8 }}
            className="absolute inset-y-0 right-0 z-50 flex w-[360px] flex-col border-l border-border/60 bg-card/95 shadow-2xl backdrop-blur-md overflow-hidden"
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between border-b border-border/40 bg-card/60 px-4 py-3 flex-shrink-0">
              <div>
                <h3 className="text-sm font-semibold">CRUD Control Deck</h3>
                <p className="text-[10px] text-muted-foreground">Intelligence Bridge · direct data operations</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Drawer content — scrollable */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <ChatIntelligenceCrudPanel
                onRunCrud={onRunCrud}
                onOpenSection={(section) => {
                  onOpenSection(section);
                  onClose();
                }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
