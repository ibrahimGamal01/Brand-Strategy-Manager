import { canonicalDocFamily, type DocType, type DocumentDataPayload, type DocumentPlan } from './document-spec';
import { markdownToRichHtml } from './markdown-renderer';
import { buildDocumentSpecV1 } from './spec-builder';
import { draftDocumentSections } from './section-drafter';
import { renderSwotStandardV1 } from './renderers/swot-standard-v1';
import { renderBusinessStrategyV1 } from './renderers/business-strategy-v1';
import { renderPlaybookV1 } from './renderers/playbook-v1';
import { renderCompetitorAuditV1 } from './renderers/competitor-audit-v1';
import { renderContentCalendarV1 } from './renderers/content-calendar-v1';
import { renderGoToMarketV1 } from './renderers/go-to-market-v1';

type DepthProfile = {
  competitors: number;
  posts: number;
  webSnapshots: number;
  news: number;
  community: number;
};

const DEPTH_PROFILE: Record<'short' | 'standard' | 'deep', DepthProfile> = {
  short: {
    competitors: 6,
    posts: 8,
    webSnapshots: 5,
    news: 4,
    community: 3,
  },
  standard: {
    competitors: 12,
    posts: 14,
    webSnapshots: 8,
    news: 6,
    community: 5,
  },
  deep: {
    competitors: 20,
    posts: 24,
    webSnapshots: 14,
    news: 10,
    community: 8,
  },
};

function normalizeDepth(depth: DocumentPlan['depth'] | undefined): 'short' | 'standard' | 'deep' {
  if (depth === 'short' || depth === 'deep') return depth;
  return 'standard';
}

function cleanInline(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function withFallback(value: string, fallback: string): string {
  const cleaned = cleanInline(value);
  return cleaned || fallback;
}

function asPositiveNumber(value: number | null | undefined): number {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function withLink(label: string, href: string | null, includeEvidenceLinks: boolean): string {
  if (!href || !includeEvidenceLinks) return label;
  const safeHref = cleanInline(href);
  if (!safeHref) return label;
  return `[${label}](${safeHref})`;
}

function isoDate(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return 'n/a';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

function normalizeDocType(plan: DocumentPlan): DocType {
  if (
    plan.docType === 'SWOT' ||
    plan.docType === 'BUSINESS_STRATEGY' ||
    plan.docType === 'PLAYBOOK' ||
    plan.docType === 'COMPETITOR_AUDIT' ||
    plan.docType === 'CONTENT_CALENDAR' ||
    plan.docType === 'GO_TO_MARKET'
  ) {
    return plan.docType;
  }
  if (plan.docType === 'SWOT_ANALYSIS') return 'SWOT_ANALYSIS';
  if (plan.docType === 'CONTENT_CALENDAR_LEGACY') return 'CONTENT_CALENDAR';
  if (plan.docType === 'GTM_PLAN') return 'GO_TO_MARKET';
  return 'STRATEGY_BRIEF';
}

function quoteList(items: string[], fallback: string, max = 5): string[] {
  const unique = Array.from(
    new Set(
      items
        .map((entry) => cleanInline(entry))
        .filter(Boolean)
    )
  );
  if (!unique.length) return [`- ${fallback}`];
  return unique.slice(0, max).map((entry) => `- ${entry}`);
}

function topPostEngagement(post: { likes: number; comments: number; shares: number }): number {
  return asPositiveNumber(post.likes) + asPositiveNumber(post.comments) + asPositiveNumber(post.shares);
}

function renderCoverageSection(data: DocumentDataPayload): string[] {
  const coverage = data.coverage;
  const freshness =
    coverage.freshnessHours === null
      ? 'unknown'
      : `${Math.max(0, Math.round(coverage.freshnessHours))}h since newest evidence`;

  const rows = [
    `| Competitors | ${coverage.counts.competitors} | ${coverage.targets.competitors} |`,
    `| Social posts | ${coverage.counts.posts} | ${coverage.targets.posts} |`,
    `| Web snapshots | ${coverage.counts.webSnapshots} | ${coverage.targets.webSnapshots} |`,
    `| News items | ${coverage.counts.news} | ${coverage.targets.news} |`,
    `| Community insights | ${coverage.counts.community} | ${coverage.targets.community} |`,
  ];

  const diagnostics = [
    `- Quantity score: **${coverage.quantityScore}/100**.`,
    `- Relevance score: **${coverage.relevanceScore}/100**.`,
    `- Freshness score: **${coverage.freshnessScore}/100**.`,
    `- Evidence freshness: **${freshness}**.`,
    `- Enrichment applied: **${coverage.enriched ? 'yes' : 'no'}**.`,
    `- Partial draft: **${coverage.partial ? 'yes' : 'no'}**.`,
  ];

  const relevanceRows = [
    `| Web snapshots | ${coverage.relevance.webSnapshots}/100 | ${coverage.relevance.dropped.webSnapshots} |`,
    `| News | ${coverage.relevance.news}/100 | ${coverage.relevance.dropped.news} |`,
    `| Community | ${coverage.relevance.community}/100 | ${coverage.relevance.dropped.community} |`,
    `| Overall relevance | ${coverage.relevance.overall}/100 | - |`,
  ];

  return [
    '## Data Quality And Confidence',
    `- Coverage score: **${coverage.score}/100** (${coverage.band}).`,
    ...diagnostics,
    '',
    '| Signal | Captured | Target |',
    '| --- | ---: | ---: |',
    ...rows,
    '',
    '| Relevance lane | Score | Filtered out |',
    '| --- | ---: | ---: |',
    ...relevanceRows,
    '',
    ...(coverage.blockingReasons.length
      ? ['### Blocking Reasons', ...coverage.blockingReasons.map((reason) => `- ${withFallback(reason, 'Blocking reason')}`), '']
      : []),
    ...(coverage.partialReasons.length
      ? ['### Partial Reasons', ...coverage.partialReasons.map((reason) => `- ${withFallback(reason, 'Partial reason')}`), '']
      : []),
  ];
}

function renderSourceLedger(data: DocumentDataPayload, profile: DepthProfile, includeEvidenceLinks: boolean): string[] {
  const webLines = data.webSnapshots.slice(0, profile.webSnapshots).map((entry) => {
    const url = withLink(withFallback(entry.finalUrl, 'web snapshot'), entry.finalUrl, includeEvidenceLinks);
    const status = entry.statusCode === null ? 'n/a' : String(entry.statusCode);
    const relevance = Number.isFinite(Number(entry.relevanceScore)) ? ` relevance ${Number(entry.relevanceScore).toFixed(2)}` : '';
    return `- ${url} (${status}, ${isoDate(entry.fetchedAt)}${relevance ? `,${relevance}` : ''}).`;
  });

  const newsLines = data.news.slice(0, profile.news).map((entry) => {
    const title = withLink(withFallback(entry.title, 'news item'), entry.url, includeEvidenceLinks);
    const relevance = Number.isFinite(Number(entry.relevanceScore)) ? ` relevance ${Number(entry.relevanceScore).toFixed(2)}` : '';
    return `- ${title} (${withFallback(entry.source, 'source')}, ${isoDate(entry.publishedAt)}${relevance ? `,${relevance}` : ''}).`;
  });

  const communityLines = data.communityInsights.slice(0, profile.community).map((entry) => {
    const source = withFallback(entry.source, 'community source');
    const summary = withFallback(entry.summary, 'Insight captured');
    const linkPart = includeEvidenceLinks ? ` ${withLink('Reference', entry.url, true)}.` : '';
    const relevance = Number.isFinite(Number(entry.relevanceScore)) ? ` (relevance ${Number(entry.relevanceScore).toFixed(2)})` : '';
    return `- ${source}${relevance}: ${summary.slice(0, 180)}.${linkPart}`;
  });

  return [
    '## Source Ledger',
    '### Web Evidence',
    ...(webLines.length ? webLines : ['- No web snapshots available yet.']),
    '',
    '### News Evidence',
    ...(newsLines.length ? newsLines : ['- No news references captured yet.']),
    '',
    '### Community Evidence',
    ...(communityLines.length ? communityLines : ['- No community references captured yet.']),
    '',
  ];
}

function renderStrategicImplications(data: DocumentDataPayload): string[] {
  const topCompetitor = data.competitors[0];
  const topPost = data.topPosts[0];
  const secondPost = data.topPosts[1];

  const implications = [
    topPost
      ? `Top engagement signal comes from @${withFallback(topPost.handle, 'unknown')}; prioritize this narrative with conversion-specific CTA tests.`
      : 'Primary engagement signal remains unclear; run focused content experiments before scaling spend.',
    topCompetitor
      ? `Closest benchmark is @${withFallback(topCompetitor.handle, 'unknown')} (${withFallback(topCompetitor.platform, 'platform')}); track weekly positioning and offer shifts.`
      : 'Competitor benchmark density is low; expand competitor evidence before finalizing differentiation claims.',
    secondPost
      ? `Secondary signal from @${withFallback(secondPost.handle, 'unknown')} indicates a backup content arc for channel diversification.`
      : 'Current evidence set has limited secondary signal diversity; avoid overfitting a single content pattern.',
    data.coverage.relevanceScore < 65
      ? 'Evidence relevance is moderate/low; treat recommendations as directional until relevance improves.'
      : 'Evidence relevance is strong enough for near-term tactical decisions and controlled scaling.',
    data.coverage.counts.news < Math.max(1, data.coverage.targets.news)
      ? 'News/context coverage is below target; monitor macro shifts weekly to avoid stale assumptions.'
      : 'External context coverage is adequate for the current planning window.',
  ];

  return [
    '## Strategic Implications',
    ...quoteList(implications, 'Insufficient context for implications.', 5),
    '',
  ];
}

function renderActionPlan(recommendations: DocumentDataPayload['recommendations']): string[] {
  return [
    '## 30/60/90 Action Plan',
    '### 30 Days',
    ...quoteList(recommendations.days30, 'Finalize core positioning hypotheses and KPI definitions.', 5),
    '',
    '### 60 Days',
    ...quoteList(recommendations.days60, 'Scale two winning narratives and formalize experiment cadence.', 5),
    '',
    '### 90 Days',
    ...quoteList(recommendations.days90, 'Operationalize monthly strategic refresh and governance.', 5),
    '',
  ];
}

function renderRiskRegister(data: DocumentDataPayload): string[] {
  const risks = [
    ...data.recommendations.risks,
    ...(data.coverage.blockingReasons.length ? data.coverage.blockingReasons : []),
  ];
  return [
    '## Risk Register',
    ...quoteList(risks, 'Evidence freshness and relevance should be revalidated before high-cost decisions.', 8),
    '',
  ];
}

function renderEvidenceGaps(data: DocumentDataPayload): string[] {
  const gaps: string[] = [];
  const targets = data.coverage.targets;
  const counts = data.coverage.counts;

  if (targets.competitors > 0 && counts.competitors < targets.competitors) {
    gaps.push(`Competitor coverage is below target (${counts.competitors}/${targets.competitors}); add verified direct and adjacent competitors.`);
  }
  if (targets.webSnapshots > 0 && counts.webSnapshots < targets.webSnapshots) {
    gaps.push(`Web snapshot coverage is below target (${counts.webSnapshots}/${targets.webSnapshots}); expand owned-site and key offer pages.`);
  }
  if (targets.news > 0 && counts.news < targets.news) {
    gaps.push(`News coverage is below target (${counts.news}/${targets.news}); gather relevant category and brand-specific context.`);
  }
  if (targets.community > 0 && counts.community < targets.community) {
    gaps.push(`Community coverage is below target (${counts.community}/${targets.community}); capture audience sentiment and objections.`);
  }
  if (data.coverage.relevance.dropped.webSnapshots + data.coverage.relevance.dropped.news + data.coverage.relevance.dropped.community > 0) {
    gaps.push('Some evidence rows were excluded by relevance gate to prevent off-scope entity collisions.');
  }

  return [
    '## Evidence Gaps And Next Research Actions',
    ...quoteList(gaps, 'Current evidence set meets target depth for this format.', 8),
    '',
  ];
}

function renderStrategyBriefMarkdown(plan: DocumentPlan, data: DocumentDataPayload, title: string): string {
  const depth = normalizeDepth(plan.depth);
  const profile = DEPTH_PROFILE[depth];
  const includeEvidenceLinks = plan.includeEvidenceLinks !== false;

  const topCompetitors = data.competitors.slice(0, profile.competitors);
  const topPosts = data.topPosts.slice(0, profile.posts);

  const marketSignals = topPosts.slice(0, Math.min(8, profile.posts)).map((post) => {
    const engagement = topPostEngagement(post);
    const link = withLink('source', post.postUrl || null, includeEvidenceLinks);
    return `- @${withFallback(post.handle, 'unknown')} (${withFallback(post.platform, 'n/a')}) generated ${engagement} weighted engagements. Theme: ${withFallback(post.caption, 'No caption').slice(0, 170)}${post.postUrl && includeEvidenceLinks ? ` (${link})` : ''}.`;
  });

  const competitorRows = topCompetitors.map((row) => {
    const relevance =
      row.relevanceScore === null || !Number.isFinite(Number(row.relevanceScore))
        ? 'n/a'
        : Number(row.relevanceScore).toFixed(2);
    const profileLink = withLink(withFallback(row.profileUrl || '', 'Profile'), row.profileUrl, includeEvidenceLinks);
    return `| @${withFallback(row.handle, 'unknown')} | ${withFallback(row.platform, 'n/a')} | ${withFallback(row.selectionState, 'UNKNOWN')} | ${relevance} | ${withFallback(row.availabilityStatus, 'n/a')} | ${profileLink !== 'Profile' ? profileLink : 'n/a'} |`;
  });

  const competitorDeepDives = topCompetitors.slice(0, Math.min(6, topCompetitors.length)).map((row) => {
    const reason = withFallback(row.reason || '', 'No explicit selection reason captured.');
    const profileLink = withLink('Profile', row.profileUrl, includeEvidenceLinks);
    return `- **@${withFallback(row.handle, 'unknown')}** (${withFallback(row.platform, 'n/a')}): ${reason}${row.profileUrl && includeEvidenceLinks ? ` ${profileLink}.` : ''}`;
  });

  const postRows = topPosts.map((post) => {
    const engagement = topPostEngagement(post);
    const link = post.postUrl && includeEvidenceLinks ? post.postUrl : '';
    return `| @${withFallback(post.handle, 'unknown')} | ${withFallback(post.platform, 'n/a')} | ${withFallback(post.caption, 'No caption').slice(0, 170)} | ${engagement} | ${withFallback(link, 'n/a')} |`;
  });

  const quickWins = data.recommendations.quickWins.length
    ? data.recommendations.quickWins
    : ['Run a weekly hypothesis loop tied to the top two evidence-backed content narratives.'];

  return [
    `# ${withFallback(title, 'Strategy Brief')}`,
    '',
    `Generated: ${withFallback(data.generatedAt, 'unknown')}`,
    '',
    ...(data.coverage.partial
      ? [
          '> Partial draft notice: this document returned best-available depth. Use "Continue deepening document" to enrich missing evidence lanes.',
          '',
        ]
      : []),
    '## Executive Summary',
    `- Requested intent: ${withFallback(data.requestedIntent, 'strategy_document')}.`,
    `- Rendered intent: ${withFallback(data.renderedIntent, normalizeDocType(plan).toLowerCase())}.`,
    `- Primary goal: ${withFallback(data.primaryGoal, 'Not specified')}.`,
    `- Audience focus: ${withFallback(data.audience, 'Not specified')} over ${Math.max(7, Number(data.timeframeDays || 0) || 90)} days.`,
    `- Current market confidence: ${data.coverage.band} (${data.coverage.score}/100).`,
    `- Core recommendation: ${withFallback(quickWins[0] || '', 'Prioritize highest-confidence narrative tests tied to conversion outcomes.')}`,
    '',
    '## Business Snapshot',
    `- Client: ${withFallback(data.clientName, 'Unknown')}`,
    `- Business type: ${withFallback(data.businessType, 'Not specified')}`,
    `- Target market: ${withFallback(data.targetMarket, 'Not specified')}`,
    `- Website: ${withFallback(data.websiteDomain, 'Not specified')}`,
    `- Audience: ${withFallback(data.audience, 'Not specified')}`,
    `- Planning window: ${Math.max(7, Number(data.timeframeDays || 0) || 90)} days`,
    '',
    ...renderCoverageSection(data),
    '## Market Context',
    ...(marketSignals.length ? marketSignals : ['- Insufficient post-level signal density to summarize market dynamics.']),
    '',
    '## Competitor Landscape',
    '| Handle | Platform | State | Relevance | Availability | Profile |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...(competitorRows.length ? competitorRows : ['| n/a | n/a | n/a | n/a | n/a | n/a |']),
    '',
    '## Competitor Deep Dives',
    ...(competitorDeepDives.length ? competitorDeepDives : ['- Competitor evidence is currently limited.']),
    '',
    '## Content Signal Analysis',
    '| Handle | Platform | Signal | Weighted Engagement | Link |',
    '| --- | --- | --- | ---: | --- |',
    ...(postRows.length ? postRows : ['| n/a | n/a | No post evidence available yet. | 0 | n/a |']),
    '',
    ...renderStrategicImplications(data),
    ...renderActionPlan(data.recommendations),
    ...renderRiskRegister(data),
    ...renderEvidenceGaps(data),
    ...renderSourceLedger(data, profile, includeEvidenceLinks),
  ].join('\n');
}

function renderSwotQuadrantBullets(input: {
  data: DocumentDataPayload;
  includeEvidenceLinks: boolean;
  limit: number;
}): {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
} {
  const topCompetitors = input.data.competitors.slice(0, input.limit);
  const topPosts = input.data.topPosts.slice(0, input.limit);
  const topNews = input.data.news.slice(0, input.limit);
  const topCommunity = input.data.communityInsights.slice(0, input.limit);

  const strengths = topPosts.slice(0, 5).map((post) => {
    const engagement = topPostEngagement(post);
    const ref = withLink('source', post.postUrl || null, input.includeEvidenceLinks);
    return `Strong engagement pattern around @${withFallback(post.handle, 'unknown')} themes (${engagement} weighted interactions)${post.postUrl && input.includeEvidenceLinks ? ` (${ref})` : ''}.`;
  });

  const weaknesses = [
    ...(input.data.coverage.counts.competitors < input.data.coverage.targets.competitors
      ? [`Competitor evidence depth is below target (${input.data.coverage.counts.competitors}/${input.data.coverage.targets.competitors}), reducing confidence in positioning claims.`]
      : []),
    ...(input.data.coverage.relevanceScore < 65
      ? ['Relevance score is below deep-confidence threshold; additional on-brand evidence is needed before high-stakes commitments.']
      : []),
    ...(input.data.coverage.counts.news < input.data.coverage.targets.news
      ? [`News/context lane is under target (${input.data.coverage.counts.news}/${input.data.coverage.targets.news}).`]
      : []),
  ];

  const opportunities = [
    ...topCommunity.slice(0, 3).map((entry) => {
      const ref = withLink('reference', entry.url || null, input.includeEvidenceLinks);
      return `Community discourse suggests addressable pain points for conversion copy and objections handling${entry.url && input.includeEvidenceLinks ? ` (${ref})` : ''}.`;
    }),
    ...topNews.slice(0, 3).map((entry) => {
      const ref = withLink('source', entry.url || null, input.includeEvidenceLinks);
      return `Category momentum signal from ${withFallback(entry.source, 'news source')}: ${withFallback(entry.title, 'news headline').slice(0, 120)}${entry.url && input.includeEvidenceLinks ? ` (${ref})` : ''}.`;
    }),
  ];

  const threats = [
    ...topCompetitors.slice(0, 4).map((row) => {
      const ref = withLink('profile', row.profileUrl || null, input.includeEvidenceLinks);
      return `Competitive pressure from @${withFallback(row.handle, 'unknown')} (${withFallback(row.platform, 'n/a')}) may compress differentiation if messaging remains generic${row.profileUrl && input.includeEvidenceLinks ? ` (${ref})` : ''}.`;
    }),
    ...(input.data.coverage.freshnessHours !== null && input.data.coverage.freshnessHours > 168
      ? ['Evidence freshness is declining; outdated assumptions can reduce campaign efficacy.']
      : []),
  ];

  return {
    strengths: strengths.length ? strengths.slice(0, 5) : ['Strength signals are currently sparse; gather additional high-performing content examples.'],
    weaknesses: weaknesses.length ? weaknesses.slice(0, 5) : ['No critical internal weakness flagged from current evidence set.'],
    opportunities: opportunities.length ? opportunities.slice(0, 5) : ['Opportunity signals are limited; enrich community and category inputs.'],
    threats: threats.length ? threats.slice(0, 5) : ['Threat signals are limited; expand competitor and market monitoring cadence.'],
  };
}

function renderSwotMarkdown(plan: DocumentPlan, data: DocumentDataPayload, title: string): string {
  const depth = normalizeDepth(plan.depth);
  const profile = DEPTH_PROFILE[depth];
  const includeEvidenceLinks = plan.includeEvidenceLinks !== false;
  const quadrants = renderSwotQuadrantBullets({
    data,
    includeEvidenceLinks,
    limit: Math.max(6, profile.posts),
  });

  const implications = [
    'Use strengths-led messaging as the default creative baseline, then pressure-test against weakest funnel stage.',
    'Treat weaknesses as priority backlog items before scaling budget aggressively.',
    'Convert opportunities into 30/60/90 experiments with explicit KPI ownership.',
    'Mitigate threats through weekly competitor and relevance checks in Docs workspace.',
    'Maintain evidence ledger discipline to keep SWOT claims auditable.',
  ];

  return [
    `# ${withFallback(title, 'SWOT Analysis')}`,
    '',
    `Generated: ${withFallback(data.generatedAt, 'unknown')}`,
    '',
    ...(data.coverage.partial
      ? [
          '> Partial draft notice: SWOT produced with best-available evidence. Continue deepening to increase confidence before external distribution.',
          '',
        ]
      : []),
    '## Executive Summary',
    `- Requested intent: ${withFallback(data.requestedIntent, 'swot_analysis')}.`,
    `- Rendered intent: ${withFallback(data.renderedIntent, 'swot_analysis')}.`,
    `- Coverage confidence: ${data.coverage.band} (${data.coverage.score}/100).`,
    `- Priority objective: ${withFallback(data.primaryGoal, 'Not specified')}.`,
    '',
    ...renderCoverageSection(data),
    '## SWOT Matrix',
    '| Strengths | Weaknesses |',
    '| --- | --- |',
    `| ${quadrants.strengths.map((entry) => withFallback(entry, 'Strength')).join('<br/>')} | ${quadrants.weaknesses.map((entry) => withFallback(entry, 'Weakness')).join('<br/>')} |`,
    '',
    '| Opportunities | Threats |',
    '| --- | --- |',
    `| ${quadrants.opportunities.map((entry) => withFallback(entry, 'Opportunity')).join('<br/>')} | ${quadrants.threats.map((entry) => withFallback(entry, 'Threat')).join('<br/>')} |`,
    '',
    '## Evidence-Tagged Quadrants',
    '### Strengths',
    ...quoteList(quadrants.strengths, 'Strength evidence is limited.', 5),
    '',
    '### Weaknesses',
    ...quoteList(quadrants.weaknesses, 'Weakness evidence is limited.', 5),
    '',
    '### Opportunities',
    ...quoteList(quadrants.opportunities, 'Opportunity evidence is limited.', 5),
    '',
    '### Threats',
    ...quoteList(quadrants.threats, 'Threat evidence is limited.', 5),
    '',
    '## Prioritized Strategic Implications (Top 5)',
    ...quoteList(implications, 'Implications pending additional evidence.', 5),
    '',
    ...renderActionPlan(data.recommendations),
    ...renderRiskRegister(data),
    ...renderEvidenceGaps(data),
    ...renderSourceLedger(data, profile, includeEvidenceLinks),
  ].join('\n');
}

function renderCompetitorAuditMarkdown(plan: DocumentPlan, data: DocumentDataPayload, title: string): string {
  const depth = normalizeDepth(plan.depth);
  const profile = DEPTH_PROFILE[depth];
  const includeEvidenceLinks = plan.includeEvidenceLinks !== false;
  const competitors = data.competitors.slice(0, profile.competitors);
  const posts = data.topPosts.slice(0, profile.posts);

  const competitorRows = competitors.map((row) => {
    const relevance =
      row.relevanceScore === null || !Number.isFinite(Number(row.relevanceScore))
        ? 'n/a'
        : Number(row.relevanceScore).toFixed(2);
    const profileLink = row.profileUrl && includeEvidenceLinks ? row.profileUrl : '';
    return `| @${withFallback(row.handle, 'unknown')} | ${withFallback(row.platform, 'n/a')} | ${withFallback(row.selectionState, 'UNKNOWN')} | ${relevance} | ${withFallback(row.availabilityStatus, 'n/a')} | ${withFallback(profileLink, 'n/a')} |`;
  });

  const postRows = posts.map((post) => {
    const engagement = topPostEngagement(post);
    const link = post.postUrl && includeEvidenceLinks ? post.postUrl : '';
    return `| @${withFallback(post.handle, 'unknown')} | ${withFallback(post.platform, 'n/a')} | ${withFallback(post.caption, 'No caption').slice(0, 160)} | ${engagement} | ${withFallback(link, 'n/a')} |`;
  });

  return [
    `# ${withFallback(title, 'Competitor Audit')}`,
    '',
    `Generated: ${withFallback(data.generatedAt, 'unknown')}`,
    '',
    ...renderCoverageSection(data),
    '## Competitive Landscape',
    '| Handle | Platform | State | Relevance | Availability | Profile |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...(competitorRows.length ? competitorRows : ['| n/a | n/a | n/a | n/a | n/a | n/a |']),
    '',
    '## Evidence Posts',
    '| Handle | Platform | Caption | Engagement | Link |',
    '| --- | --- | --- | ---: | --- |',
    ...(postRows.length ? postRows : ['| n/a | n/a | No evidence posts available. | 0 | n/a |']),
    '',
    ...renderRiskRegister(data),
    ...renderEvidenceGaps(data),
    ...renderSourceLedger(data, profile, includeEvidenceLinks),
  ].join('\n');
}

function renderContentCalendarMarkdown(plan: DocumentPlan, data: DocumentDataPayload, title: string): string {
  const depth = normalizeDepth(plan.depth);
  const profile = DEPTH_PROFILE[depth];
  const includeEvidenceLinks = plan.includeEvidenceLinks !== false;
  const posts = data.topPosts.slice(0, Math.max(10, profile.posts));

  const rows = posts.map((post, index) => {
    const link = post.postUrl && includeEvidenceLinks ? post.postUrl : '';
    return `| Day ${index + 1} | @${withFallback(post.handle, 'unknown')} | ${withFallback(post.caption, 'Draft from top-performing signal').slice(0, 140)} | ${withFallback(link, 'n/a')} |`;
  });

  return [
    `# ${withFallback(title, 'Content Calendar Draft')}`,
    '',
    `Generated: ${withFallback(data.generatedAt, 'unknown')}`,
    '',
    ...renderCoverageSection(data),
    '## Recommended Calendar Slots',
    '| Slot | Reference Handle | Prompt | Reference |',
    '| --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| Day 1 | n/a | No post references available. | n/a |']),
    '',
    '## Execution Notes',
    ...quoteList(data.recommendations.quickWins, 'Keep hooks specific, visual, and tied to measurable outcomes.', 6),
    '',
    ...renderEvidenceGaps(data),
    ...renderSourceLedger(data, profile, includeEvidenceLinks),
  ].join('\n');
}

export function renderDocumentMarkdown(plan: DocumentPlan, payload: DocumentDataPayload, title?: string): string {
  const docType = normalizeDocType(plan);
  const docFamily = canonicalDocFamily(plan.docType);
  const normalizedTitle = withFallback(
    title || '',
    docType === 'PLAYBOOK'
      ? 'Playbook'
      : docType === 'BUSINESS_STRATEGY'
        ? 'Business Strategy'
        : docType === 'COMPETITOR_AUDIT'
          ? 'Competitor Audit'
          : docType === 'CONTENT_CALENDAR'
            ? 'Content Calendar Draft'
            : docType === 'GO_TO_MARKET'
              ? 'Go-To-Market Plan'
              : docType === 'SWOT_ANALYSIS'
                ? 'SWOT Analysis'
                : docType === 'SWOT'
                  ? 'SWOT Analysis'
                  : 'Strategy Brief'
  );

  try {
    const specResult = buildDocumentSpecV1({
      plan: {
        ...plan,
        title: normalizedTitle,
      },
      payload,
      title: normalizedTitle,
      docFamily,
    });
    const drafted = draftDocumentSections({
      spec: specResult.spec,
      payload,
    });

    const markdownFromSpec =
      specResult.spec.docFamily === 'SWOT'
        ? renderSwotStandardV1({
            spec: specResult.spec,
            payload,
            sections: drafted.sections,
          })
        : specResult.spec.docFamily === 'PLAYBOOK'
          ? renderPlaybookV1({
              spec: specResult.spec,
              payload,
              sections: drafted.sections,
            })
          : specResult.spec.docFamily === 'COMPETITOR_AUDIT'
            ? renderCompetitorAuditV1({
                spec: specResult.spec,
                payload,
                sections: drafted.sections,
              })
            : specResult.spec.docFamily === 'CONTENT_CALENDAR'
              ? renderContentCalendarV1({
                  spec: specResult.spec,
                  payload,
                  sections: drafted.sections,
                })
              : specResult.spec.docFamily === 'GO_TO_MARKET'
                ? renderGoToMarketV1({
                    spec: specResult.spec,
                    payload,
                    sections: drafted.sections,
                  })
                : renderBusinessStrategyV1({
                    spec: specResult.spec,
                    payload,
                    sections: drafted.sections,
                  });

    return `${markdownFromSpec}\n`;
  } catch {
    // Keep the legacy deterministic path as a resilient fallback.
  }

  const markdown =
    docType === 'COMPETITOR_AUDIT'
      ? renderCompetitorAuditMarkdown(plan, payload, normalizedTitle)
      : docType === 'CONTENT_CALENDAR' || docType === 'PLAYBOOK'
        ? renderContentCalendarMarkdown(plan, payload, normalizedTitle)
        : docType === 'GO_TO_MARKET'
          ? renderStrategyBriefMarkdown(plan, payload, normalizedTitle)
        : docType === 'SWOT_ANALYSIS' || docType === 'SWOT'
          ? renderSwotMarkdown(plan, payload, normalizedTitle)
          : renderStrategyBriefMarkdown(plan, payload, normalizedTitle);

  return `${markdown}\n`;
}

export function renderDocumentHtml(plan: DocumentPlan, payload: DocumentDataPayload): string {
  const markdown = renderDocumentMarkdown(plan, payload);
  return markdownToRichHtml(markdown, { title: payload.clientName ? `${payload.clientName} Document` : 'Document' });
}
