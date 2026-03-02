import type { DocumentDataPayload, DocumentPlan } from './document-spec';
import { markdownToRichHtml } from './markdown-renderer';

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
    competitors: 10,
    posts: 12,
    webSnapshots: 8,
    news: 6,
    community: 5,
  },
  deep: {
    competitors: 16,
    posts: 20,
    webSnapshots: 12,
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

  return [
    '## Data Quality And Confidence',
    `- Coverage score: **${coverage.score}/100** (${coverage.band}).`,
    `- Evidence freshness: **${freshness}**.`,
    `- Enrichment applied: **${coverage.enriched ? 'yes' : 'no'}**.`,
    `- Partial draft: **${coverage.partial ? 'yes' : 'no'}**.`,
    '',
    '| Signal | Captured | Target |',
    '| --- | ---: | ---: |',
    ...rows,
    '',
    ...(coverage.reasons.length
      ? ['### Coverage Notes', ...coverage.reasons.map((reason) => `- ${withFallback(reason, 'Coverage note')}`), '']
      : []),
  ];
}

function renderSourceLedger(data: DocumentDataPayload, profile: DepthProfile, includeEvidenceLinks: boolean): string[] {
  const webLines = data.webSnapshots.slice(0, profile.webSnapshots).map((entry) => {
    const url = withLink(withFallback(entry.finalUrl, 'web snapshot'), entry.finalUrl, includeEvidenceLinks);
    const status = entry.statusCode === null ? 'n/a' : String(entry.statusCode);
    return `- ${url} (${status}, ${isoDate(entry.fetchedAt)}).`;
  });

  const newsLines = data.news.slice(0, profile.news).map((entry) => {
    const title = withLink(withFallback(entry.title, 'news item'), entry.url, includeEvidenceLinks);
    return `- ${title} (${withFallback(entry.source, 'source')}, ${isoDate(entry.publishedAt)}).`;
  });

  const communityLines = data.communityInsights.slice(0, profile.community).map((entry) => {
    const source = withFallback(entry.source, 'community source');
    const summary = withFallback(entry.summary, 'Insight captured');
    const linkPart = includeEvidenceLinks ? ` ${withLink('Reference', entry.url, true)}.` : '';
    return `- ${source}: ${summary.slice(0, 180)}.${linkPart}`;
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

function renderStrategyBriefMarkdown(plan: DocumentPlan, data: DocumentDataPayload, title: string): string {
  const depth = normalizeDepth(plan.depth);
  const profile = DEPTH_PROFILE[depth];
  const includeEvidenceLinks = plan.includeEvidenceLinks !== false;

  const topCompetitors = data.competitors.slice(0, profile.competitors);
  const topPosts = data.topPosts.slice(0, profile.posts);
  const topSignals = topPosts
    .slice(0, Math.min(6, profile.posts))
    .map((post) => {
      const engagement = asPositiveNumber(post.likes) + asPositiveNumber(post.comments) + asPositiveNumber(post.shares);
      return `- @${withFallback(post.handle, 'unknown')} (${withFallback(post.platform, 'n/a')}) generated ${engagement} weighted engagements with theme: ${withFallback(post.caption, 'No caption').slice(0, 160)}.`;
    });

  const competitorLines = topCompetitors.map((row) => {
    const relevance =
      row.relevanceScore === null || !Number.isFinite(Number(row.relevanceScore))
        ? 'n/a'
        : Number(row.relevanceScore).toFixed(2);
    const profileLink = withLink(withFallback(row.profileUrl || '', 'Profile'), row.profileUrl, includeEvidenceLinks);
    const reason = row.reason ? ` Reason: ${withFallback(row.reason, 'n/a')}.` : '';
    return `- **@${withFallback(row.handle, 'unknown')}** (${withFallback(row.platform, 'n/a')}): ${withFallback(row.selectionState, 'UNKNOWN')} | relevance ${relevance} | availability ${withFallback(row.availabilityStatus, 'n/a')}. ${profileLink !== 'Profile' ? `${profileLink}.` : ''}${reason}`;
  });

  const postRows = topPosts.map((post) => {
    const engagement = asPositiveNumber(post.likes) + asPositiveNumber(post.comments) + asPositiveNumber(post.shares);
    const link = post.postUrl && includeEvidenceLinks ? post.postUrl : '';
    return `| @${withFallback(post.handle, 'unknown')} | ${withFallback(post.platform, 'n/a')} | ${withFallback(post.caption, 'No caption').slice(0, 170)} | ${engagement} | ${withFallback(link, 'n/a')} |`;
  });

  const quickWins = data.recommendations.quickWins.length
    ? data.recommendations.quickWins
    : ['Build a weekly evidence review ritual and align one campaign objective to each signal cluster.'];
  const days30 = data.recommendations.days30.length
    ? data.recommendations.days30
    : ['Finalize competitor segmentation and lock offer-positioning statements by audience segment.'];
  const days60 = data.recommendations.days60.length
    ? data.recommendations.days60
    : ['Publish and test two content arcs anchored in proven high-engagement topics and CTA patterns.'];
  const days90 = data.recommendations.days90.length
    ? data.recommendations.days90
    : ['Scale winning format-topic pairs and codify a measurable content operating cadence.'];
  const risks = data.recommendations.risks.length
    ? data.recommendations.risks
    : ['Insufficient evidence freshness may reduce confidence in tactical recommendations.'];

  return [
    `# ${withFallback(title, 'Strategy Brief')}`,
    '',
    `Generated: ${withFallback(data.generatedAt, 'unknown')}`,
    '',
    ...(data.coverage.partial
      ? [
          '> Partial draft notice: evidence coverage is below deep-target thresholds. Use "Continue deepening document" to enrich and refine.',
          '',
        ]
      : []),
    '## Executive Summary',
    `- Primary goal: ${withFallback(data.primaryGoal, 'Not specified')}.`,
    `- Audience focus: ${withFallback(data.audience, 'Not specified')} over ${Math.max(7, Number(data.timeframeDays || 0) || 90)} days.`,
    `- Current market confidence: ${data.coverage.band} (${data.coverage.score}/100).`,
    `- Core recommendation: ${withFallback(quickWins[0] || '', 'Run a focused 30/60/90 test plan grounded in current evidence.')}`,
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
    ...(topSignals.length ? topSignals : ['- Insufficient post-level signal density to summarize market dynamics.']),
    '',
    '## Priority Competitor Analysis',
    ...(competitorLines.length ? competitorLines : ['- No shortlisted competitors available yet.']),
    '',
    '## Content Signal Analysis',
    '| Handle | Platform | Signal | Weighted Engagement | Link |',
    '| --- | --- | --- | ---: | --- |',
    ...(postRows.length ? postRows : ['| n/a | n/a | No post evidence available yet. | 0 | n/a |']),
    '',
    '## Strategic Recommendations',
    '### Quick Wins',
    ...quickWins.map((entry) => `- ${withFallback(entry, 'Quick win')}`),
    '',
    '### 30-Day Plan',
    ...days30.map((entry) => `- ${withFallback(entry, '30-day action')}`),
    '',
    '### 60-Day Plan',
    ...days60.map((entry) => `- ${withFallback(entry, '60-day action')}`),
    '',
    '### 90-Day Plan',
    ...days90.map((entry) => `- ${withFallback(entry, '90-day action')}`),
    '',
    '### Risk Watchouts',
    ...risks.map((entry) => `- ${withFallback(entry, 'Risk to monitor')}`),
    '',
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
    const engagement = asPositiveNumber(post.likes) + asPositiveNumber(post.comments) + asPositiveNumber(post.shares);
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
    '## Risk Watchouts',
    ...(data.recommendations.risks.length
      ? data.recommendations.risks.map((entry) => `- ${withFallback(entry, 'Risk')}`)
      : ['- Evidence confidence remains limited for some competitor clusters.']),
    '',
    ...renderSourceLedger(data, profile, includeEvidenceLinks),
  ].join('\n');
}

function renderContentCalendarMarkdown(plan: DocumentPlan, data: DocumentDataPayload, title: string): string {
  const depth = normalizeDepth(plan.depth);
  const profile = DEPTH_PROFILE[depth];
  const includeEvidenceLinks = plan.includeEvidenceLinks !== false;
  const posts = data.topPosts.slice(0, Math.max(7, profile.posts));

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
    ...(data.recommendations.quickWins.length
      ? data.recommendations.quickWins.map((entry) => `- ${withFallback(entry, 'Execution note')}`)
      : ['- Keep hooks specific, visual, and tied to measurable outcomes.']),
    '',
    ...renderSourceLedger(data, profile, includeEvidenceLinks),
  ].join('\n');
}

export function renderDocumentMarkdown(plan: DocumentPlan, payload: DocumentDataPayload, title?: string): string {
  const normalizedTitle =
    withFallback(
      title || '',
      plan.docType === 'COMPETITOR_AUDIT'
        ? 'Competitor Audit'
        : plan.docType === 'CONTENT_CALENDAR'
          ? 'Content Calendar Draft'
          : 'Strategy Brief'
    );

  const markdown =
    plan.docType === 'COMPETITOR_AUDIT'
      ? renderCompetitorAuditMarkdown(plan, payload, normalizedTitle)
      : plan.docType === 'CONTENT_CALENDAR'
        ? renderContentCalendarMarkdown(plan, payload, normalizedTitle)
        : renderStrategyBriefMarkdown(plan, payload, normalizedTitle);

  return `${markdown}\n`;
}

export function renderDocumentHtml(plan: DocumentPlan, payload: DocumentDataPayload): string {
  const markdown = renderDocumentMarkdown(plan, payload);
  return markdownToRichHtml(markdown, { title: payload.clientName ? `${payload.clientName} Document` : 'Document' });
}
