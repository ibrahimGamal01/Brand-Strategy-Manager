import type { ChatBlock } from '../../chat/chat-types';
import type { ToolExecutionResult } from './chat-tool-runtime';

const MAX_EVIDENCE_ITEMS = 12;

type SourceEntry = { handle: string; note: string };
type EvidenceItem = {
  id?: string;
  title: string;
  url?: string;
  internalLink?: string;
  source?: string;
  note?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compact(value: unknown, maxChars = 180): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function normalizeEvidenceItem(name: string, row: Record<string, unknown>): EvidenceItem | null {
  if (name === 'evidence.posts') {
    const handle = compact(row.handle, 60) || 'profile';
    const platform = compact(row.platform, 30) || 'social';
    const postId = compact(row.postId, 80);
    const permalink = compact(row.permalink, 250);
    const internalLink = compact(row.internalLink, 250);
    const postedAt = compact(row.postedAt, 40);
    const caption = compact(row.captionSnippet, 120);
    const metrics = isRecord(row.metrics) ? row.metrics : {};
    const engagement = Number(metrics.engagementScore ?? 0);
    const noteParts = [
      postedAt ? `posted ${formatDate(postedAt) || postedAt}` : null,
      Number.isFinite(engagement) ? `engagement ${Math.round(engagement)}` : null,
      caption || null,
    ].filter(Boolean) as string[];

    return {
      id: postId || undefined,
      title: `@${handle} (${platform})`,
      url: permalink || undefined,
      internalLink: internalLink || undefined,
      source: `${platform} post`,
      note: noteParts.join(' • ') || undefined,
    };
  }

  if (name === 'evidence.videos' || name === 'evidence.news') {
    const title = compact(row.title, 160);
    const url = compact(row.url, 250);
    const internalLink = compact(row.internalLink, 250);
    if (!title && !url && !internalLink) return null;
    const source = compact(row.source, 80) || (name === 'evidence.news' ? 'news' : 'video');
    const snippet = compact(row.snippet, 140);
    const publishedAt = compact(row.publishedAt, 40);
    const note = [source, publishedAt ? `published ${formatDate(publishedAt) || publishedAt}` : null, snippet]
      .filter(Boolean)
      .join(' • ');
    return {
      id: compact(row.id, 80) || undefined,
      title: title || source,
      url: url || undefined,
      internalLink: internalLink || undefined,
      source,
      note: note || undefined,
    };
  }

  return null;
}

function sourceLabel(name: string): string {
  if (name === 'evidence.posts') return 'social_posts';
  if (name === 'evidence.videos') return 'video_results';
  if (name === 'evidence.news') return 'news_results';
  return name.replace(/\./g, '_');
}

function collectEvidenceData(toolResults: ToolExecutionResult[]): {
  items: EvidenceItem[];
  sources: SourceEntry[];
  noDataReasons: string[];
} {
  const evidenceNames = new Set(['evidence.posts', 'evidence.videos', 'evidence.news']);
  const itemMap = new Map<string, EvidenceItem>();
  const sources: SourceEntry[] = [];
  const noDataReasons: string[] = [];

  for (const result of toolResults) {
    if (!evidenceNames.has(result.name)) continue;
    const label = sourceLabel(result.name);

    if (result.error) {
      sources.push({ handle: label, note: `Tool error: ${compact(result.error, 140)}` });
      continue;
    }

    const payload = isRecord(result.result) ? result.result : {};
    const rows = Array.isArray(payload.items) ? payload.items.filter((row) => isRecord(row)) : [];
    const reason = compact(payload.reason, 180);

    if (!rows.length) {
      if (reason) noDataReasons.push(`${label}: ${reason}`);
      sources.push({
        handle: label,
        note: reason || 'No matching evidence rows found.',
      });
      continue;
    }

    sources.push({
      handle: label,
      note: `${rows.length} evidence item(s) returned.`,
    });

    for (const row of rows) {
      const normalized = normalizeEvidenceItem(result.name, row);
      if (!normalized) continue;
      const dedupeKey = `${normalized.url || ''}|${normalized.internalLink || ''}|${normalized.title}`;
      if (!itemMap.has(dedupeKey)) itemMap.set(dedupeKey, normalized);
    }
  }

  return {
    items: Array.from(itemMap.values()).slice(0, MAX_EVIDENCE_ITEMS),
    sources: sources.slice(0, 8),
    noDataReasons: noDataReasons.slice(0, 3),
  };
}

export function buildDeterministicEvidenceBlocks(toolResults: ToolExecutionResult[]): ChatBlock[] {
  const { items, sources, noDataReasons } = collectEvidenceData(toolResults);
  const blocks: ChatBlock[] = [];

  if (items.length) {
    blocks.push({
      type: 'evidence_list',
      blockId: 'evidence-list-deterministic',
      title: 'Linked evidence',
      caption: 'Grounded from retrieved workspace records and tool output.',
      items,
    });
  } else if (sources.length) {
    blocks.push({
      type: 'insight',
      blockId: 'evidence-missing-insight',
      title: 'Evidence status',
      body: noDataReasons.join(' ') || 'No linked evidence is currently available for this request.',
      severity: 'low',
    });
  }

  if (sources.length) {
    blocks.push({
      type: 'source_list',
      blockId: 'source-list-deterministic',
      sources,
    });
  }

  return blocks;
}

export function mergeDeterministicBlocks(modelBlocks: ChatBlock[], deterministicBlocks: ChatBlock[]): ChatBlock[] {
  if (!deterministicBlocks.length) return modelBlocks;
  const replaceTypes = new Set(['evidence_list', 'source_list']);
  const filteredModelBlocks = modelBlocks.filter((block) => !replaceTypes.has(String(block.type || '').toLowerCase()));
  return [...deterministicBlocks, ...filteredModelBlocks];
}
