import type { DocumentDataPayload } from '../document-spec';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCompetitorAuditTemplate(data: DocumentDataPayload): string {
  const competitorRows = data.competitors
    .slice(0, 15)
    .map((row) => {
      const profileLink = row.profileUrl
        ? `<a href="${escapeHtml(row.profileUrl)}" target="_blank" rel="noreferrer">Profile</a>`
        : 'n/a';
      return `
        <tr>
          <td>@${escapeHtml(row.handle)}</td>
          <td>${escapeHtml(row.platform)}</td>
          <td>${escapeHtml(row.selectionState)}</td>
          <td>${row.relevanceScore === null ? 'n/a' : row.relevanceScore.toFixed(2)}</td>
          <td>${escapeHtml(row.availabilityStatus)}</td>
          <td>${profileLink}</td>
        </tr>
      `;
    })
    .join('');

  const evidenceRows = data.topPosts
    .slice(0, 10)
    .map((row) => {
      const link = row.postUrl
        ? `<a href="${escapeHtml(row.postUrl)}" target="_blank" rel="noreferrer">Open</a>`
        : 'n/a';
      const caption = escapeHtml(row.caption || 'No caption').slice(0, 180);
      return `
        <tr>
          <td>@${escapeHtml(row.handle)}</td>
          <td>${escapeHtml(row.platform)}</td>
          <td>${caption}</td>
          <td>${row.likes + row.comments + row.shares}</td>
          <td>${link}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <h1>Competitor Audit</h1>
    <p>Generated: ${escapeHtml(data.generatedAt)} | Timeframe: ${data.timeframeDays} days</p>

    <h2>Competitive Landscape</h2>
    <table>
      <thead>
        <tr>
          <th>Handle</th>
          <th>Platform</th>
          <th>State</th>
          <th>Relevance</th>
          <th>Availability</th>
          <th>Profile</th>
        </tr>
      </thead>
      <tbody>
        ${competitorRows || '<tr><td colspan="6">No competitors available.</td></tr>'}
      </tbody>
    </table>

    <h2>Evidence Posts</h2>
    <table>
      <thead>
        <tr>
          <th>Handle</th>
          <th>Platform</th>
          <th>Caption</th>
          <th>Engagement</th>
          <th>Link</th>
        </tr>
      </thead>
      <tbody>
        ${evidenceRows || '<tr><td colspan="5">No evidence posts available.</td></tr>'}
      </tbody>
    </table>
  `;
}
