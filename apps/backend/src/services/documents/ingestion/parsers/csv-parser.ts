import { parse } from 'csv-parse/sync';
import type { DocumentParseResult } from '../types';

export async function parseCsvDocument(input: {
  buffer: Buffer;
}): Promise<DocumentParseResult> {
  const raw = input.buffer.toString('utf8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
  }) as Array<Record<string, unknown>>;

  const headers = records[0] ? Object.keys(records[0]) : [];
  const previewRows = records.slice(0, 80);
  const lines: string[] = [];
  lines.push(`CSV with ${records.length} row(s) and ${headers.length} column(s).`);
  if (headers.length) {
    lines.push(`Columns: ${headers.join(', ')}`);
  }
  for (const row of previewRows) {
    const entries = Object.entries(row).map(([key, value]) => `${key}: ${String(value ?? '').trim()}`);
    lines.push(`- ${entries.join(' | ')}`);
  }

  return {
    parser: 'csv',
    text: lines.join('\n').trim(),
    sections: [
      {
        headingPath: 'CSV Overview',
        text: lines.join('\n').trim(),
        table: {
          headers,
          rows: previewRows,
        },
      },
    ],
    tables: [
      {
        headers,
        rows: previewRows,
      },
    ],
    warnings: records.length > previewRows.length ? ['Large CSV truncated to first 80 rows for canonical preview.'] : [],
  };
}
