import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  path.resolve(ROOT, 'services/chat/runtime'),
  path.resolve(ROOT, 'services/ai/chat/chat-tool-runtime.ts'),
];

const FILE_EXTENSIONS = new Set(['.ts', '.tsx']);
const BANNED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'summarizeToolResults', pattern: /\bsummarizeToolResults\b/g },
  { label: 'fallbackSummarizer', pattern: /\bfallbackSummarizer\b/g },
  { label: 'SummarizerInput', pattern: /\bSummarizerInput\b/g },
  { label: 'BAT Tool Result Summarizer', pattern: /BAT Tool Result Summarizer/g },
  { label: 'Summarization fallback used', pattern: /Summarization fallback used/g },
];

type Violation = {
  file: string;
  label: string;
  line: number;
  column: number;
};

function listFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];

  const out: string[] = [];
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
      out.push(next);
    }
  }
  return out;
}

function findLineColumn(content: string, offset: number): { line: number; column: number } {
  const prefix = content.slice(0, offset);
  const lines = prefix.split('\n');
  const line = lines.length;
  const column = (lines[lines.length - 1] || '').length + 1;
  return { line, column };
}

function scanFile(file: string): Violation[] {
  const content = fs.readFileSync(file, 'utf8');
  const violations: Violation[] = [];

  for (const banned of BANNED_PATTERNS) {
    const matches = content.matchAll(banned.pattern);
    for (const match of matches) {
      const index = typeof match.index === 'number' ? match.index : -1;
      if (index < 0) continue;
      const position = findLineColumn(content, index);
      violations.push({
        file,
        label: banned.label,
        line: position.line,
        column: position.column,
      });
    }
  }

  return violations;
}

function run(): void {
  const files = TARGETS.flatMap((target) => listFiles(target));
  const violations = files.flatMap((file) => scanFile(file));

  if (!violations.length) {
    console.log('[Runtime No Summarizer] Passed.');
    return;
  }

  console.error('[Runtime No Summarizer] Failed. Found banned summarizer references:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line}:${violation.column} -> ${violation.label}`);
  }
  process.exit(1);
}

run();
