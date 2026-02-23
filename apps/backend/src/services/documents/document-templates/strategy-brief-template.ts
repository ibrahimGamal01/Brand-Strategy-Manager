import type { DocumentDataPayload } from '../document-spec';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderStrategyBriefTemplate(data: DocumentDataPayload): string {
  const competitorItems = data.competitors
    .slice(0, 8)
    .map((competitor) =>
      `<li><strong>@${escapeHtml(competitor.handle)}</strong> (${escapeHtml(competitor.platform)}) - ${escapeHtml(competitor.selectionState)}</li>`
    )
    .join('');

  const topPostItems = data.topPosts
    .slice(0, 6)
    .map((post) => {
      const metrics = `${post.likes} likes, ${post.comments} comments, ${post.shares} shares`;
      const link = post.postUrl ? ` <a href="${escapeHtml(post.postUrl)}">Source</a>` : '';
      return `<li><strong>@${escapeHtml(post.handle)}</strong>: ${escapeHtml(post.caption || 'No caption')} (${metrics})${link}</li>`;
    })
    .join('');

  return `
    <h1>Strategy Brief</h1>
    <p>Generated: ${escapeHtml(data.generatedAt)}</p>
    <h2>Business Snapshot</h2>
    <ul>
      <li><strong>Client:</strong> ${escapeHtml(data.clientName)}</li>
      <li><strong>Business Type:</strong> ${escapeHtml(data.businessType)}</li>
      <li><strong>Primary Goal:</strong> ${escapeHtml(data.primaryGoal)}</li>
      <li><strong>Target Market:</strong> ${escapeHtml(data.targetMarket)}</li>
      <li><strong>Website:</strong> ${escapeHtml(data.websiteDomain)}</li>
      <li><strong>Audience:</strong> ${escapeHtml(data.audience)}</li>
    </ul>

    <h2>Priority Competitors</h2>
    <ul>${competitorItems || '<li>No competitors available yet.</li>'}</ul>

    <h2>Content Signals (Top Posts)</h2>
    <ul>${topPostItems || '<li>No post evidence available yet.</li>'}</ul>
  `;
}
