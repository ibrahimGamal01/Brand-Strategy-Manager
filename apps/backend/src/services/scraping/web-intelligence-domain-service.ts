import { prisma } from '../../lib/prisma';
import { getDomain, normalizeUrl, toDiscovery, toSourceType } from './web-intelligence-utils';

export async function getJobDomains(researchJobId: string): Promise<string[]> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: {
      id: true,
      client: {
        select: {
          brainProfile: { select: { websiteDomain: true } },
          clientAccounts: {
            select: {
              profileUrl: true,
            },
          },
        },
      },
      discoveredCompetitors: {
        where: { isActive: true },
        select: {
          profileUrl: true,
        },
      },
      webSources: {
        where: { isActive: true },
        select: { domain: true },
        take: 200,
      },
    },
  });

  if (!job) throw new Error('Research job not found');

  const set = new Set<string>();
  const websiteDomain = job.client.brainProfile?.websiteDomain;
  if (websiteDomain) set.add(String(websiteDomain).replace(/^www\./i, '').toLowerCase());

  for (const account of job.client.clientAccounts) {
    if (!account.profileUrl) continue;
    try {
      set.add(getDomain(normalizeUrl(account.profileUrl)));
    } catch {
      // Ignore invalid account URLs.
    }
  }

  for (const competitor of job.discoveredCompetitors) {
    if (!competitor.profileUrl) continue;
    try {
      set.add(getDomain(normalizeUrl(competitor.profileUrl)));
    } catch {
      // Ignore invalid competitor URLs.
    }
  }

  for (const source of job.webSources) {
    if (source.domain) set.add(String(source.domain).toLowerCase());
  }

  return Array.from(set).filter(Boolean);
}

export async function upsertWebSource(input: {
  researchJobId: string;
  normalizedUrl: string;
  sourceType?: string;
  discoveredBy?: string;
}) {
  const domain = getDomain(input.normalizedUrl);
  return prisma.webSource.upsert({
    where: {
      researchJobId_url: {
        researchJobId: input.researchJobId,
        url: input.normalizedUrl,
      },
    },
    update: {
      domain,
      sourceType: toSourceType(input.sourceType),
      discoveredBy: toDiscovery(input.discoveredBy),
      isActive: true,
      archivedAt: null,
      archivedBy: null,
    },
    create: {
      researchJobId: input.researchJobId,
      url: input.normalizedUrl,
      domain,
      sourceType: toSourceType(input.sourceType),
      discoveredBy: toDiscovery(input.discoveredBy),
    },
  });
}
