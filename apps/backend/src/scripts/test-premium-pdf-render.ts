import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { DocumentDataPayload, DocumentPlan } from '../services/documents/document-spec';
import { buildDocumentSpecV1 } from '../services/documents/spec-builder';
import { draftDocumentSections } from '../services/documents/section-drafter';
import { evaluatePremiumDocumentQuality } from '../services/documents/premium-document-pipeline';
import { renderPremiumDocumentHtml } from '../services/documents/premium-renderer';
import { renderPdfFromHtml } from '../services/documents/pdf-renderer';

const execFile = promisify(execFileCb);

function samplePayload(): DocumentDataPayload {
  return {
    generatedAt: new Date().toISOString(),
    requestedIntent: 'business_strategy',
    renderedIntent: 'business_strategy_v2',
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
    ],
    webSnapshots: [
      {
        finalUrl: 'https://www.eluumis.com/programs',
        statusCode: 200,
        fetchedAt: new Date().toISOString(),
        snippet: 'Programs page with primary offer framing.',
        relevanceScore: 0.95,
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
      counts: { competitors: 10, posts: 14, webSnapshots: 9, news: 6, community: 5 },
      targets: { competitors: 12, posts: 18, webSnapshots: 10, news: 7, community: 6 },
      relevance: {
        webSnapshots: 92,
        news: 84,
        community: 78,
        overall: 84,
        dropped: { webSnapshots: 1, news: 0, community: 0 },
      },
      freshnessHours: 2,
      blockingReasons: [],
      partialReasons: [],
      reasons: ['Coverage meets current depth and relevance targets.'],
      enriched: true,
      partial: false,
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

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFile('sh', ['-lc', `command -v ${name}`]);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const payload = samplePayload();
  const plan: DocumentPlan = {
    docType: 'BUSINESS_STRATEGY',
    depth: 'deep',
    includeEvidenceLinks: true,
    includeCompetitors: true,
    audience: 'Marketing team',
  };
  const spec = buildDocumentSpecV1({ plan, payload, title: 'ELUUMIS Strategy Brief' }).spec;
  const sections = draftDocumentSections({ spec, payload }).sections.map((section) => ({
    ...section,
    source: 'fallback' as const,
    qualityNotes: [],
    claimBullets: [],
  }));
  const factCheck = {
    pass: true,
    issues: [],
    sections: sections.map((section) => ({
      id: section.id,
      status: 'pass' as const,
      contentMd: section.contentMd,
      notes: [],
      confidence: 0.84,
    })),
  };
  const initialHtml = renderPremiumDocumentHtml({
    spec,
    payload,
    sections,
    factCheck,
    qualityScore: 84,
    qualityNotes: ['Rendered through the premium theme.'],
    theme: {
      id: 'premium_agency_v1',
      name: 'Premium Agency Delivery',
      accent: '#3558d6',
      accentSoft: '#edf2ff',
      accentStrong: '#2138a4',
    },
  });
  const quality = evaluatePremiumDocumentQuality({
    spec,
    payload,
    sections,
    factCheck,
    html: initialHtml,
  });
  const html = renderPremiumDocumentHtml({
    spec,
    payload,
    sections,
    factCheck,
    qualityScore: quality.score,
    qualityNotes: quality.notes,
    theme: {
      id: 'premium_agency_v1',
      name: 'Premium Agency Delivery',
      accent: '#3558d6',
      accentSoft: '#edf2ff',
      accentStrong: '#2138a4',
    },
  });
  const pdf = await renderPdfFromHtml(html);
  assert.ok(pdf.length > 10_000, 'Premium PDF should render a non-trivial artifact.');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'premium-pdf-'));
  const pdfPath = path.join(tmpDir, 'strategy.pdf');
  await fs.writeFile(pdfPath, pdf);

  if (!(await commandExists('pdftoppm'))) {
    console.log('[Premium PDF Render] Skipped PNG conversion because pdftoppm is not installed.');
    return;
  }

  const outputPrefix = path.join(tmpDir, 'strategy-page');
  await execFile('pdftoppm', ['-png', pdfPath, outputPrefix]);
  const files = await fs.readdir(tmpDir);
  const pngs = files.filter((file) => file.endsWith('.png'));
  assert.ok(pngs.length >= 1, 'Expected at least one PNG page from premium PDF render.');
  console.log('[Premium PDF Render] Passed.');
}

void main();
