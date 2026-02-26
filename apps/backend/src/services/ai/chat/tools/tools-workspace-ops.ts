import { prisma } from '../../../../lib/prisma';
import type { ToolDefinition } from './tool-types';
import { savePortalWorkspaceIntakeDraft } from '../../../portal/portal-intake-draft';
import { seedTopPicksFromInspirationLinks } from '../../../discovery/seed-intake-competitors';
import { parseCompetitorInspirationInputs } from '../../../intake/brain-intake-utils';
import { orchestrateCompetitorsForJob } from '../../../discovery/competitor-orchestrator-v2';
import { gatherAllDDG, searchBrandContextDDG, searchRawDDG } from '../../../discovery/duckduckgo-search';
import {
  crawlAndPersistWebSources,
  fetchAndPersistWebSnapshot,
} from '../../../scraping/web-intelligence-service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function uniqueStrings(items: unknown[], max = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function extractUrls(text: string): string[] {
  const matches = String(text || '').match(/https?:\/\/[^\s)]+/gi) || [];
  return uniqueStrings(matches, 20);
}

function extractDomains(text: string): string[] {
  const matches = String(text || '').match(/\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?/gi) || [];
  return uniqueStrings(
    matches
      .map((entry) => (entry.startsWith('http://') || entry.startsWith('https://') ? entry : `https://${entry}`))
      .map((entry) => entry.replace(/[),.;]+$/, '')),
    20
  );
}

function extractSocialHandles(text: string): string[] {
  const source = String(text || '');
  const handles = new Set<string>();

  const mentionMatches = source.match(/@([a-z0-9._-]{2,60})/gi) || [];
  for (const row of mentionMatches) {
    const handle = row.replace(/^@+/, '').trim().toLowerCase();
    if (handle) handles.add(handle);
  }

  const urlPatterns = [
    /instagram\.com\/([a-z0-9._]{2,30})/gi,
    /tiktok\.com\/@([a-z0-9._]{2,30})/gi,
    /youtube\.com\/@([a-z0-9._-]{2,60})/gi,
    /x\.com\/([a-z0-9._]{2,30})/gi,
    /twitter\.com\/([a-z0-9._]{2,30})/gi,
  ];
  for (const pattern of urlPatterns) {
    const matches = source.matchAll(pattern);
    for (const match of matches) {
      const handle = String(match[1] || '').trim().toLowerCase();
      if (handle) handles.add(handle);
    }
  }

  return Array.from(handles).slice(0, 12);
}

function getHostname(value: string): string {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isSocialUrl(value: string): boolean {
  const host = getHostname(value);
  return (
    host.includes('instagram.com') ||
    host.includes('tiktok.com') ||
    host.includes('youtube.com') ||
    host.includes('x.com') ||
    host.includes('twitter.com') ||
    host.includes('linkedin.com') ||
    host.includes('facebook.com')
  );
}

type ResearchDepth = 'quick' | 'standard' | 'deep';

function normalizeResearchDepth(value: unknown): ResearchDepth {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'deep') return 'deep';
  if (raw === 'quick') return 'quick';
  return 'standard';
}

function getDepthProfile(depth: ResearchDepth): { maxPages: number; maxDepth: number; accountChecks: number; siteLimit: number } {
  if (depth === 'deep') {
    return { maxPages: 40, maxDepth: 2, accountChecks: 5, siteLimit: 3 };
  }
  if (depth === 'quick') {
    return { maxPages: 6, maxDepth: 1, accountChecks: 2, siteLimit: 1 };
  }
  return { maxPages: 16, maxDepth: 2, accountChecks: 3, siteLimit: 2 };
}

function buildDdgQueries(input: {
  text: string;
  brandName: string;
  niche: string;
  handles: string[];
  websites: string[];
}): string[] {
  const queries: string[] = [];
  const firstLine =
    String(input.text || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || '';

  if (firstLine) queries.push(firstLine.slice(0, 180));
  if (input.brandName) {
    queries.push(`${input.brandName} ${input.niche || 'brand'} overview`);
    queries.push(`${input.brandName} offers pricing socials`);
  }
  for (const handle of input.handles.slice(0, 6)) {
    queries.push(`"${handle}" instagram profile`);
    queries.push(`"${handle}" tiktok profile`);
  }
  for (const website of input.websites.slice(0, 4)) {
    const host = getHostname(website);
    if (!host) continue;
    queries.push(`site:${host} about`);
    queries.push(`site:${host} pricing`);
  }

  return uniqueStrings(queries, 14);
}

function extractWorkspaceWebsites(inputData: Record<string, unknown>): string[] {
  const raw: string[] = [];
  if (typeof inputData.website === 'string') raw.push(inputData.website);
  if (Array.isArray(inputData.websites)) {
    raw.push(...inputData.websites.map((row) => String(row || '').trim()));
  }
  return uniqueStrings(raw, 6).filter(Boolean);
}

function sectionRegex(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\*\\*\\s*${escaped}\\s*\\*\\*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^\\n]+\\*\\*|$)`, 'i');
}

function extractSection(text: string, labels: string[]): string {
  const source = String(text || '');
  for (const label of labels) {
    const match = source.match(sectionRegex(label));
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function cleanListLine(line: string): string {
  return String(line || '')
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '')
    .replace(/\(\[[^\]]+\]\([^)]+\)\)/g, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseListSection(section: string, max = 20): string[] {
  const lines = String(section || '')
    .split('\n')
    .map((line) => cleanListLine(line))
    .filter(Boolean);
  return uniqueStrings(lines, max);
}

function firstMeaningfulLine(section: string): string {
  const items = parseListSection(section, 5);
  return items[0] || '';
}

function parseOperateAndWant(section: string): { operateWhere?: string; wantClientsWhere?: string } {
  const lines = parseListSection(section, 12);
  if (!lines.length) return {};

  const operateLine = lines.find((line) => /^operate/i.test(line)) || lines[0];
  const wantLine = lines.find((line) => /^want/i.test(line)) || lines[1] || '';

  return {
    ...(operateLine ? { operateWhere: operateLine } : {}),
    ...(wantLine ? { wantClientsWhere: wantLine } : {}),
  };
}

function extractBrandName(text: string): string {
  const source = String(text || '');
  const branded = source.match(/^\s*([A-Za-z0-9&' .-]{2,80})\s*:\s*[a-z0-9.-]+\.[a-z]{2,}/im);
  if (branded?.[1]) return branded[1].trim();
  const explicit = source.match(/brand name\s*[:\-]\s*([^\n]+)/i);
  if (explicit?.[1]) return explicit[1].trim();
  return '';
}

function extractIntroWebsites(text: string): { website?: string; websites?: string[] } {
  const source = String(text || '');
  const intro = source.split(/\n\s*\*\*/)[0] || source;
  const candidates = uniqueStrings([...extractUrls(intro), ...extractDomains(intro)], 6);
  if (!candidates.length) return {};
  return {
    website: candidates[0],
    websites: candidates.slice(0, 5),
  };
}

function extractCompetitorLinks(text: string): string[] {
  const section = extractSection(text, [
    'Competitors or inspiration accounts (3 links)',
    'Competitors / inspiration links',
    'Competitors or inspiration links',
  ]);
  const source = section || text;
  const urls = extractUrls(source).filter((entry) =>
    /(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com)/i.test(entry)
  );
  if (urls.length) return uniqueStrings(urls, 8);

  const handleMatches = String(source || '').match(/@([a-z0-9._-]{2,60})/gi) || [];
  const handles = handleMatches.map((entry) => entry.replace(/^@+/, '').trim()).filter(Boolean);
  return uniqueStrings(handles.map((handle) => `https://www.instagram.com/${handle}`), 8);
}

function parseIntakePayloadFromText(text: string): Record<string, unknown> {
  const operateSection = extractSection(text, ['Where do you operate? Where do you want more clients?']);
  const servicesSection = extractSection(text, ['What services do you offer? (list)', 'What services do you offer?']);
  const oneLineSection = extractSection(text, ['What do you do in one sentence?']);
  const mainOfferSection = extractSection(text, ['What is your main offer to sell through content?']);
  const audienceSection = extractSection(text, [
    'Who is the ideal audience? (pick one primary for the next 90 days)',
    'Who is the ideal audience?',
  ]);
  const problemsSection = extractSection(text, ['What are the top 3 problems you solve?']);
  const resultsSection = extractSection(text, ['What results should content drive in the next 90 days? (pick up to 2)']);
  const questionsSection = extractSection(text, ['What do people usually ask before buying? (pick top 3)']);
  const voiceSection = extractSection(text, ['Brand voice in 3 to 5 words']);
  const avoidSection = extractSection(text, ['Any topics to avoid or people you don’t want to attract']);

  const { operateWhere, wantClientsWhere } = parseOperateAndWant(operateSection);
  const competitors = extractCompetitorLinks(text);
  const introSites = extractIntroWebsites(text);
  const brandName = extractBrandName(text);
  const oneSentenceDescription = firstMeaningfulLine(oneLineSection);
  const idealAudience = firstMeaningfulLine(audienceSection);

  const payload: Record<string, unknown> = {
    ...(brandName ? { name: brandName } : {}),
    ...introSites,
    ...(oneSentenceDescription ? { oneSentenceDescription } : {}),
    ...(operateWhere ? { operateWhere } : {}),
    ...(wantClientsWhere ? { wantClientsWhere } : {}),
    ...(idealAudience ? { idealAudience, targetAudience: idealAudience } : {}),
    ...(mainOfferSection ? { mainOffer: firstMeaningfulLine(mainOfferSection) } : {}),
    ...(servicesSection ? { servicesList: parseListSection(servicesSection, 20) } : {}),
    ...(problemsSection ? { topProblems: parseListSection(problemsSection, 3) } : {}),
    ...(resultsSection ? { resultsIn90Days: parseListSection(resultsSection, 2) } : {}),
    ...(questionsSection ? { questionsBeforeBuying: parseListSection(questionsSection, 3) } : {}),
    ...(voiceSection ? { brandVoiceWords: firstMeaningfulLine(voiceSection) } : {}),
    ...(avoidSection ? { topicsToAvoid: parseListSection(avoidSection, 20) } : {}),
    ...(competitors.length ? { competitorInspirationLinks: competitors } : {}),
  };

  return payload;
}

function mergePayload(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function buildCompetitorEvidence(links: string[]): Array<{ kind: string; label: string; url: string }> {
  return links.slice(0, 8).map((url) => ({
    kind: 'url',
    label: `Competitor source: ${url}`,
    url,
  }));
}

async function addCompetitorLinksForWorkspace(input: {
  researchJobId: string;
  links: string[];
}): Promise<{
  added: number;
  artifacts: Array<{ kind: string; section?: string; id: string }>;
  evidence: Array<{ kind: string; label: string; url: string }>;
}> {
  const normalizedLinks = uniqueStrings(input.links, 10);
  if (!normalizedLinks.length) {
    return { added: 0, artifacts: [], evidence: [] };
  }

  const seeded = await seedTopPicksFromInspirationLinks(input.researchJobId, normalizedLinks);
  const parsed = parseCompetitorInspirationInputs(normalizedLinks);
  const artifacts: Array<{ kind: string; section?: string; id: string }> = [];

  if (parsed.length > 0) {
    const rows = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId: input.researchJobId,
        OR: parsed.flatMap((entry) => {
          if (entry.inputType === 'website') {
            return [];
          }
          return [
            {
              platform: entry.inputType,
              handle: entry.handle,
            },
          ];
        }),
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });

    for (const row of rows) {
      artifacts.push({
        kind: 'intelligence_row',
        section: 'competitors',
        id: row.id,
      });
    }
  }

  return {
    added: seeded.topPicks,
    artifacts,
    evidence: buildCompetitorEvidence(normalizedLinks),
  };
}

function toJsonScalar(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return String(value);
}

function normalizeIntakeAnswer(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeIntakeAnswer(entry));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = normalizeIntakeAnswer(entry);
    }
    return output;
  }
  return toJsonScalar(value);
}

function compactIntakeAnswer(value: unknown, maxChars = 240): string {
  const normalized =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : JSON.stringify(value);
  const compact = String(normalized || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

export const workspaceOpsTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'workspace.intake.get',
    description: 'Read the original intake/form responses captured for this workspace.',
    argsSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        section: { type: 'string' },
        summary: { type: 'string' },
        count: { type: 'number' },
        items: { type: 'array' },
        originalResponse: { type: 'object' },
        latestResponse: { type: 'object' },
        inputData: { type: 'object' },
        firstSubmittedAt: { type: 'string' },
        lastUpdatedAt: { type: 'string' },
        evidence: { type: 'array' },
        deepLink: { type: 'string' },
      },
      required: ['section', 'summary', 'count', 'items', 'originalResponse', 'latestResponse', 'inputData', 'evidence', 'deepLink'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context) => {
      const [job, intakeAnswers] = await Promise.all([
        prisma.researchJob.findUnique({
          where: { id: context.researchJobId },
          select: {
            inputData: true,
          },
        }),
        prisma.clientIntakeAnswer.findMany({
          where: { researchJobId: context.researchJobId },
          orderBy: { createdAt: 'asc' },
          take: 400,
          select: {
            id: true,
            questionSetId: true,
            questionKey: true,
            answerType: true,
            answer: true,
            createdAt: true,
          },
        }),
      ]);

      const inputData = asRecord(job?.inputData);
      const earliestByKey = new Map<string, unknown>();
      const latestByKey = new Map<string, unknown>();
      const firstSeenOrder: string[] = [];

      for (const row of intakeAnswers) {
        const key = String(row.questionKey || '').trim();
        if (!key) continue;
        const normalizedAnswer = normalizeIntakeAnswer(row.answer);
        if (!earliestByKey.has(key)) {
          earliestByKey.set(key, normalizedAnswer);
          firstSeenOrder.push(key);
        }
        latestByKey.set(key, normalizedAnswer);
      }

      const orderedKeys = firstSeenOrder.length
        ? firstSeenOrder
        : Object.keys(inputData);

      const originalResponse: Record<string, unknown> = {};
      const latestResponse: Record<string, unknown> = {};
      for (const key of orderedKeys) {
        if (earliestByKey.has(key)) {
          originalResponse[key] = earliestByKey.get(key) as unknown;
        } else if (Object.hasOwn(inputData, key)) {
          originalResponse[key] = normalizeIntakeAnswer(inputData[key]);
        }

        if (latestByKey.has(key)) {
          latestResponse[key] = latestByKey.get(key) as unknown;
        } else if (Object.hasOwn(inputData, key)) {
          latestResponse[key] = normalizeIntakeAnswer(inputData[key]);
        }
      }

      const items = intakeAnswers.slice(0, 120).map((row) => ({
        id: row.id,
        questionSetId: row.questionSetId,
        questionKey: row.questionKey,
        answerType: row.answerType,
        answer: normalizeIntakeAnswer(row.answer),
        answerPreview: compactIntakeAnswer(row.answer),
        createdAt: row.createdAt.toISOString(),
      }));

      const deepLink = context.links.moduleLink('workspace', { view: 'intake' });
      const uniqueFieldsCount = Object.keys(originalResponse).length;
      const summary =
        uniqueFieldsCount > 0 || intakeAnswers.length > 0
          ? `Loaded original intake response with ${uniqueFieldsCount} field(s) from ${intakeAnswers.length} captured answer row(s).`
          : 'No saved intake form response was found for this workspace.';

      return {
        section: 'workspace_intake',
        summary,
        count: items.length,
        items,
        originalResponse,
        latestResponse,
        inputData: normalizeIntakeAnswer(inputData),
        ...(intakeAnswers[0]?.createdAt ? { firstSubmittedAt: intakeAnswers[0].createdAt.toISOString() } : {}),
        ...(intakeAnswers[intakeAnswers.length - 1]?.createdAt
          ? { lastUpdatedAt: intakeAnswers[intakeAnswers.length - 1].createdAt.toISOString() }
          : {}),
        evidence: [
          {
            kind: 'internal',
            label: 'Open workspace intake',
            url: deepLink,
          },
        ],
        deepLink,
      };
    },
  },
  {
    name: 'intake.update_from_text',
    description: 'Parse freeform intake text and update the workspace intake draft, including competitor links.',
    argsSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        fields: { type: 'object' },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        updatedFields: { type: 'array', items: { type: 'string' } },
        competitorLinksAdded: { type: 'number' },
        warnings: { type: 'array', items: { type: 'string' } },
        artifacts: { type: 'array' },
        evidence: { type: 'array' },
      },
      required: ['summary', 'updatedFields'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const text = String(args.text || context.userMessage || '').trim();
      const parsed = parseIntakePayloadFromText(text);
      const merged = mergePayload(parsed, asRecord(args.fields));
      const updatedFields = Object.keys(merged);

      if (!updatedFields.length) {
        return {
          summary: 'No recognizable intake fields were found in the message.',
          updatedFields: [],
          warnings: ['Provide a structured intake block or explicit fields.'],
        };
      }

      await savePortalWorkspaceIntakeDraft(context.researchJobId, merged);

      const competitorLinks = Array.isArray(merged.competitorInspirationLinks)
        ? uniqueStrings(merged.competitorInspirationLinks, 8)
        : [];
      const competitorResult = competitorLinks.length
        ? await addCompetitorLinksForWorkspace({
            researchJobId: context.researchJobId,
            links: competitorLinks,
          })
        : { added: 0, artifacts: [], evidence: [] as Array<{ kind: string; label: string; url: string }> };

      return {
        summary: `Updated intake draft with ${updatedFields.length} field(s)${
          competitorResult.added > 0 ? ` and added ${competitorResult.added} competitor inspiration link(s)` : ''
        }.`,
        updatedFields,
        competitorLinksAdded: competitorResult.added,
        artifacts: [
          { kind: 'intake_draft', id: context.researchJobId },
          ...competitorResult.artifacts,
        ],
        evidence: competitorResult.evidence,
        continuations: [
          {
            type: 'auto_continue',
            reason: 'Intake context updated; refresh competitor and web intelligence summary.',
            suggestedNextTools: ['intel.list', 'orchestration.status'],
          },
        ],
      };
    },
  },
  {
    name: 'competitors.add_links',
    description: 'Add competitor/inspiration links from text or link list into the workspace competitor set.',
    argsSchema: {
      type: 'object',
      properties: {
        links: { type: 'array', items: { type: 'string' } },
        text: { type: 'string' },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        added: { type: 'number' },
        linksProcessed: { type: 'number' },
        artifacts: { type: 'array' },
        evidence: { type: 'array' },
      },
      required: ['summary', 'added', 'linksProcessed'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const directLinks = Array.isArray(args.links) ? uniqueStrings(args.links, 10) : [];
      const text = String(args.text || context.userMessage || '').trim();
      const fromSection = extractCompetitorLinks(text);
      const links = uniqueStrings([...directLinks, ...fromSection], 10);

      if (!links.length) {
        return {
          summary: 'No competitor links were detected in the request.',
          added: 0,
          linksProcessed: 0,
          warnings: ['Provide profile URLs or @handles to add competitors.'],
        };
      }

      const result = await addCompetitorLinksForWorkspace({
        researchJobId: context.researchJobId,
        links,
      });

      const totalCompetitors = await prisma.discoveredCompetitor.count({
        where: {
          researchJobId: context.researchJobId,
          isActive: true,
        },
      });

      return {
        summary: `Added ${result.added} competitor/inspiration link(s). Workspace competitor library now has ${totalCompetitors} row(s).`,
        added: result.added,
        linksProcessed: links.length,
        artifacts: result.artifacts,
        evidence: result.evidence,
        continuations: [
          {
            type: 'auto_continue',
            reason: 'Competitor list changed; refresh benchmark analysis.',
            suggestedNextTools: ['intel.list', 'evidence.posts', 'orchestration.status'],
          },
        ],
      };
    },
  },
  {
    name: 'research.gather',
    description:
      'Run deeper research for people/accounts/brands mentioned in chat using DDG plus optional Scrapling fetch+crawl.',
    argsSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        text: { type: 'string' },
        brandName: { type: 'string' },
        niche: { type: 'string' },
        handles: { type: 'array', items: { type: 'string' } },
        websites: { type: 'array', items: { type: 'string' } },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'] },
        includeScrapling: { type: 'boolean' },
        includeAccountContext: { type: 'boolean' },
        includeWorkspaceWebsites: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        ddgTotals: { type: 'object' },
        accountContexts: { type: 'array' },
        websitesScanned: { type: 'number' },
        artifacts: { type: 'array' },
        evidence: { type: 'array' },
        warnings: { type: 'array' },
      },
      required: ['summary', 'ddgTotals', 'accountContexts', 'websitesScanned'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const text = String(args.query || args.text || context.userMessage || '').trim();
      const depth = normalizeResearchDepth(args.depth);
      const profile = getDepthProfile(depth);
      const includeScrapling = args.includeScrapling !== false;
      const includeAccountContext = args.includeAccountContext !== false;
      const includeWorkspaceWebsites = args.includeWorkspaceWebsites !== false;
      const warnings: string[] = [];
      const artifacts: Array<{ kind: string; section?: string; id: string }> = [];
      const evidence: Array<{ kind: string; label: string; url?: string }> = [];

      const workspace = await prisma.researchJob.findUnique({
        where: { id: context.researchJobId },
        select: {
          inputData: true,
          client: { select: { name: true } },
        },
      });
      const inputData = asRecord(workspace?.inputData);
      const brandName =
        String(args.brandName || extractBrandName(text) || inputData.name || workspace?.client?.name || '').trim() ||
        'brand';
      const niche = String(args.niche || inputData.niche || inputData.businessType || 'business').trim() || 'business';

      const explicitHandles = Array.isArray(args.handles) ? uniqueStrings(args.handles, 10) : [];
      const handles = uniqueStrings([...explicitHandles, ...extractSocialHandles(text)], 10);

      const explicitWebsites = Array.isArray(args.websites)
        ? uniqueStrings(args.websites, 10)
        : [];
      const discoveredWebsites = uniqueStrings([...extractUrls(text), ...extractDomains(text)], 10);
      const workspaceWebsites = includeWorkspaceWebsites ? extractWorkspaceWebsites(inputData) : [];
      const allWebsites = uniqueStrings([...explicitWebsites, ...discoveredWebsites, ...workspaceWebsites], 10);
      const scrapeWebsites = allWebsites.filter((url) => !isSocialUrl(url)).slice(0, profile.siteLimit);

      const ddgQueries = buildDdgQueries({
        text,
        brandName,
        niche,
        handles,
        websites: allWebsites,
      });

      let ddgTotals = { text: 0, news: 0, videos: 0, images: 0, total: 0 };
      if (depth === 'deep') {
        const gathered = await gatherAllDDG(brandName, niche, context.researchJobId);
        ddgTotals = gathered.totals;
      } else {
        const rawRows = await searchRawDDG(ddgQueries, {
          timeoutMs: depth === 'quick' ? 25_000 : 45_000,
          maxResults: depth === 'quick' ? 40 : 120,
          researchJobId: context.researchJobId,
          source: 'chat_deep_research',
        });
        ddgTotals = {
          text: rawRows.length,
          news: 0,
          videos: 0,
          images: 0,
          total: rawRows.length,
        };
      }

      const accountContexts: Array<Record<string, unknown>> = [];
      if (includeAccountContext) {
        const accountTargets = uniqueStrings([brandName, ...handles], 10).slice(0, profile.accountChecks);
        for (const target of accountTargets) {
          const result = await searchBrandContextDDG(target, context.researchJobId, { timeoutMs: 25_000 });
          accountContexts.push({
            target,
            website: result.website_url,
            instagram: result.instagram_handle,
            tiktok: result.tiktok_handle,
            youtube: result.youtube_channel,
            twitter: result.twitter_handle,
            rawResults: Array.isArray(result.raw_results) ? result.raw_results.length : 0,
            ...(result.error ? { error: result.error } : {}),
          });
        }
      }

      let websitesScanned = 0;
      if (includeScrapling) {
        for (const website of scrapeWebsites) {
          try {
            const fetchResult = await fetchAndPersistWebSnapshot({
              researchJobId: context.researchJobId,
              url: website,
              sourceType: 'OTHER',
              discoveredBy: 'CHAT_TOOL',
              allowExternal: true,
              mode: 'AUTO',
            });
            websitesScanned += 1;
            artifacts.push({ kind: 'web_snapshot', section: 'web_snapshots', id: fetchResult.snapshotId });
            evidence.push({
              kind: 'url',
              label: `Scraped snapshot: ${fetchResult.finalUrl}`,
              url: fetchResult.finalUrl,
            });

            if (depth !== 'quick') {
              const crawl = await crawlAndPersistWebSources({
                researchJobId: context.researchJobId,
                startUrls: [website],
                maxPages: profile.maxPages,
                maxDepth: profile.maxDepth,
                allowExternal: true,
                mode: 'AUTO',
              });
              if (crawl.runId) {
                artifacts.push({ kind: 'crawl_run', section: 'web_snapshots', id: crawl.runId });
              }
              if (Array.isArray(crawl.failures) && crawl.failures.length > 0) {
                warnings.push(...crawl.failures.slice(0, 3));
              }
            }
          } catch (error: any) {
            warnings.push(`Website scan failed for ${website}: ${error?.message || error}`);
          }
        }
      }

      for (const website of allWebsites.slice(0, 8)) {
        evidence.push({ kind: 'url', label: `Research target: ${website}`, url: website });
      }

      return {
        summary: `Deep research completed with ${ddgTotals.total} DDG signal(s), ${accountContexts.length} account context check(s), and ${websitesScanned} website scan(s).`,
        ddgTotals,
        accountContexts,
        websitesScanned,
        artifacts,
        evidence,
        warnings: uniqueStrings(warnings, 10),
        continuations: [
          {
            type: 'auto_continue',
            reason: 'Fresh DDG/Scrapling evidence is available; synthesize findings and cite sources.',
            suggestedNextTools: ['intel.list', 'evidence.posts', 'evidence.news', 'evidence.videos'],
          },
        ],
      };
    },
  },
  {
    name: 'orchestration.run',
    description: 'Run competitor discovery orchestration for the active workspace.',
    argsSchema: {
      type: 'object',
      properties: {
        targetCount: { type: 'number', minimum: 3, maximum: 30 },
        surfaces: {
          type: 'array',
          items: { type: 'string', enum: ['instagram', 'tiktok', 'youtube', 'x', 'web'] },
        },
        mode: { type: 'string', enum: ['append', 'replace'] },
        precision: { type: 'string', enum: ['balanced', 'high'] },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        summary: { type: 'object' },
        platformMatrix: { type: 'object' },
        diagnostics: { type: 'object' },
      },
      required: ['runId', 'summary', 'platformMatrix', 'diagnostics'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const result = await orchestrateCompetitorsForJob(context.researchJobId, {
        targetCount: Number.isFinite(Number(args.targetCount)) ? Number(args.targetCount) : 12,
        surfaces: Array.isArray(args.surfaces) ? (args.surfaces as any) : undefined,
        mode: String(args.mode || 'append') === 'replace' ? 'replace' : 'append',
        precision: String(args.precision || 'balanced') === 'high' ? 'high' : 'balanced',
      });

      return {
        ...result,
        summaryText: `Competitor discovery run ${result.runId} completed with ${result.summary.shortlisted} shortlisted and ${result.summary.topPicks} top picks.`,
        internalLink: context.links.moduleLink('intelligence', {
          intelSection: 'competitors',
        }),
      };
    },
  },
  {
    name: 'orchestration.status',
    description: 'Get the latest competitor orchestration run status and summary for this workspace.',
    argsSchema: {
      type: 'object',
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        found: { type: 'boolean' },
        run: { type: 'object' },
      },
      required: ['found'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context) => {
      const run = await prisma.competitorOrchestrationRun.findFirst({
        where: { researchJobId: context.researchJobId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          phase: true,
          summary: true,
          createdAt: true,
          completedAt: true,
        },
      });

      if (!run) {
        return { found: false };
      }

      return {
        found: true,
        run: {
          id: run.id,
          status: run.status,
          phase: run.phase,
          summary: run.summary,
          createdAt: run.createdAt.toISOString(),
          completedAt: run.completedAt?.toISOString() || null,
        },
      };
    },
  },
];
