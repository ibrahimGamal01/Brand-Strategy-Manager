import type { AgentContextUserItem } from '../agent-context';

const MAX_ITEMS = 30;
const MAX_ITEMS_PER_CATEGORY = 8;
const MAX_VALUE_CHARS = 220;

const CATEGORY_ORDER = [
  'correction',
  'fact',
  'website',
  'social_profile',
  'document_url',
  'free_text',
];

function toEpoch(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function compact(value: unknown, maxChars = MAX_VALUE_CHARS): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatCategoryLabel(category: string): string {
  const normalized = category.replace(/[_-]+/g, ' ').trim();
  if (!normalized) return 'memory';
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function formatEntry(item: AgentContextUserItem): string {
  const value = compact(item.value);
  const label = compact(item.label, 60);
  const key = compact(item.key, 60);
  const lastMention = toEpoch(item.lastMentionedAt);
  const createdAt = toEpoch(item.createdAt);

  const parts: string[] = [];
  if (key) parts.push(`key=${key}`);
  if (label) parts.push(`label=${label}`);
  if (createdAt) parts.push(`created=${new Date(createdAt).toISOString().slice(0, 10)}`);
  if (lastMention) parts.push(`lastMention=${new Date(lastMention).toISOString().slice(0, 10)}`);

  return parts.length ? `- ${value} (${parts.join(', ')})` : `- ${value}`;
}

function sortItems(items: AgentContextUserItem[]): AgentContextUserItem[] {
  return [...items].sort((a, b) => {
    const aTs = Math.max(toEpoch(a.lastMentionedAt), toEpoch(a.createdAt));
    const bTs = Math.max(toEpoch(b.lastMentionedAt), toEpoch(b.createdAt));
    return bTs - aTs;
  });
}

export function formatUserContextsForLLM(items: AgentContextUserItem[]): string {
  if (!Array.isArray(items) || items.length === 0) {
    return '## Persistent Workspace Memory\nNone recorded yet.';
  }

  const sorted = sortItems(items).slice(0, MAX_ITEMS);
  const grouped = new Map<string, AgentContextUserItem[]>();

  for (const item of sorted) {
    const category = compact(item.category, 40).toLowerCase() || 'memory';
    const bucket = grouped.get(category) || [];
    if (bucket.length >= MAX_ITEMS_PER_CATEGORY) continue;
    bucket.push(item);
    grouped.set(category, bucket);
  }

  const orderedCategories = [
    ...CATEGORY_ORDER.filter((category) => grouped.has(category)),
    ...Array.from(grouped.keys())
      .filter((category) => !CATEGORY_ORDER.includes(category))
      .sort((a, b) => a.localeCompare(b)),
  ];

  const lines: string[] = ['## Persistent Workspace Memory'];
  for (const category of orderedCategories) {
    const entries = grouped.get(category) || [];
    if (!entries.length) continue;
    lines.push(`${formatCategoryLabel(category)}:`);
    for (const entry of entries) {
      lines.push(formatEntry(entry));
    }
  }

  return lines.join('\n');
}
