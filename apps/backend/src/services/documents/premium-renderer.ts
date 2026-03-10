import { renderMarkdownFragment } from './markdown-renderer';
import type { RenderTheme, SectionDraft, FactCheckResult } from './premium-document-pipeline';
import type { DocumentDataPayload } from './document-spec';
import type { DocumentSpecV1 } from './document-spec-schema';

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value: string, max = 240): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function extractBulletLines(markdown: string, max = 4): string[] {
  return String(markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function extractLead(markdown: string): string {
  const paragraph = String(markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^[-*#>|]/.test(line));
  return cleanText(paragraph || 'Premium strategy deliverable generated from the latest grounded workspace evidence.', 260);
}

function renderMetaCard(label: string, value: string): string {
  return `<div class="meta-card"><span class="meta-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderNotes(notes: string[], title: string): string {
  const items = notes.map((note) => cleanText(note, 180)).filter(Boolean).slice(0, 4);
  if (!items.length) return '';
  return `
    <aside class="notes-card">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </aside>`;
}

export function renderPremiumDocumentHtml(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  sections: SectionDraft[];
  factCheck: FactCheckResult;
  qualityScore: number;
  qualityNotes: string[];
  theme: RenderTheme;
}): string {
  const generatedAt = String(input.payload.generatedAt || '').trim() || new Date().toISOString();
  const summarySection = input.sections.find((section) => section.kind === 'executive_summary');
  const bullets = extractBulletLines(summarySection?.contentMd || '');
  const lead = extractLead(summarySection?.contentMd || '');
  const factIssues = input.factCheck.issues.slice(0, 4);

  const bodySections = input.sections
    .map((section, index) => {
      const factSection = input.factCheck.sections.find((entry) => entry.id === section.id);
      const detailItems = [
        `${section.evidenceRefIds.length} evidence refs`,
        `${section.source === 'ai' ? 'AI drafted' : 'fallback drafted'}`,
        factSection ? `${Math.round(factSection.confidence * 100)}/100 confidence` : '',
      ].filter(Boolean);
      return `
        <section class="doc-section ${index === 0 ? 'first-section' : ''}" data-kind="${escapeHtml(section.kind)}">
          <div class="section-head">
            <span class="section-kicker">${escapeHtml(section.kind.replace(/_/g, ' '))}</span>
            <h2>${escapeHtml(section.title)}</h2>
            <div class="section-meta">${detailItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
          </div>
          <div class="section-body">${renderMarkdownFragment(section.contentMd)}</div>
          ${renderNotes(section.qualityNotes, 'Section Notes')}
        </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.spec.title)}</title>
  <style>
    @page {
      size: Letter;
      margin: 0.62in 0.64in 0.78in 0.64in;
      @bottom-center {
        content: counter(page);
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 9pt;
        color: #5f6473;
      }
    }
    :root {
      --ink: #172033;
      --muted: #5d6678;
      --line: #d8deea;
      --surface: #f5f7fb;
      --panel: #fbfcfe;
      --accent: ${input.theme.accent};
      --accent-soft: ${input.theme.accentSoft};
      --accent-strong: ${input.theme.accentStrong};
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: var(--ink);
      background: white;
      line-height: 1.58;
      font-size: 11.1pt;
    }
    .page-shell { position: relative; }
    .cover {
      min-height: 9.2in;
      padding: 0.25in 0 0.15in;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-after: always;
    }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 9pt;
      color: var(--accent-strong);
      font-weight: 700;
    }
    .cover h1 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 31pt;
      line-height: 1.05;
      margin: 0.18in 0 0.18in;
      max-width: 6.2in;
    }
    .cover-lead {
      max-width: 5.8in;
      font-size: 13pt;
      color: var(--muted);
      margin-bottom: 0.24in;
    }
    .hero-band {
      background: linear-gradient(135deg, var(--accent-soft), #ffffff 68%);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 0.3in;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.14in;
      margin-top: 0.22in;
    }
    .meta-card {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.88);
      border-radius: 14px;
      padding: 0.14in 0.16in;
      display: flex;
      flex-direction: column;
      gap: 0.04in;
    }
    .meta-label {
      color: var(--muted);
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .summary-list {
      margin: 0.18in 0 0;
      padding-left: 18px;
    }
    .summary-list li { margin: 0 0 7px; }
    .content-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 0.2in;
      border-bottom: 1px solid var(--line);
      padding-bottom: 0.16in;
      margin-bottom: 0.22in;
    }
    .content-header h2 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 15pt;
      margin: 0;
    }
    .quality-chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 9pt;
      color: var(--accent-strong);
      font-weight: 700;
      background: var(--accent-soft);
    }
    .overview-grid {
      display: grid;
      grid-template-columns: 1.8fr 1fr;
      gap: 0.2in;
      margin-bottom: 0.28in;
    }
    .overview-card, .notes-card {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--panel);
      padding: 0.16in 0.18in;
      page-break-inside: avoid;
    }
    .overview-card h3, .notes-card h4 {
      font-family: Georgia, 'Times New Roman', serif;
      margin: 0 0 0.08in;
      font-size: 12.5pt;
    }
    .notes-card ul { margin: 0; padding-left: 18px; }
    .doc-section {
      margin: 0 0 0.26in;
      padding: 0 0 0.18in;
      border-bottom: 1px solid rgba(216, 222, 234, 0.7);
      page-break-inside: avoid;
    }
    .section-head {
      margin-bottom: 0.12in;
    }
    .section-kicker {
      display: inline-block;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 8.5pt;
      color: var(--accent-strong);
      font-weight: 700;
      margin-bottom: 6px;
    }
    .doc-section h2 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 17pt;
      margin: 0;
      line-height: 1.18;
    }
    .section-meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 8px;
      font-size: 8.8pt;
      color: var(--muted);
    }
    .section-body h1, .section-body h2, .section-body h3 { page-break-after: avoid; }
    .section-body p { margin: 0 0 10px; }
    .section-body ul, .section-body ol { margin: 8px 0 12px 20px; padding: 0; }
    .section-body li { margin: 0 0 6px; }
    .section-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 14px;
      font-size: 10pt;
      page-break-inside: avoid;
    }
    .section-body th, .section-body td {
      border: 1px solid var(--line);
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    .section-body th {
      background: var(--surface);
      color: #22314f;
      font-weight: 700;
    }
    .section-body blockquote {
      margin: 12px 0;
      padding: 12px 14px;
      background: var(--accent-soft);
      border-left: 4px solid var(--accent);
      border-radius: 12px;
      color: #23314f;
    }
    .footer-note {
      margin-top: 0.24in;
      font-size: 8.7pt;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <section class="cover">
      <div>
        <div class="eyebrow">${escapeHtml(input.theme.name)}</div>
        <h1>${escapeHtml(input.spec.title)}</h1>
        <p class="cover-lead">${escapeHtml(lead)}</p>
        <div class="hero-band">
          <div class="eyebrow">Executive snapshot</div>
          <ul class="summary-list">
            ${(bullets.length ? bullets : ['Grounded strategy delivered from the latest workspace evidence.', 'Recommendations are tuned for actionability and confidence.', 'Claims were softened where support remained thin.', 'Layout is optimized for client delivery.'])
              .slice(0, 4)
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join('')}
          </ul>
          <div class="hero-grid">
            ${renderMetaCard('Client', input.payload.clientName || 'Workspace')}
            ${renderMetaCard('Family', input.spec.docFamily.replace(/_/g, ' '))}
            ${renderMetaCard('Coverage', `${Math.round(input.payload.coverage.overallScore)}/100`)}
            ${renderMetaCard('Quality', `${Math.round(input.qualityScore)}/100`)}
          </div>
        </div>
      </div>
      <div class="footer-note">Generated ${escapeHtml(generatedAt)}. Audience: ${escapeHtml(input.spec.audience)}. Theme: ${escapeHtml(input.theme.id)}.</div>
    </section>

    <section>
      <div class="content-header">
        <h2>Document Overview</h2>
        <span class="quality-chip">Quality score ${Math.round(input.qualityScore)}/100</span>
      </div>
      <div class="overview-grid">
        <div class="overview-card">
          <h3>What Makes This Deliverable Stronger</h3>
          <p>This document was written, edited, and fact-checked as separate passes so the final output reads like a client deliverable rather than a tool transcript.</p>
          <p>${escapeHtml(cleanText(input.qualityNotes[0] || 'Recommendations were tightened, repetition reduced, and weak claims softened against available evidence.', 260))}</p>
        </div>
        <div>
          ${renderNotes(input.qualityNotes, 'Quality Notes')}
          ${renderNotes(factIssues, 'Fact-Check Notes')}
        </div>
      </div>
      ${bodySections}
    </section>
  </div>
</body>
</html>`;
}

export function renderPremiumMarkdownExportHtml(input: {
  title: string;
  markdown: string;
  generatedAt?: string;
  family?: string;
  coverageScore?: number;
  qualityScore?: number;
  qualityNotes?: string[];
  renderTheme?: string;
}): string {
  const body = renderMarkdownFragment(input.markdown);
  const qualityNotes = (input.qualityNotes || []).map((note) => cleanText(note, 180)).filter(Boolean).slice(0, 4);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    @page {
      size: Letter;
      margin: 0.62in 0.64in 0.78in 0.64in;
      @bottom-center {
        content: counter(page);
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 9pt;
        color: #5f6473;
      }
    }
    :root {
      --ink: #172033;
      --muted: #5d6678;
      --line: #d8deea;
      --surface: #f5f7fb;
      --accent: #3558d6;
      --accent-soft: #edf2ff;
      --accent-strong: #2138a4;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: var(--ink); line-height: 1.58; font-size: 11.1pt; }
    .cover { min-height: 9in; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 9pt; color: var(--accent-strong); font-weight: 700; }
    h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 31pt; line-height: 1.05; margin: 0.16in 0 0.18in; max-width: 6.2in; }
    .lead { max-width: 5.8in; font-size: 13pt; color: var(--muted); margin-bottom: 0.24in; }
    .hero-band, .notes-card { border: 1px solid var(--line); border-radius: 18px; background: var(--surface); padding: 0.2in; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 0.18in; }
    .chip { border: 1px solid var(--line); border-radius: 999px; padding: 7px 12px; background: white; font-size: 9pt; color: var(--accent-strong); }
    .content { border-top: 1px solid var(--line); padding-top: 0.2in; }
    .content h1, .content h2, .content h3 { font-family: Georgia, 'Times New Roman', serif; page-break-after: avoid; }
    .content table { width: 100%; border-collapse: collapse; margin: 12px 0 14px; font-size: 10pt; page-break-inside: avoid; }
    .content th, .content td { border: 1px solid var(--line); padding: 8px; text-align: left; vertical-align: top; }
    .content th { background: var(--surface); color: #22314f; font-weight: 700; }
    .content blockquote { margin: 12px 0; padding: 12px 14px; background: var(--accent-soft); border-left: 4px solid var(--accent); border-radius: 12px; color: #23314f; }
    .content ul, .content ol { margin: 8px 0 12px 20px; padding: 0; }
    .content li { margin: 0 0 6px; }
    .footer-note { margin-top: 0.24in; font-size: 8.7pt; color: var(--muted); }
  </style>
</head>
<body>
  <section class="cover">
    <div>
      <div class="eyebrow">${escapeHtml(input.renderTheme || 'Premium Agency Delivery')}</div>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="lead">Premium export generated from the latest versioned document content with the upgraded print layout system.</p>
      <div class="hero-band">
        <div class="eyebrow">Export snapshot</div>
        <div class="meta-row">
          ${typeof input.coverageScore === 'number' ? `<span class="chip">Coverage ${Math.round(input.coverageScore)}/100</span>` : ''}
          ${typeof input.qualityScore === 'number' ? `<span class="chip">Quality ${Math.round(input.qualityScore)}/100</span>` : ''}
          ${input.family ? `<span class="chip">${escapeHtml(input.family.replace(/_/g, ' '))}</span>` : ''}
        </div>
      </div>
    </div>
    ${
      qualityNotes.length
        ? `<aside class="notes-card"><div class="eyebrow">Quality notes</div><ul>${qualityNotes
            .map((note) => `<li>${escapeHtml(note)}</li>`)
            .join('')}</ul></aside>`
        : ''
    }
    <div class="footer-note">Generated ${escapeHtml(input.generatedAt || new Date().toISOString())}.</div>
  </section>
  <main class="content">
    ${body}
  </main>
</body>
</html>`;
}
