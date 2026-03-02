type MarkdownHtmlOptions = {
  title?: string;
};

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHref(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function applyInlineMarkdown(value: string): string {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/`([^`]+)`/g, '<code>$1</code>');
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  rendered = rendered.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, hrefRaw: string) => {
    const href = sanitizeHref(hrefRaw);
    if (!href) return `${escapeHtml(label)} (${escapeHtml(hrefRaw)})`;
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  });
  return rendered;
}

function splitTableRow(line: string): string[] {
  const normalized = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (!normalized) return [];
  return normalized.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(lines: string[]): string {
  if (lines.length < 2) return '';
  const header = splitTableRow(lines[0]);
  const bodyLines = lines.slice(2);
  const headHtml = header.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join('');
  const bodyHtml = bodyLines
    .map((row) => {
      const cells = splitTableRow(row);
      if (!cells.length) return '';
      return `<tr>${cells.map((cell) => `<td>${applyInlineMarkdown(cell)}</td>`).join('')}</tr>`;
    })
    .filter(Boolean)
    .join('\n');
  return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

export function markdownToRichHtml(markdown: string, options?: MarkdownHtmlOptions): string {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const body: string[] = [];
  let index = 0;
  let listMode: 'ul' | 'ol' | null = null;
  let paragraphBuffer: string[] = [];
  let quoteBuffer: string[] = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    body.push(`<p>${applyInlineMarkdown(paragraphBuffer.join(' '))}</p>`);
    paragraphBuffer = [];
  };

  const flushQuote = () => {
    if (!quoteBuffer.length) return;
    body.push(`<blockquote>${applyInlineMarkdown(quoteBuffer.join(' '))}</blockquote>`);
    quoteBuffer = [];
  };

  const flushList = () => {
    if (!listMode) return;
    body.push(`</${listMode}>`);
    listMode = null;
  };

  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = raw.trim();

    if (!trimmed) {
      flushAll();
      index += 1;
      continue;
    }

    if (/^\|/.test(trimmed) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushAll();
      const tableLines: string[] = [trimmed, lines[index + 1].trim()];
      index += 2;
      while (index < lines.length) {
        const row = lines[index].trim();
        if (!row || !/^\|/.test(row)) break;
        tableLines.push(row);
        index += 1;
      }
      body.push(renderTable(tableLines));
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushAll();
      body.push('<hr />');
      index += 1;
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      flushAll();
      body.push(`<h3>${applyInlineMarkdown(trimmed.replace(/^###\s+/, ''))}</h3>`);
      index += 1;
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      flushAll();
      body.push(`<h2>${applyInlineMarkdown(trimmed.replace(/^##\s+/, ''))}</h2>`);
      index += 1;
      continue;
    }

    if (/^#\s+/.test(trimmed)) {
      flushAll();
      body.push(`<h1>${applyInlineMarkdown(trimmed.replace(/^#\s+/, ''))}</h1>`);
      index += 1;
      continue;
    }

    if (/^>\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      quoteBuffer.push(trimmed.replace(/^>\s+/, ''));
      index += 1;
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch?.[1]) {
      flushParagraph();
      flushQuote();
      if (!listMode) {
        listMode = 'ul';
        body.push('<ul>');
      } else if (listMode !== 'ul') {
        flushList();
        listMode = 'ul';
        body.push('<ul>');
      }
      body.push(`<li>${applyInlineMarkdown(unorderedMatch[1])}</li>`);
      index += 1;
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch?.[1]) {
      flushParagraph();
      flushQuote();
      if (!listMode) {
        listMode = 'ol';
        body.push('<ol>');
      } else if (listMode !== 'ol') {
        flushList();
        listMode = 'ol';
        body.push('<ol>');
      }
      body.push(`<li>${applyInlineMarkdown(orderedMatch[1])}</li>`);
      index += 1;
      continue;
    }

    flushQuote();
    flushList();
    paragraphBuffer.push(trimmed);
    index += 1;
  }

  flushAll();

  const safeTitle = escapeHtml(String(options?.title || 'Document').slice(0, 180));
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    @page { size: Letter; margin: 0.6in; }
    :root {
      --text: #0f172a;
      --muted: #334155;
      --line: #d9e2ec;
      --surface: #f8fafc;
      --accent: #1d4ed8;
    }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      color: var(--text);
      line-height: 1.55;
      font-size: 11.5pt;
      padding: 8px 2px;
    }
    h1, h2, h3 {
      color: #0b1324;
      line-height: 1.25;
      margin: 20px 0 10px;
      page-break-after: avoid;
    }
    h1 {
      font-size: 24pt;
      border-bottom: 2px solid var(--line);
      padding-bottom: 8px;
      margin-top: 0;
    }
    h2 { font-size: 16pt; border-bottom: 1px solid var(--line); padding-bottom: 5px; }
    h3 { font-size: 13pt; color: #12263f; }
    p, li, td, th, blockquote { font-size: 11.2pt; }
    p { margin: 8px 0; }
    ul, ol { margin: 8px 0 10px 22px; padding: 0; }
    li { margin: 4px 0; }
    hr { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 7px 8px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }
    th {
      background: var(--surface);
      font-weight: 700;
      color: #0f243f;
    }
    blockquote {
      margin: 10px 0;
      padding: 8px 12px;
      border-left: 4px solid #93c5fd;
      background: #eff6ff;
      color: #1e3a5f;
    }
    a { color: var(--accent); text-decoration: none; }
    code {
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      background: #eef2f7;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10pt;
    }
    strong { font-weight: 700; }
    em { color: var(--muted); }
  </style>
</head>
<body>
${body.join('\n')}
</body>
</html>`;
}
