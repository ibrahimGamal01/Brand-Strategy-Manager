import * as XLSX from 'xlsx';
import type { DocumentParseResult } from '../types';

function normalizeCell(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text;
}

export async function parseXlsxDocument(input: {
  buffer: Buffer;
}): Promise<DocumentParseResult> {
  const workbook = XLSX.read(input.buffer, { type: 'buffer' });
  const warnings: string[] = [];
  const sections: Array<{ headingPath: string; text: string; table?: Record<string, unknown> }> = [];
  const tables: Array<Record<string, unknown>> = [];

  for (const sheetName of workbook.SheetNames.slice(0, 12)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const previewRows = rows.slice(0, 60);

    const lines: string[] = [];
    lines.push(`Sheet "${sheetName}" with ${rows.length} row(s).`);
    if (headers.length) {
      lines.push(`Columns: ${headers.join(', ')}`);
    }
    for (const row of previewRows.slice(0, 20)) {
      const entry = headers.length
        ? headers.map((header) => `${header}: ${normalizeCell(row[header])}`).join(' | ')
        : Object.values(row).map((value) => normalizeCell(value)).join(' | ');
      if (entry) lines.push(`- ${entry}`);
    }

    sections.push({
      headingPath: `Sheet > ${sheetName}`,
      text: lines.join('\n').trim(),
      table: { headers, rows: previewRows },
    });
    tables.push({ sheetName, headers, rows: previewRows });

    if (rows.length > previewRows.length) {
      warnings.push(`Sheet "${sheetName}" truncated to first 60 rows for canonical preview.`);
    }
  }

  const text = sections.map((section) => `## ${section.headingPath}\n${section.text}`).join('\n\n').trim();

  return {
    parser: 'xlsx',
    text,
    sections,
    tables,
    warnings,
  };
}
