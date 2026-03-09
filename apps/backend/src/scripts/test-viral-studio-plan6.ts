import assert from 'node:assert/strict';
import {
  compareStudioDocumentVersions,
  createGenerationPack,
  createStudioDocument,
  createStudioDocumentVersion,
  getStudioDocumentWithVersions,
  promoteStudioDocumentVersion,
  updateStudioDocument,
} from '../services/portal/viral-studio';

function asText(content: string | string[]): string {
  return Array.isArray(content) ? content.join('\n') : content;
}

async function run(): Promise<void> {
  const workspaceId = `viral-studio-plan6-${Date.now()}`;

  const generation = await createGenerationPack(workspaceId, {
    templateId: 'full-script',
    prompt: 'Build a campaign pack for conversion-focused reels.',
    formatTarget: 'reel-60',
  });
  const document = await createStudioDocument(workspaceId, {
    generationId: generation.id,
    title: 'Plan 6 Workspace Document',
  });
  assert.ok(document.sections.length >= 6, 'Document should initialize with generation sections.');

  const firstSection = document.sections[0];
  const moved = await updateStudioDocument(workspaceId, document.id, {
    sections: [
      {
        id: firstSection.id,
        title: 'Hooks (Edited)',
        content: ['Hook line 1', 'Hook line 2', 'Hook line 3'],
      },
    ],
    orderedSectionIds: [document.sections[1].id, firstSection.id, ...document.sections.slice(2).map((entry) => entry.id)],
    autosave: true,
  });
  assert.ok(moved, 'Document update should succeed.');
  assert.equal(moved?.sections[1].title, 'Hooks (Edited)', 'Edited section should keep updated title after reorder.');

  const versionA = await createStudioDocumentVersion(workspaceId, document.id, {
    author: 'plan6-test',
    summary: 'Version A baseline',
  });
  assert.ok(versionA, 'Version A creation should succeed.');
  assert.ok(versionA?.document.currentVersionId, 'Document should point to current version after publish.');

  const secondSection = moved!.sections[1];
  const updatedAgain = await updateStudioDocument(workspaceId, document.id, {
    sections: [
      {
        id: secondSection.id,
        content: ['Hook line 1 changed', 'Hook line 2 changed'],
      },
    ],
  });
  assert.ok(updatedAgain, 'Second document update should succeed.');

  const versionB = await createStudioDocumentVersion(workspaceId, document.id, {
    author: 'plan6-test',
    summary: 'Version B changed hooks',
  });
  assert.ok(versionB, 'Version B creation should succeed.');

  const comparison = await compareStudioDocumentVersions(workspaceId, document.id, versionA!.version.id, versionB!.version.id);
  assert.ok(comparison, 'Version compare should return payload.');
  assert.ok((comparison?.changedSections || 0) >= 1, 'Comparison should detect changed sections.');

  const promoted = await promoteStudioDocumentVersion(workspaceId, document.id, versionA!.version.id, {
    author: 'plan6-test',
    summary: 'Promote baseline back to current',
  });
  assert.ok(promoted, 'Promote version should succeed.');
  assert.ok(promoted?.version.basedOnVersionId, 'Promote snapshot should carry source version id.');
  assert.equal(promoted?.promotedFromVersionId, versionA!.version.id);

  const afterPromote = await getStudioDocumentWithVersions(workspaceId, document.id);
  assert.ok(afterPromote, 'Document should still be retrievable after promote.');
  assert.equal(
    asText(afterPromote!.document.sections[1].content),
    asText(versionA!.version.snapshotSections[1].content),
    'Promote should restore section content from selected version snapshot.'
  );

  console.log('viral-studio Plan 6 tests passed');
}

run().catch((error) => {
  console.error('viral-studio Plan 6 tests failed');
  console.error(error);
  process.exit(1);
});
