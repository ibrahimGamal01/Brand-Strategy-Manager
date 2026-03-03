import assert from 'node:assert/strict';
import type { DocumentDataPayload, DocumentPlan } from '../services/documents/document-spec';
import { renderDocumentMarkdown } from '../services/documents/document-render';
import { markdownToRichHtml } from '../services/documents/markdown-renderer';

type PayloadOverrides = Partial<Omit<DocumentDataPayload, 'coverage'>> & {
  coverage?: Partial<DocumentDataPayload['coverage']>;
};

function samplePayload(overrides?: PayloadOverrides): DocumentDataPayload {
  const base: DocumentDataPayload = {
    generatedAt: new Date().toISOString(),
    requestedIntent: 'strategy_document',
    renderedIntent: 'strategy_brief',
    clientName: 'ELUUMIS',
    businessType: 'Product business',
    primaryGoal: 'Increase qualified bookings and consultation requests',
    targetMarket: 'English-speaking wellness seekers',
    websiteDomain: 'eluumis.com',
    audience: 'Marketing team',
    timeframeDays: 90,
    competitors: [
      {
        handle: 'quantum__manifestation',
        platform: 'instagram',
        selectionState: 'TOP_PICK',
        relevanceScore: 0.94,
        availabilityStatus: 'VERIFIED',
        profileUrl: 'https://instagram.com/quantum__manifestation/',
        reason: 'From intake form',
      },
      {
        handle: 'giuliadallacostaa',
        platform: 'instagram',
        selectionState: 'TOP_PICK',
        relevanceScore: 0.91,
        availabilityStatus: 'VERIFIED',
        profileUrl: 'https://instagram.com/giuliadallacostaa/',
        reason: 'From intake form',
      },
      {
        handle: 'stephanie_lekkos',
        platform: 'instagram',
        selectionState: 'TOP_PICK',
        relevanceScore: 0.89,
        availabilityStatus: 'VERIFIED',
        profileUrl: 'https://instagram.com/stephanie_lekkos/',
        reason: 'From intake form',
      },
    ],
    topPosts: [
      {
        handle: 'quantum__manifestation',
        platform: 'instagram',
        caption: 'The moment everything quietly changed and calm became the priority.',
        postUrl: 'https://www.instagram.com/p/DU3Htxxknkv/',
        postedAt: new Date().toISOString(),
        likes: 12000,
        comments: 900,
        shares: 600,
        views: 300000,
      },
      {
        handle: 'giuliadallacostaa',
        platform: 'instagram',
        caption: 'People are craving reset rituals that actually fit real life.',
        postUrl: 'https://www.instagram.com/p/DQ3Dzl7Ezcz/',
        postedAt: new Date().toISOString(),
        likes: 9000,
        comments: 700,
        shares: 450,
        views: 170000,
      },
    ],
    webSnapshots: [
      {
        finalUrl: 'https://www.eluumis.com/programs',
        statusCode: 200,
        fetchedAt: new Date().toISOString(),
        snippet: 'Programs page outlining at-home wellness and nervous system regulation.',
        relevanceScore: 0.96,
      },
      {
        finalUrl: 'https://www.eluumis.com/science-meet-spirit',
        statusCode: 200,
        fetchedAt: new Date().toISOString(),
        snippet: 'Brand story blending practical biohacking with spiritual wellness.',
        relevanceScore: 0.93,
      },
    ],
    news: [
      {
        title: 'Wellness category demand rises for guided at-home programs',
        url: 'https://example.com/wellness-demand',
        source: 'Example News',
        publishedAt: new Date().toISOString(),
        snippet: 'Consumers are prioritizing routines that reduce stress and improve sleep.',
        relevanceScore: 0.82,
      },
    ],
    communityInsights: [
      {
        source: 'reddit',
        url: 'https://www.reddit.com/r/wellness/comments/example',
        summary: 'Audience wants practical routines that are easy to stick with weekly.',
        createdAt: new Date().toISOString(),
        relevanceScore: 0.78,
      },
    ],
    coverage: {
      score: 86,
      quantityScore: 84,
      relevanceScore: 88,
      freshnessScore: 94,
      overallScore: 86,
      band: 'strong',
      counts: {
        competitors: 12,
        posts: 18,
        webSnapshots: 10,
        news: 7,
        community: 6,
      },
      targets: {
        competitors: 12,
        posts: 18,
        webSnapshots: 10,
        news: 7,
        community: 6,
      },
      relevance: {
        webSnapshots: 92,
        news: 83,
        community: 79,
        overall: 88,
        dropped: {
          webSnapshots: 0,
          news: 1,
          community: 0,
        },
      },
      freshnessHours: 2,
      blockingReasons: [],
      partialReasons: [],
      reasons: ['Coverage meets current depth and relevance targets.'],
      enriched: true,
      partial: false,
    },
    recommendations: {
      quickWins: [
        'Create two content variants around the top engagement narrative and compare CTA conversion each week.',
      ],
      days30: ['Map three measurable campaign hypotheses and assign KPI owners.'],
      days60: ['Scale the second-best narrative into a weekly recurring series.'],
      days90: ['Operationalize weekly evidence sync and monthly strategy refresh.'],
      risks: ['High engagement can diverge from lead quality; validate against conversion and retention.'],
    },
  };

  return {
    ...base,
    ...overrides,
    coverage: {
      ...base.coverage,
      ...(overrides?.coverage || {}),
      counts: {
        ...base.coverage.counts,
        ...(overrides?.coverage?.counts || {}),
      },
      targets: {
        ...base.coverage.targets,
        ...(overrides?.coverage?.targets || {}),
      },
      relevance: {
        ...base.coverage.relevance,
        ...(overrides?.coverage?.relevance || {}),
        dropped: {
          ...base.coverage.relevance.dropped,
          ...(overrides?.coverage?.relevance?.dropped || {}),
        },
      },
      partialReasons: overrides?.coverage?.partialReasons || base.coverage.partialReasons,
      blockingReasons: overrides?.coverage?.blockingReasons || base.coverage.blockingReasons,
      reasons: overrides?.coverage?.reasons || base.coverage.reasons,
    },
  };
}

function countH2(markdown: string): number {
  return (markdown.match(/^##\s+/gm) || []).length;
}

function assertContainsAll(markdown: string, lines: string[]): void {
  for (const line of lines) {
    assert.ok(markdown.includes(line), `Expected markdown to contain: ${line}`);
  }
}

function runStrategyQualityAssertions(): void {
  const plan: DocumentPlan = {
    docType: 'STRATEGY_BRIEF',
    depth: 'deep',
    includeEvidenceLinks: true,
    includeCompetitors: true,
    audience: 'Marketing team',
    timeframeDays: 90,
  };

  const markdown = renderDocumentMarkdown(plan, samplePayload(), 'ELUUMIS Strategy Brief');
  assert.ok(markdown.startsWith('# ELUUMIS Strategy Brief'));
  assert.ok(countH2(markdown) >= 12, 'Deep strategy brief should include rich multi-section structure.');

  assertContainsAll(markdown, [
    '## Executive Summary',
    '## Data Quality And Confidence',
    '## Market Context',
    '## Competitor Deep Dives',
    '## Content Signal Analysis',
    '## Strategic Implications',
    '## 30/60/90 Action Plan',
    '## Risk Register',
    '## Evidence Gaps And Next Research Actions',
    '## Source Ledger',
    'Quantity score:',
    'Relevance score:',
    'Freshness score:',
  ]);

  const html = markdownToRichHtml(markdown, { title: 'ELUUMIS Strategy Brief' });
  assert.ok(html.includes('<table>'), 'Rendered HTML should preserve markdown tables.');
  assert.ok(html.includes('<h2>Data Quality And Confidence</h2>'));
}

function runSwotFormatAssertions(): void {
  const plan: DocumentPlan = {
    docType: 'SWOT_ANALYSIS',
    depth: 'deep',
    includeEvidenceLinks: true,
    includeCompetitors: true,
    audience: 'Leadership',
    timeframeDays: 90,
    requestedIntent: 'swot_analysis',
  };

  const markdown = renderDocumentMarkdown(
    plan,
    samplePayload({
      requestedIntent: 'swot_analysis',
      renderedIntent: 'swot_analysis',
    }),
    'ELUUMIS SWOT Analysis'
  );

  assert.ok(markdown.startsWith('# ELUUMIS SWOT Analysis'));
  assertContainsAll(markdown, [
    '## SWOT Matrix',
    '## Evidence-Tagged Quadrants',
    '## Prioritized Strategic Implications (Top 5)',
    '## 30/60/90 Action Plan',
    '## Source Ledger',
  ]);
  assert.ok(!markdown.includes('# ELUUMIS Strategy Brief'), 'SWOT request should not silently render as strategy brief.');
}

function runPartialDraftAssertions(): void {
  const plan: DocumentPlan = {
    docType: 'SWOT_ANALYSIS',
    depth: 'deep',
    includeEvidenceLinks: true,
    includeCompetitors: true,
  };

  const markdown = renderDocumentMarkdown(
    plan,
    samplePayload({
      coverage: {
        partial: true,
        score: 51,
        overallScore: 51,
        quantityScore: 48,
        relevanceScore: 58,
        freshnessScore: 65,
        band: 'thin',
        partialReasons: ['Competitor coverage below threshold for confident SWOT threats section.'],
        reasons: ['Competitor coverage below threshold for confident SWOT threats section.'],
      },
    })
  );

  assert.ok(markdown.includes('Partial draft notice:'), 'Partial outputs must be explicitly labeled.');
  assert.ok(markdown.includes('### Partial Reasons'));
}

function runSixFamilyFormatAssertions(): void {
  const payload = samplePayload();

  const playbook = renderDocumentMarkdown(
    {
      docType: 'PLAYBOOK',
      depth: 'standard',
      includeEvidenceLinks: true,
      includeCompetitors: true,
    },
    payload,
    'ELUUMIS Playbook'
  );
  assertContainsAll(playbook, ['## Weekly Cadence', '## KPI Block', '## Source Ledger']);

  const competitorAudit = renderDocumentMarkdown(
    {
      docType: 'COMPETITOR_AUDIT',
      depth: 'deep',
      includeEvidenceLinks: true,
      includeCompetitors: true,
    },
    payload,
    'ELUUMIS Competitor Audit'
  );
  assertContainsAll(competitorAudit, [
    '## Competitor Market Map',
    '## Comparison Table',
    '## Battlecards',
    '## Signal Delta Analysis',
  ]);

  const contentCalendar = renderDocumentMarkdown(
    {
      docType: 'CONTENT_CALENDAR',
      depth: 'standard',
      includeEvidenceLinks: true,
      includeCompetitors: true,
    },
    payload,
    'ELUUMIS Content Calendar'
  );
  assertContainsAll(contentCalendar, ['## Weekly Calendar', '| Date | Slot | Channel |']);

  const goToMarket = renderDocumentMarkdown(
    {
      docType: 'GO_TO_MARKET',
      depth: 'deep',
      includeEvidenceLinks: true,
      includeCompetitors: true,
    },
    payload,
    'ELUUMIS Go-To-Market Plan'
  );
  assertContainsAll(goToMarket, ['## ICP Definition', '## Launch Phases', '## Budget And KPI Tree']);
}

async function runServiceHardeningAssertions(): Promise<void> {
  const moduleRef = (await import('../services/documents/document-service')) as Record<string, unknown>;
  const internals =
    ((moduleRef.__documentServiceInternals as Record<string, unknown> | undefined) ||
      ((moduleRef.default as Record<string, unknown> | undefined)?.__documentServiceInternals as
        | Record<string, unknown>
        | undefined)) ||
    null;
  assert.ok(internals, 'Expected document service internals export for reliability checks.');

  const normalizePlan = internals?.normalizePlan as ((value: Partial<DocumentPlan>) => DocumentPlan) | undefined;
  const buildRelevanceAnchors = internals?.buildRelevanceAnchors as
    | ((value: {
        clientName: string;
        websiteDomain: string;
        workspaceWebsites: string[];
        competitorHandles: string[];
      }) => unknown)
    | undefined;
  const scoreSourceRelevance = internals?.scoreSourceRelevance as
    | ((value: { text: string; url: string; anchors: unknown }) => Record<string, unknown>)
    | undefined;
  assert.ok(normalizePlan && buildRelevanceAnchors && scoreSourceRelevance, 'Missing internal helpers for hardening assertions.');

  const swotNormalized = normalizePlan({
    docType: 'STRATEGY_BRIEF',
    requestedIntent: 'SWOT Analysis',
    depth: 'deep',
  });
  assert.ok(
    swotNormalized.docType === 'SWOT' || swotNormalized.docType === 'SWOT_ANALYSIS',
    'SWOT intent must force SWOT document format.'
  );
  assert.equal(swotNormalized.requestedIntent, 'swot_analysis', 'SWOT intent must be normalized.');

  const anchors = buildRelevanceAnchors({
    clientName: 'ELUUMIS',
    websiteDomain: 'eluumis.com',
    workspaceWebsites: ['eluumis.com'],
    competitorHandles: ['quantum__manifestation'],
  });
  const collisionScore = scoreSourceRelevance({
    text: 'Elemis skincare bundles are trending this week.',
    url: 'https://www.mirror.co.uk/money/elemis-bundles',
    anchors,
  });
  assert.equal(
    collisionScore.hardRejected,
    true,
    'Likely entity-collision evidence should be hard-rejected by relevance guard.'
  );
}

async function main(): Promise<void> {
  runStrategyQualityAssertions();
  runSwotFormatAssertions();
  runPartialDraftAssertions();
  runSixFamilyFormatAssertions();
  await runServiceHardeningAssertions();
  console.log('[Document Generation Quality] Passed.');
}

void main();
