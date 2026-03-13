import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';

type AssetCandidate = {
  assetUrl: string;
  normalizedAssetUrl: string;
  assetType: string;
  discoveryRuleId: string;
  role?: string;
  selectorPath?: string;
  attributeName?: string;
  confidence: number;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  metadata?: Record<string, unknown>;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeAssetUrl(raw: string, pageUrl: string): string {
  const value = normalizeText(raw);
  if (!value) return '';
  if (/^data:/i.test(value)) return value.slice(0, 256);
  try {
    const resolved = new URL(value, pageUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return '';
    resolved.hash = '';
    const normalized = resolved.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return '';
  }
}

function maybeMimeTypeFromUrl(url: string): string | null {
  const value = normalizeText(url).toLowerCase();
  if (!value) return null;
  if (value.includes('.svg')) return 'image/svg+xml';
  if (value.includes('.png')) return 'image/png';
  if (value.includes('.jpg') || value.includes('.jpeg')) return 'image/jpeg';
  if (value.includes('.webp')) return 'image/webp';
  if (value.includes('.gif')) return 'image/gif';
  if (value.includes('.woff2')) return 'font/woff2';
  if (value.includes('.woff')) return 'font/woff';
  if (value.includes('.ttf')) return 'font/ttf';
  if (value.includes('.otf')) return 'font/otf';
  if (value.includes('.css')) return 'text/css';
  return null;
}

function extractAttribute(tag: string, key: string): string {
  const regex = new RegExp(key + "\\s*=\\s*(?:\"([^\"]+)\"|'([^']+)'|([^\\s\"'<>`]+))", 'i');
  const match = tag.match(regex);
  return normalizeText(match?.[1] || match?.[2] || match?.[3] || '');
}

function toSelectorHint(tagName: string, input: { id?: string; className?: string }): string {
  const id = normalizeText(input.id).replace(/[^\w-]/g, '');
  if (id) return `${tagName}#${id}`;
  const className = normalizeText(input.className)
    .split(/\s+/)
    .map((entry) => entry.replace(/[^\w-]/g, ''))
    .filter(Boolean)
    .slice(0, 2);
  if (className.length > 0) {
    return `${tagName}.${className.join('.')}`;
  }
  return tagName;
}

function classifyImageRole(tag: string): string {
  const haystack = `${extractAttribute(tag, 'alt')} ${extractAttribute(tag, 'class')} ${extractAttribute(tag, 'id')}`.toLowerCase();
  if (/\b(logo|brand|wordmark|mark)\b/.test(haystack)) return 'logo_candidate';
  if (/\b(hero|banner|masthead|cover)\b/.test(haystack)) return 'hero';
  if (/\b(testimonial|review|quote)\b/.test(haystack)) return 'testimonial';
  if (/\b(team|founder|about)\b/.test(haystack)) return 'team';
  if (/\b(product|service|feature)\b/.test(haystack)) return 'product';
  if (/\b(gallery|portfolio|case)\b/.test(haystack)) return 'gallery';
  return 'content_image';
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function extractCssColorTokens(cssText: string): string[] {
  const tokens: string[] = [];
  const colorRegex = /#(?:[0-9a-fA-F]{3,8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
  let match: RegExpExecArray | null;
  while ((match = colorRegex.exec(cssText))) {
    const token = normalizeText(match[0]).toLowerCase();
    if (!token) continue;
    tokens.push(token);
  }
  return Array.from(new Set(tokens)).slice(0, 80);
}

function extractCandidatesFromHtml(pageUrl: string, html: string): AssetCandidate[] {
  const candidates: AssetCandidate[] = [];
  const styleBlocks: string[] = [];

  const linkRegex = /<link\b[^>]*>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html))) {
    const tag = linkMatch[0];
    const rel = extractAttribute(tag, 'rel').toLowerCase();
    const hrefRaw = extractAttribute(tag, 'href');
    const href = normalizeAssetUrl(hrefRaw, pageUrl);
    if (!href) continue;

    if (/\b(icon|apple-touch-icon)\b/.test(rel)) {
      candidates.push({
        assetUrl: hrefRaw || href,
        normalizedAssetUrl: href,
        assetType: 'logo',
        discoveryRuleId: 'lineage/logo/link_icon',
        role: 'icon_link',
        selectorPath: 'head > link[rel*=icon]',
        attributeName: 'href',
        confidence: 0.96,
        mimeType: maybeMimeTypeFromUrl(href),
      });
      continue;
    }

    if (/\bstylesheet\b/.test(rel)) {
      candidates.push({
        assetUrl: hrefRaw || href,
        normalizedAssetUrl: href,
        assetType: 'stylesheet',
        discoveryRuleId: 'lineage/typography/stylesheet_link',
        role: 'external_css',
        selectorPath: 'head > link[rel=stylesheet]',
        attributeName: 'href',
        confidence: 0.94,
        mimeType: maybeMimeTypeFromUrl(href),
      });
    }
  }

  const metaRegex = /<meta\b[^>]*>/gi;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRegex.exec(html))) {
    const tag = metaMatch[0];
    const property = `${extractAttribute(tag, 'property')} ${extractAttribute(tag, 'name')}`.toLowerCase();
    const contentRaw = extractAttribute(tag, 'content');
    if (!/\b(og:image|twitter:image)\b/.test(property)) continue;
    const href = normalizeAssetUrl(contentRaw, pageUrl);
    if (!href) continue;
    candidates.push({
      assetUrl: contentRaw || href,
      normalizedAssetUrl: href,
      assetType: 'logo',
      discoveryRuleId: 'lineage/logo/meta_image',
      role: 'social_meta_image',
      selectorPath: 'head > meta[property*=image]',
      attributeName: 'content',
      confidence: 0.83,
      mimeType: maybeMimeTypeFromUrl(href),
    });
  }

  const imgRegex = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(html))) {
    const tag = imgMatch[0];
    const srcRaw = extractAttribute(tag, 'src');
    const src = normalizeAssetUrl(srcRaw, pageUrl);
    if (!src) continue;
    const role = classifyImageRole(tag);
    const selectorPath = toSelectorHint('img', {
      id: extractAttribute(tag, 'id'),
      className: extractAttribute(tag, 'class'),
    });
    const confidence = role === 'logo_candidate' ? 0.9 : role === 'hero' ? 0.78 : 0.68;
    candidates.push({
      assetUrl: srcRaw || src,
      normalizedAssetUrl: src,
      assetType: role === 'logo_candidate' ? 'logo' : 'image',
      discoveryRuleId: role === 'logo_candidate' ? 'lineage/logo/img_role' : 'lineage/imagery/img_inventory',
      role,
      selectorPath,
      attributeName: 'src',
      confidence,
      mimeType: maybeMimeTypeFromUrl(src),
      width: parsePositiveInt(extractAttribute(tag, 'width')),
      height: parsePositiveInt(extractAttribute(tag, 'height')),
      metadata: {
        alt: extractAttribute(tag, 'alt'),
      },
    });
  }

  const svgRegex = /<svg\b[^>]*>/gi;
  let svgMatch: RegExpExecArray | null;
  while ((svgMatch = svgRegex.exec(html))) {
    const tag = svgMatch[0];
    const marker = `${extractAttribute(tag, 'class')} ${extractAttribute(tag, 'id')} ${extractAttribute(tag, 'aria-label')}`.toLowerCase();
    if (!/\b(logo|brand|mark)\b/.test(marker)) continue;
    const hash = createHash('sha1').update(tag).digest('hex');
    candidates.push({
      assetUrl: `inline-svg:${hash}`,
      normalizedAssetUrl: `inline-svg:${hash}`,
      assetType: 'logo',
      discoveryRuleId: 'lineage/logo/inline_svg_marker',
      role: 'inline_svg_brand_mark',
      selectorPath: toSelectorHint('svg', {
        id: extractAttribute(tag, 'id'),
        className: extractAttribute(tag, 'class'),
      }),
      attributeName: 'inline',
      confidence: 0.74,
      mimeType: 'image/svg+xml',
    });
  }

  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleRegex.exec(html))) {
    const block = styleMatch[1] || '';
    if (normalizeText(block)) styleBlocks.push(block);
  }

  const inlineStyleRegex = /style\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineStyleRegex.exec(html))) {
    const style = normalizeText(inlineMatch[1] || inlineMatch[2] || '');
    if (!style) continue;
    styleBlocks.push(style);
  }

  const cssText = styleBlocks.join('\n');
  if (cssText) {
    const fontFaceRegex = /@font-face\s*{([\s\S]*?)}/gi;
    let fontFaceMatch: RegExpExecArray | null;
    while ((fontFaceMatch = fontFaceRegex.exec(cssText))) {
      const block = fontFaceMatch[1] || '';
      const familyRawMatch = block.match(/font-family\s*:\s*([^;}{]+)/i);
      const family = normalizeText(familyRawMatch?.[1] || '').replace(/^['"]|['"]$/g, '');
      if (family) {
        candidates.push({
          assetUrl: `font-family:${family}`,
          normalizedAssetUrl: `font-family:${family.toLowerCase()}`,
          assetType: 'font_family',
          discoveryRuleId: 'lineage/typography/font_face_family',
          role: 'font_face_family',
          selectorPath: 'style@font-face',
          attributeName: 'font-family',
          confidence: 0.92,
          metadata: { family },
        });
      }

      const srcMatches = block.match(/url\(([^)]+)\)/gi) || [];
      for (const srcMatch of srcMatches) {
        const raw = normalizeText(srcMatch.replace(/^url\(/i, '').replace(/\)$/i, '')).replace(/^['"]|['"]$/g, '');
        const resolved = normalizeAssetUrl(raw, pageUrl);
        if (!resolved) continue;
        candidates.push({
          assetUrl: raw || resolved,
          normalizedAssetUrl: resolved,
          assetType: 'font_file',
          discoveryRuleId: 'lineage/typography/font_face_src',
          role: family ? `font_face_file:${family}` : 'font_face_file',
          selectorPath: 'style@font-face',
          attributeName: 'src',
          confidence: 0.9,
          mimeType: maybeMimeTypeFromUrl(resolved),
          metadata: family ? { family } : undefined,
        });
      }
    }

    const familyHits = new Map<string, number>();
    const fontFamilyRegex = /font-family\s*:\s*([^;}{]+)/gi;
    let familyMatch: RegExpExecArray | null;
    while ((familyMatch = fontFamilyRegex.exec(cssText))) {
      const raw = normalizeText(familyMatch[1] || '');
      if (!raw) continue;
      const firstFamily = normalizeText(raw.split(',')[0] || '').replace(/^['"]|['"]$/g, '');
      if (!firstFamily) continue;
      familyHits.set(firstFamily, (familyHits.get(firstFamily) || 0) + 1);
    }
    for (const [family, usageCount] of familyHits.entries()) {
      candidates.push({
        assetUrl: `font-family:${family}`,
        normalizedAssetUrl: `font-family:${family.toLowerCase()}`,
        assetType: 'font_family',
        discoveryRuleId: 'lineage/typography/css_usage',
        role: 'css_usage',
        selectorPath: 'style',
        attributeName: 'font-family',
        confidence: clamp(0.55 + usageCount * 0.03, 0.55, 0.89),
        metadata: { family, usageCount },
      });
    }

    const variableRegex = /--([a-z0-9-_]+)\s*:\s*([^;}{]+)/gi;
    let variableMatch: RegExpExecArray | null;
    while ((variableMatch = variableRegex.exec(cssText))) {
      const tokenName = normalizeText(variableMatch[1] || '').toLowerCase();
      const tokenValue = normalizeText(variableMatch[2] || '');
      if (!tokenName || !tokenValue) continue;
      candidates.push({
        assetUrl: `token:${tokenName}`,
        normalizedAssetUrl: `token:${tokenName}`,
        assetType: 'design_token',
        discoveryRuleId: 'lineage/design_tokens/css_variable',
        role: 'css_variable',
        selectorPath: ':root',
        attributeName: '--var',
        confidence: 0.72,
        metadata: {
          name: tokenName,
          value: tokenValue,
        },
      });
    }

    const colorTokens = extractCssColorTokens(cssText);
    for (const color of colorTokens) {
      candidates.push({
        assetUrl: `color:${color}`,
        normalizedAssetUrl: `color:${color}`,
        assetType: 'color',
        discoveryRuleId: 'lineage/design_tokens/css_color_literal',
        role: 'css_color_literal',
        selectorPath: 'style',
        attributeName: 'color',
        confidence: 0.64,
        metadata: { color },
      });
    }
  }

  return candidates;
}

function buildLineageKey(input: {
  researchJobId: string;
  snapshotId: string;
  normalizedAssetUrl: string;
  assetType: string;
  role?: string;
  selectorPath?: string;
  attributeName?: string;
}): string {
  return createHash('sha1')
    .update(
      [
        input.researchJobId,
        input.snapshotId,
        input.normalizedAssetUrl,
        input.assetType,
        normalizeText(input.role),
        normalizeText(input.selectorPath),
        normalizeText(input.attributeName),
      ].join('|'),
    )
    .digest('hex');
}

export async function extractAndPersistWebsiteDesignLineage(input: {
  researchJobId: string;
  snapshotId: string;
  scanRunId?: string | null;
  pageUrl: string;
  html: string;
}): Promise<{
  persisted: number;
  logos: number;
  images: number;
  fonts: number;
  designTokens: number;
  stylesheets: number;
  ambiguities: string[];
}> {
  const pageUrl = normalizeText(input.pageUrl);
  const html = String(input.html || '');
  if (!pageUrl || !html.trim()) {
    return {
      persisted: 0,
      logos: 0,
      images: 0,
      fonts: 0,
      designTokens: 0,
      stylesheets: 0,
      ambiguities: ['No HTML payload was available for design lineage extraction.'],
    };
  }

  const rawCandidates = extractCandidatesFromHtml(pageUrl, html);
  const dedupeMap = new Map<string, AssetCandidate>();
  for (const candidate of rawCandidates) {
    if (!candidate.normalizedAssetUrl || !candidate.assetType) continue;
    const key = [
      candidate.normalizedAssetUrl,
      candidate.assetType,
      normalizeText(candidate.role),
      normalizeText(candidate.selectorPath),
      normalizeText(candidate.attributeName),
    ].join('|');
    if (!dedupeMap.has(key)) {
      dedupeMap.set(key, candidate);
      continue;
    }
    const existing = dedupeMap.get(key)!;
    if (candidate.confidence > existing.confidence) {
      dedupeMap.set(key, candidate);
    }
  }

  const candidates = Array.from(dedupeMap.values()).slice(0, 600);
  let persisted = 0;
  const now = new Date();

  for (const candidate of candidates) {
    const lineageKey = buildLineageKey({
      researchJobId: input.researchJobId,
      snapshotId: input.snapshotId,
      normalizedAssetUrl: candidate.normalizedAssetUrl,
      assetType: candidate.assetType,
      role: candidate.role,
      selectorPath: candidate.selectorPath,
      attributeName: candidate.attributeName,
    });

    await prisma.websiteAssetRecord.upsert({
      where: { lineageKey },
      create: {
        researchJobId: input.researchJobId,
        snapshotId: input.snapshotId,
        scanRunId: normalizeText(input.scanRunId) || null,
        lineageKey,
        pageUrl,
        assetUrl: candidate.assetUrl,
        normalizedAssetUrl: candidate.normalizedAssetUrl,
        assetType: candidate.assetType,
        role: normalizeText(candidate.role) || null,
        selectorPath: normalizeText(candidate.selectorPath) || null,
        attributeName: normalizeText(candidate.attributeName) || null,
        confidence: clamp(candidate.confidence),
        mimeType: normalizeText(candidate.mimeType) || null,
        width: Number.isFinite(Number(candidate.width)) ? Math.max(1, Number(candidate.width)) : null,
        height: Number.isFinite(Number(candidate.height)) ? Math.max(1, Number(candidate.height)) : null,
        metadata: {
          ...(candidate.metadata || {}),
          discoveryRuleId: candidate.discoveryRuleId,
          assetHash: createHash('sha1').update(candidate.normalizedAssetUrl).digest('hex'),
        },
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        scanRunId: normalizeText(input.scanRunId) || null,
        pageUrl,
        confidence: clamp(candidate.confidence),
        mimeType: normalizeText(candidate.mimeType) || null,
        width: Number.isFinite(Number(candidate.width)) ? Math.max(1, Number(candidate.width)) : null,
        height: Number.isFinite(Number(candidate.height)) ? Math.max(1, Number(candidate.height)) : null,
        metadata: {
          ...(candidate.metadata || {}),
          discoveryRuleId: candidate.discoveryRuleId,
          assetHash: createHash('sha1').update(candidate.normalizedAssetUrl).digest('hex'),
        },
        lastSeenAt: now,
      },
    });
    persisted += 1;
  }

  const logos = candidates.filter((item) => item.assetType === 'logo').length;
  const images = candidates.filter((item) => item.assetType === 'image').length;
  const fonts = candidates.filter((item) => item.assetType === 'font_family' || item.assetType === 'font_file').length;
  const designTokens = candidates.filter((item) => item.assetType === 'design_token' || item.assetType === 'color').length;
  const stylesheets = candidates.filter((item) => item.assetType === 'stylesheet').length;

  const ambiguities: string[] = [];
  if (logos > 1) ambiguities.push('Multiple logo candidates detected.');
  if (fonts > 5) ambiguities.push('Multiple font families/files detected.');
  if (designTokens === 0) ambiguities.push('No design tokens detected in style payload.');

  return {
    persisted,
    logos,
    images,
    fonts,
    designTokens,
    stylesheets,
    ambiguities,
  };
}
