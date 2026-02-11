#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const maxFileSizeBytes = 1024 * 1024;

const skipPrefixes = [
  'node_modules/',
  'apps/backend/dist/',
  'scripts/security/',
];

const skipExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.mp4',
  '.mov',
  '.wav',
  '.mp3',
  '.ttf',
  '.woff',
  '.woff2',
]);

const forbiddenPatterns = [
  {
    label: 'literal dummy key',
    regex: new RegExp('dummy' + '-' + 'key', 'i'),
  },
  {
    label: 'token-shaped Apify key',
    regex: new RegExp('apify' + '_api_' + '[A-Za-z0-9]{20,}'),
  },
  {
    label: 'token-shaped OpenAI project key',
    regex: new RegExp('sk-' + 'proj-' + '[A-Za-z0-9_-]{20,}'),
  },
  {
    label: 'token-shaped OpenAI key',
    regex: /sk-[A-Za-z0-9_-]{20,}/,
  },
];

const envKeyAssignments = [
  'OPENAI_API_KEY',
  'APIFY_TOKEN',
  'APIFY_API_TOKEN',
  'APIFY_MEDIA_DOWNLOADER_TOKEN',
];

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (skipExtensions.has(ext)) return false;
  if (skipPrefixes.some((prefix) => filePath.startsWith(prefix))) return false;
  return true;
}

function isNeutralPlaceholder(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^<[^>]+>$/.test(trimmed)) return true;
  if (/^[A-Z0-9_]+_FROM_SECRET_MANAGER$/.test(trimmed)) return true;
  if (/^YOUR_[A-Z0-9_]+$/.test(trimmed)) return true;
  if (/^REPLACE_[A-Z0-9_]+$/.test(trimmed)) return true;
  if (trimmed === 'CHANGEME') return true;
  return false;
}

function sanitizeEnvValue(rawValue) {
  const withoutComment = rawValue.split('#')[0].trim();
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1).trim();
  }
  return withoutComment;
}

function readTrackedFiles() {
  const output = execSync('git ls-files -z', { encoding: 'utf8' });
  return output.split('\u0000').filter(Boolean);
}

function findIssues() {
  const issues = [];
  const files = readTrackedFiles();

  for (const file of files) {
    if (!isTextFile(file)) continue;
    const absPath = path.join(repoRoot, file);
    if (!fs.existsSync(absPath)) continue;

    const stat = fs.statSync(absPath);
    if (stat.size > maxFileSizeBytes) continue;

    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;

      for (const forbidden of forbiddenPatterns) {
        if (forbidden.regex.test(line)) {
          issues.push(`${file}:${lineNo} forbidden ${forbidden.label}`);
        }
      }

      for (const envKey of envKeyAssignments) {
        const assignment = line.match(
          new RegExp(`^\\s*${envKey}\\s*=\\s*(.+?)\\s*$`)
        );
        if (!assignment) continue;

        const value = sanitizeEnvValue(assignment[1]);
        if (!isNeutralPlaceholder(value)) {
          issues.push(
            `${file}:${lineNo} ${envKey} must use a neutral placeholder (found non-placeholder value)`
          );
        }
      }
    }
  }

  return issues;
}

const issues = findIssues();
if (issues.length > 0) {
  console.error('[security:scan-main] Found forbidden secret/dummy patterns:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('[security:scan-main] Passed');
