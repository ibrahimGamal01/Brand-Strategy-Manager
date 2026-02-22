/**
 * User-Supplied Context Repository
 *
 * CRUD for facts the user directly provides in chat
 * (websites, handles, corrections, notes) that persist
 * across sessions and are injected into the RAG.
 */

import { prisma } from '../../lib/prisma';

export type UscCategory =
  | 'website'
  | 'social_profile'
  | 'fact'
  | 'correction'
  | 'document_url'
  | 'free_text';

export interface UserSuppliedContextItem {
  id: string;
  researchJobId: string;
  category: UscCategory;
  key: string | null;
  value: string;
  label: string | null;
  sourceMessage: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Upsert a user-supplied context item.
 * Uses (researchJobId, category, key) as the natural key so that
 * "my website is X" followed by "actually it's Y" just updates
 * the value instead of creating a duplicate.
 */
export async function upsertUserContext(
  researchJobId: string,
  category: UscCategory,
  key: string | null,
  value: string,
  label?: string | null,
  sourceMessage?: string | null,
): Promise<UserSuppliedContextItem> {
  const normalizedKey = key?.toLowerCase().trim() || '_default';

  const existing = await prisma.userSuppliedContext.findFirst({
    where: { researchJobId, category, key: normalizedKey, isActive: true },
  });

  if (existing) {
    return prisma.userSuppliedContext.update({
      where: { id: existing.id },
      data: { value, label: label ?? existing.label, sourceMessage: sourceMessage ?? existing.sourceMessage },
    }) as Promise<UserSuppliedContextItem>;
  }

  return prisma.userSuppliedContext.create({
    data: {
      researchJobId,
      category,
      key: normalizedKey,
      value,
      label: label ?? null,
      sourceMessage: sourceMessage ?? null,
      isActive: true,
    },
  }) as Promise<UserSuppliedContextItem>;
}

/**
 * List all active user-supplied contexts for a research job.
 */
export async function listUserContexts(researchJobId: string): Promise<UserSuppliedContextItem[]> {
  return prisma.userSuppliedContext.findMany({
    where: { researchJobId, isActive: true },
    orderBy: { createdAt: 'asc' },
  }) as Promise<UserSuppliedContextItem[]>;
}

/**
 * Soft-delete a context item.
 */
export async function deactivateUserContext(id: string): Promise<void> {
  await prisma.userSuppliedContext.update({
    where: { id },
    data: { isActive: false },
  });
}
