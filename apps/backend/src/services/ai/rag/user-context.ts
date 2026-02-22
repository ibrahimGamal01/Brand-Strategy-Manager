/**
 * RAG Retriever: User-Supplied Contexts
 *
 * Loads facts the user has directly provided in chat and
 * formats them as the highest-priority block in the LLM context.
 */

import { prisma } from '../../../lib/prisma';
import type { UscCategory } from '../../chat/user-context-repository';

export interface UserSuppliedContextEntry {
  id: string;
  category: UscCategory;
  key: string;
  value: string;
  label: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  website: 'Website',
  social_profile: 'Social Profile',
  document_url: 'Document URL',
  fact: 'Fact',
  correction: 'Correction',
  free_text: 'Note',
};

export async function getUserSuppliedContexts(
  researchJobId: string,
): Promise<UserSuppliedContextEntry[]> {
  const rows = await prisma.userSuppliedContext.findMany({
    where: { researchJobId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    category: row.category as UscCategory,
    key: row.key,
    value: row.value,
    label: row.label,
  }));
}

export function formatUserContextForLLM(items: UserSuppliedContextEntry[]): string {
  if (items.length === 0) return '';

  const grouped = new Map<string, UserSuppliedContextEntry[]>();
  for (const item of items) {
    const group = grouped.get(item.category) ?? [];
    group.push(item);
    grouped.set(item.category, group);
  }

  let output = `## User-Supplied Context (Direct from client - HIGHEST PRIORITY)\n`;
  output += `Use these facts with highest priority. They override any inferred values from research data.\n\n`;

  for (const [category, entries] of grouped) {
    const catLabel = CATEGORY_LABEL[category] ?? category;
    output += `### ${catLabel}\n`;
    for (const entry of entries) {
      const display = entry.label ?? `${catLabel}: ${entry.value}`;
      output += `- ${display}\n`;
    }
    output += '\n';
  }

  return output;
}
