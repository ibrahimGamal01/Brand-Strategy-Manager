#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const maxLines = Number(process.env.MAX_FILE_LINES || 300);
const targetRoots = ['apps/backend/src', 'apps/frontend/src'];
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

const exemptionsPath = path.join(repoRoot, 'scripts/quality/file-line-exemptions.json');
const exemptions = new Set(
  fs.existsSync(exemptionsPath)
    ? JSON.parse(fs.readFileSync(exemptionsPath, 'utf8')).map((item) => String(item).trim())
    : []
);

function listFiles() {
  const files = execSync(`cd "${repoRoot}" && rg --files ${targetRoots.join(' ')}`, {
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => allowedExtensions.has(path.extname(file)));
  return files;
}

function countLines(filePath) {
  const fullPath = path.join(repoRoot, filePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function main() {
  const files = listFiles();
  const violations = [];
  const exemptOverLimit = [];

  for (const file of files) {
    const lines = countLines(file);
    if (lines <= maxLines) continue;

    if (exemptions.has(file)) {
      exemptOverLimit.push({ file, lines });
      continue;
    }

    violations.push({ file, lines });
  }

  if (exemptOverLimit.length > 0) {
    console.log(`[quality:file-lines] Exempted files over ${maxLines} lines: ${exemptOverLimit.length}`);
  }

  if (violations.length > 0) {
    console.error(`[quality:file-lines] Found ${violations.length} files over ${maxLines} lines (non-exempt):`);
    for (const item of violations.sort((a, b) => b.lines - a.lines)) {
      console.error(`  - ${item.file}: ${item.lines}`);
    }
    process.exit(1);
  }

  console.log(`[quality:file-lines] OK - all non-exempt files are <= ${maxLines} lines.`);
}

main();
