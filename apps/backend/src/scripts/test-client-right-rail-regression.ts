import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

async function readLayoutSource(): Promise<string> {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const layoutPath = path.join(repoRoot, 'apps/client-portal/src/components/chat/chat-os-runtime-layout.tsx');
  return fs.readFile(layoutPath, 'utf8');
}

function assertHas(source: string, expected: string, label: string): void {
  assert.ok(source.includes(expected), `${label} missing expected logic: ${expected}`);
}

async function main(): Promise<void> {
  const source = await readLayoutSource();

  // Dual-mode, collapsible right rail model.
  assertHas(source, 'useState<"activity" | "docs">', 'Right-rail mode state');
  assertHas(source, 'const [rightRailCollapsed, setRightRailCollapsed] = useState', 'Right-rail collapsed state');
  assertHas(source, 'const hasDocsContext = runtimeDocuments.length > 0;', 'Docs contextual visibility rule');
  assertHas(source, 'if (!rightRailCollapsed && rightRailMode === mode) {', 'Toggle collapse-on-same-mode behavior');

  // Auto-open docs only for newly generated document events.
  assertHas(
    source,
    'item.toolName === "document.generate" && item.actionTarget?.kind === "document"',
    'Generated document auto-open detector'
  );

  // Docs fall back behavior when no docs context exists.
  assertHas(source, 'if (!hasDocsContext) {', 'Docs context guard');
  assertHas(source, 'setActiveLibraryCollection("deliverables")', 'No-docs fallback to deliverables');

  // Legacy/new action compatibility for document quick actions.
  assertHas(source, 'const fields = ["downloadHref", "storageHref", "href", "storagePath"] as const;', 'Download/open payload compatibility');
  assertHas(source, 'if (action === "document.open" || action === "document.download") {', 'Open/download action compatibility');
  assertHas(source, 'if (action === "document.generate") {', 'Generate action without strict doc id');
  assertHas(
    source,
    'if (action === "document.read" || action === "document.propose_edit" || action === "document.apply_edit" || action === "document.export") {',
    'Strict document-id-only action block'
  );
  assertHas(source, 'setActionError("Document action is missing documentId.")', 'Explicit strict doc-id guard');

  console.log('[Client Right Rail Regression] Passed.');
}

void main().catch((error) => {
  console.error('[Client Right Rail Regression] Failed:', error);
  process.exit(1);
});
