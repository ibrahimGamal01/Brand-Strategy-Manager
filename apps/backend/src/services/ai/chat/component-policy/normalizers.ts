import type { ChatBlock, ChatDesignOption } from '../../../chat/chat-types';
import { KNOWN_BLOCK_TYPES } from './types';
import type { ChatComponentPlan } from './types';
import { asRecord, asString, clamp, normalizeBlockType } from './utils';

function ensureBlockId(block: ChatBlock, index: number): ChatBlock {
  const existing = asString(block.blockId);
  if (existing) return block;
  return { ...block, blockId: `blk-${index + 1}` };
}

export function normalizeBlocks(rawBlocks: ChatBlock[]): ChatBlock[] {
  const out: ChatBlock[] = [];
  for (let i = 0; i < rawBlocks.length; i += 1) {
    const row = rawBlocks[i];
    const record = asRecord(row);
    if (!record) continue;
    const type = normalizeBlockType(record.type);
    if (!type || !KNOWN_BLOCK_TYPES.has(type)) continue;
    out.push(ensureBlockId({ ...record, type } as ChatBlock, out.length));
  }
  return out;
}

export function normalizeDesignOptions(raw: ChatDesignOption[]): ChatDesignOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((option, index) => {
      const designId = asString((option as any)?.designId) || `design-${index + 1}`;
      const label = asString((option as any)?.label) || `Option ${index + 1}`;
      const blocks = normalizeBlocks(Array.isArray((option as any)?.blocks) ? ((option as any).blocks as ChatBlock[]) : []);
      return { designId, label, blocks };
    })
    .filter((option) => option.blocks.length > 0);
}

export function parseComponentPlan(raw: unknown): ChatComponentPlan | null {
  const record = asRecord(raw);
  if (!record) return null;
  const primary = normalizeBlockType(record.primary_component ?? record.primaryComponent);
  const optionalRaw = Array.isArray(record.optional_components)
    ? record.optional_components
    : Array.isArray(record.optionalComponents)
      ? record.optionalComponents
      : [];
  const optional = optionalRaw
    .map((entry) => normalizeBlockType(entry))
    .filter((entry) => entry && KNOWN_BLOCK_TYPES.has(entry));
  const confidenceNumber = Number(record.confidence);
  const confidence = Number.isFinite(confidenceNumber) ? clamp(confidenceNumber, 0, 1) : undefined;
  const stepValue = record.step;
  let step: ChatComponentPlan['step'] = undefined;
  if (typeof stepValue === 'number' && Number.isFinite(stepValue)) {
    step = Math.max(1, Math.floor(stepValue));
  } else if (asRecord(stepValue)) {
    const stepRecord = asRecord(stepValue)!;
    const current = Number(stepRecord.current);
    const total = Number(stepRecord.total);
    step = {
      current: Number.isFinite(current) ? Math.max(1, Math.floor(current)) : undefined,
      total: Number.isFinite(total) ? Math.max(1, Math.floor(total)) : undefined,
      label: asString(stepRecord.label) || undefined,
      status: asString(stepRecord.status) || undefined,
    };
  }
  const actions = Array.isArray(record.actions)
    ? record.actions
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        id: asString(entry.id) || undefined,
        label: asString(entry.label) || undefined,
        value: asString(entry.value) || undefined,
        description: asString(entry.description) || undefined,
        action: asString(entry.action || entry.intent || entry.operation) || undefined,
        href: asString(entry.href || entry.url) || undefined,
        payload: asRecord(entry.payload) || undefined,
      }))
    : [];
  const props = asRecord(record.props) || undefined;

  return {
    intent: asString(record.intent) || undefined,
    step,
    totalSteps: Number.isFinite(Number(record.total_steps ?? record.totalSteps))
      ? Math.max(1, Math.floor(Number(record.total_steps ?? record.totalSteps)))
      : undefined,
    primary_component: primary || undefined,
    optional_components: optional.length ? optional : undefined,
    confidence,
    props,
    actions,
  };
}

export function hasBlockType(blocks: ChatBlock[], type: string): boolean {
  return blocks.some((block) => normalizeBlockType(block.type) === type);
}

export function ensureBlockPresence(blocks: ChatBlock[], type: string, create: () => ChatBlock): ChatBlock[] {
  if (hasBlockType(blocks, type)) return blocks;
  return [...blocks, create()];
}

export function ensureSourceList(blocks: ChatBlock[]): ChatBlock[] {
  if (hasBlockType(blocks, 'source_list')) return blocks;
  return [
    ...blocks,
    {
      type: 'source_list',
      blockId: 'source-list-auto',
      sources: [{ handle: 'workspace_context', note: 'Grounded on available session context.' }],
    },
  ];
}
