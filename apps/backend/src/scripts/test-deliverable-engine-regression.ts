import assert from 'node:assert/strict';
import {
  canonicalDocFamily,
  type DocumentDataPayload,
  type DocumentPlan,
} from '../services/documents/document-spec';
import { buildDocumentSpecV1 } from '../services/documents/spec-builder';
import { draftDocumentSections } from '../services/documents/section-drafter';
import { renderDocumentMarkdown } from '../services/documents/document-render';
import { normalizeRuntimeEventV2 } from '../services/chat/runtime/event-contract';

function samplePayload(): DocumentDataPayload {
  return {
    generatedAt: new Date().toISOString(),
    requestedIntent: 'business_strategy',
    renderedIntent: 'business_strategy_v1',
    clientName: 'ELUUMIS',
    businessType: 'Wellness brand',
    primaryGoal: 'Increase qualified inbound leads',
    targetMarket: 'English-speaking wellness seekers',
    websiteDomain: 'eluumis.com',
    audience: 'Marketing team',
    timeframeDays: 90,
    competitors: [
      {
        handle: 'wellness_competitor_one',
        platform: 'instagram',
        selectionState: 'TOP_PICK',
        relevanceScore: 0.91,
        availabilityStatus: 'VERIFIED',
        profileUrl: 'https://instagram.com/wellness_competitor_one',
        reason: 'Direct overlap in offer category',
      },
      {
        handle: 'wellness_competitor_two',
        platform: 'instagram',
        selectionState: 'SHORTLISTED',
        relevanceScore: 0.83,
        availabilityStatus: 'VERIFIED',
        profileUrl: 'https://instagram.com/wellness_competitor_two',
        reason: 'Similar audience intent',
      },
    ],
    topPosts: [
      {
        handle: 'wellness_competitor_one',
        platform: 'instagram',
        caption: 'Daily nervous-system reset ritual for busy founders.',
        postUrl: 'https://instagram.com/p/example-post-1',
        postedAt: new Date().toISOString(),
        likes: 1120,
        comments: 82,
        shares: 44,
        views: 0,
      },
      {
        handle: 'wellness_competitor_two',
        platform: 'instagram',
        caption: 'Simple three-step routine to reduce stress in under 10 minutes.',
        postUrl: 'https://instagram.com/p/example-post-2',
        postedAt: new Date().toISOString(),
        likes: 980,
        comments: 61,
        shares: 33,
        views: 0,
      },
    ],
    webSnapshots: [
      {
        finalUrl: 'https://www.eluumis.com/programs',
        statusCode: 200,
        fetchedAt: new Date().toISOString(),
        snippet: 'Programs page with primary offer framing.',
        relevanceScore: 0.95,
      },
      {
        finalUrl: 'https://www.eluumis.com/science-meet-spirit',
        statusCode: 200,
        fetchedAt: new Date().toISOString(),
        snippet: 'Science-backed positioning page.',
        relevanceScore: 0.93,
      },
    ],
    news: [
      {
        title: 'Wellness category growth continues in 2026',
        url: 'https://example.com/news/wellness-growth-2026',
        source: 'Example News',
        publishedAt: new Date().toISOString(),
        snippet: 'Consumers continue prioritizing practical self-care formats.',
        relevanceScore: 0.82,
      },
    ],
    communityInsights: [
      {
        source: 'reddit',
        url: 'https://reddit.com/r/wellness/comments/example',
        summary: 'Users ask for simple repeatable routines they can sustain.',
        createdAt: new Date().toISOString(),
        relevanceScore: 0.79,
      },
    ],
    coverage: {
      score: 81,
      quantityScore: 80,
      relevanceScore: 84,
      freshnessScore: 93,
      overallScore: 81,
      band: 'strong',
      counts: {
        competitors: 10,
        posts: 14,
        webSnapshots: 9,
        news: 6,
        community: 5,
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
        news: 84,
        community: 78,
        overall: 84,
        dropped: {
          webSnapshots: 1,
          news: 0,
          community: 0,
        },
      },
      freshnessHours: 2,
      blockingReasons: [],
      partialReasons: ['Competitor coverage below deep target.'],
      reasons: ['Competitor coverage below deep target.'],
      enriched: true,
      partial: true,
    },
    recommendations: {
      quickWins: ['Run two CTA variants on the strongest signal each week.'],
      days30: ['Define three measurable campaign hypotheses.'],
      days60: ['Scale the top-performing narrative into weekly cadence.'],
      days90: ['Operationalize monthly strategy refresh with evidence checkpoints.'],
      risks: ['Engagement can diverge from lead quality if CTAs are weak.'],
    },
  };
}

function runSpecAssertions() {
  const payload = samplePayload();
  const swotPlan: DocumentPlan = { docType: 'SWOT', depth: 'deep', audience: 'Leadership' };
  const swotSpec = buildDocumentSpecV1({ plan: swotPlan, payload, title: 'ELUUMIS SWOT' });
  assert.equal(swotSpec.spec.docFamily, 'SWOT');
  assert.ok(swotSpec.spec.sections.some((section) => section.kind === 'swot_matrix'));

  const strategyPlan: DocumentPlan = { docType: 'BUSINESS_STRATEGY', depth: 'deep', audience: 'Marketing team' };
  const strategySpec = buildDocumentSpecV1({ plan: strategyPlan, payload, title: 'ELUUMIS Strategy' });
  assert.equal(strategySpec.spec.docFamily, 'BUSINESS_STRATEGY');
  assert.ok(strategySpec.spec.sections.some((section) => section.kind === 'competitor_deep_dive'));

  const playbookPlan: DocumentPlan = { docType: 'PLAYBOOK', depth: 'standard', audience: 'Marketing team' };
  const playbookSpec = buildDocumentSpecV1({ plan: playbookPlan, payload, title: 'ELUUMIS Playbook' });
  assert.equal(playbookSpec.spec.docFamily, 'PLAYBOOK');
  assert.ok(playbookSpec.spec.sections.some((section) => section.kind === 'playbook_cadence'));

  const competitorAuditPlan: DocumentPlan = { docType: 'COMPETITOR_AUDIT', depth: 'deep', audience: 'Marketing team' };
  const competitorAuditSpec = buildDocumentSpecV1({
    plan: competitorAuditPlan,
    payload,
    title: 'ELUUMIS Competitor Audit',
  });
  assert.equal(competitorAuditSpec.spec.docFamily, 'COMPETITOR_AUDIT');
  assert.ok(competitorAuditSpec.spec.sections.some((section) => section.kind === 'competitor_comparison_table'));

  const contentCalendarPlan: DocumentPlan = { docType: 'CONTENT_CALENDAR', depth: 'standard', audience: 'Marketing team' };
  const contentCalendarSpec = buildDocumentSpecV1({
    plan: contentCalendarPlan,
    payload,
    title: 'ELUUMIS Content Calendar',
  });
  assert.equal(contentCalendarSpec.spec.docFamily, 'CONTENT_CALENDAR');
  assert.ok(contentCalendarSpec.spec.sections.some((section) => section.kind === 'content_calendar_slots'));

  const goToMarketPlan: DocumentPlan = { docType: 'GO_TO_MARKET', depth: 'deep', audience: 'Leadership' };
  const goToMarketSpec = buildDocumentSpecV1({
    plan: goToMarketPlan,
    payload,
    title: 'ELUUMIS GTM Plan',
  });
  assert.equal(goToMarketSpec.spec.docFamily, 'GO_TO_MARKET');
  assert.ok(goToMarketSpec.spec.sections.some((section) => section.kind === 'launch_phases'));

  assert.equal(canonicalDocFamily('SWOT_ANALYSIS'), 'SWOT');
  assert.equal(canonicalDocFamily('STRATEGY_BRIEF'), 'BUSINESS_STRATEGY');
  assert.equal(canonicalDocFamily('PLAYBOOK'), 'PLAYBOOK');
  assert.equal(canonicalDocFamily('COMPETITOR_AUDIT'), 'COMPETITOR_AUDIT');
  assert.equal(canonicalDocFamily('CONTENT_CALENDAR'), 'CONTENT_CALENDAR');
  assert.equal(canonicalDocFamily('CONTENT_CALENDAR_LEGACY'), 'CONTENT_CALENDAR');
  assert.equal(canonicalDocFamily('GO_TO_MARKET'), 'GO_TO_MARKET');
  assert.equal(canonicalDocFamily('GTM_PLAN'), 'GO_TO_MARKET');
}

function runDraftAssertions() {
  const payload = samplePayload();
  const plan: DocumentPlan = { docType: 'SWOT', depth: 'deep', audience: 'Leadership' };
  const spec = buildDocumentSpecV1({ plan, payload, title: 'ELUUMIS SWOT' }).spec;
  const draft = draftDocumentSections({ spec, payload });

  assert.ok(draft.sections.length >= 6, 'Draft should include multiple structured sections.');
  assert.ok(
    draft.sections.some((section) => section.kind === 'swot_matrix' && section.contentMd.includes('| Strengths | Weaknesses |')),
    'SWOT draft must include matrix table.'
  );

  const calendarSpec = buildDocumentSpecV1({
    plan: { docType: 'CONTENT_CALENDAR', depth: 'standard', audience: 'Marketing team' },
    payload,
    title: 'ELUUMIS Calendar',
  }).spec;
  const calendarDraft = draftDocumentSections({ spec: calendarSpec, payload });
  assert.ok(
    calendarDraft.sections.some(
      (section) =>
        section.kind === 'content_calendar_slots' &&
        section.contentMd.includes('| Date | Slot | Channel |')
    ),
    'Content calendar draft must include a dated cadence table.'
  );
}

function runRendererAssertions() {
  const payload = samplePayload();
  const swotMarkdown = renderDocumentMarkdown(
    { docType: 'SWOT', depth: 'deep', audience: 'Leadership', requestedIntent: 'swot_analysis' },
    payload,
    'ELUUMIS SWOT Analysis'
  );
  assert.ok(swotMarkdown.includes('## SWOT Matrix'));
  assert.ok(swotMarkdown.includes('| Strengths | Weaknesses |'));

  const strategyMarkdown = renderDocumentMarkdown(
    { docType: 'BUSINESS_STRATEGY', depth: 'deep', audience: 'Marketing team' },
    payload,
    'ELUUMIS Business Strategy'
  );
  assert.ok(strategyMarkdown.includes('## Competitor Deep Dives'));
  assert.ok(strategyMarkdown.includes('## 30/60/90 Action Plan'));

  const playbookMarkdown = renderDocumentMarkdown(
    { docType: 'PLAYBOOK', depth: 'standard', audience: 'Marketing team' },
    payload,
    'ELUUMIS Playbook'
  );
  assert.ok(playbookMarkdown.includes('## Weekly Cadence'));
  assert.ok(playbookMarkdown.includes('## KPI Block'));

  const competitorAuditMarkdown = renderDocumentMarkdown(
    { docType: 'COMPETITOR_AUDIT', depth: 'deep', audience: 'Marketing team' },
    payload,
    'ELUUMIS Competitor Audit'
  );
  assert.ok(competitorAuditMarkdown.includes('## Competitor Market Map'));
  assert.ok(competitorAuditMarkdown.includes('## Comparison Table'));

  const contentCalendarMarkdown = renderDocumentMarkdown(
    { docType: 'CONTENT_CALENDAR', depth: 'standard', audience: 'Marketing team' },
    payload,
    'ELUUMIS Content Calendar'
  );
  assert.ok(contentCalendarMarkdown.includes('## Weekly Calendar'));
  assert.ok(contentCalendarMarkdown.includes('| Date | Slot | Channel |'));

  const goToMarketMarkdown = renderDocumentMarkdown(
    { docType: 'GO_TO_MARKET', depth: 'deep', audience: 'Leadership' },
    payload,
    'ELUUMIS Go-To-Market Plan'
  );
  assert.ok(goToMarketMarkdown.includes('## Launch Phases'));
  assert.ok(goToMarketMarkdown.includes('## Budget And KPI Tree'));
}

function runEventContractAssertions() {
  const event = normalizeRuntimeEventV2({
    type: 'PROCESS_LOG',
    level: 'INFO',
    message: 'Document spec built.',
    payloadJson: {
      eventV2: {
        version: 2,
        event: 'document.spec_built',
        phase: 'planning',
        status: 'info',
      },
    },
  });

  assert.equal(event.event, 'document.spec_built');
  assert.equal(event.phase, 'planning');
}

function main() {
  runSpecAssertions();
  runDraftAssertions();
  runRendererAssertions();
  runEventContractAssertions();
  console.log('PASS test-deliverable-engine-regression');
}

main();
