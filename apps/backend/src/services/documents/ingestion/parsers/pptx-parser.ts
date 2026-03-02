import JSZip from 'jszip';
import type { DocumentParseResult } from '../types';

function decodeXmlText(xml: string): string {
  return xml
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function parsePptxDocument(input: {
  buffer: Buffer;
}): Promise<DocumentParseResult> {
  const zip = await JSZip.loadAsync(input.buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNum = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const bNum = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return aNum - bNum;
    });

  const sections: Array<{ headingPath: string; text: string }> = [];
  for (const fileName of slideFiles.slice(0, 120)) {
    const xml = await zip.file(fileName)?.async('string');
    if (!xml) continue;
    const textRuns = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g), (match: RegExpMatchArray) =>
      decodeXmlText(match[1] || '')
    );
    const text = textRuns.filter(Boolean).join('\n').trim();
    const index = Number(fileName.match(/slide(\d+)\.xml/i)?.[1] || sections.length + 1);
    sections.push({
      headingPath: `Slide ${index}`,
      text,
    });
  }

  const warnings: string[] = [];
  if (!sections.length) {
    warnings.push('No slide text runs were extracted from PPTX.');
  }

  const text = sections.map((section) => `## ${section.headingPath}\n${section.text}`).join('\n\n').trim();

  return {
    parser: 'pptx',
    text,
    sections,
    warnings,
    pagesTotal: sections.length,
    pagesParsed: sections.length,
  };
}
