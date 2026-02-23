import type { DocumentDataPayload, DocumentPlan } from './document-spec';
import { renderCompetitorAuditTemplate } from './document-templates/competitor-audit-template';
import { renderStrategyBriefTemplate } from './document-templates/strategy-brief-template';

function renderContentCalendarTemplate(data: DocumentDataPayload): string {
  const rows = data.topPosts.slice(0, 7).map((post, index) => `
    <tr>
      <td>Day ${index + 1}</td>
      <td>@${post.handle}</td>
      <td>${post.caption || 'Draft from top-performing signal'}</td>
      <td>${post.postUrl ? `<a href="${post.postUrl}">Reference</a>` : 'n/a'}</td>
    </tr>
  `).join('');

  return `
    <h1>Content Calendar Draft</h1>
    <p>Generated: ${data.generatedAt} | Audience: ${data.audience}</p>
    <table>
      <thead>
        <tr>
          <th>Slot</th>
          <th>Reference Handle</th>
          <th>Prompt</th>
          <th>Reference</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4">No post references available.</td></tr>'}
      </tbody>
    </table>
  `;
}

function wrapHtml(body: string): string {
  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: "Helvetica Neue", Arial, sans-serif; color: #111827; padding: 28px; }
        h1 { color: #0f172a; margin-bottom: 6px; }
        h2 { margin-top: 24px; color: #1f2937; }
        p, li, td, th { font-size: 13px; line-height: 1.45; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
        th { background: #f3f4f6; }
        ul { margin: 0; padding-left: 18px; }
        a { color: #2563eb; text-decoration: none; }
      </style>
    </head>
    <body>
      ${body}
    </body>
  </html>
  `;
}

export function renderDocumentHtml(plan: DocumentPlan, payload: DocumentDataPayload): string {
  const body =
    plan.docType === 'COMPETITOR_AUDIT'
      ? renderCompetitorAuditTemplate(payload)
      : plan.docType === 'CONTENT_CALENDAR'
        ? renderContentCalendarTemplate(payload)
        : renderStrategyBriefTemplate(payload);
  return wrapHtml(body);
}
