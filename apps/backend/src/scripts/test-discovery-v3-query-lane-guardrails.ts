import assert from 'node:assert/strict';
import { buildLaneQueriesWithDiagnostics } from '../services/discovery/v3/query-lanes';
import type { MarketFingerprint } from '../services/discovery/v3/types';

function main(): void {
  const noisyFingerprint: MarketFingerprint = {
    brandName: 'ELUUMIS',
    niche: 'Biophoton wellness devices',
    categoryKeywords: [
      'free',
      'pass',
      'ELUUMIS',
      'biophoton devices',
      'energy healing',
      'holistic wellness seekers who want a new modality to use with clients / buyers who want a technology framed approach',
    ],
    problemKeywords: ['stress', 'sleep'],
    audienceKeywords: [
      'Holistic wellness seekers who want a new modality to use with clients / Energy healers and bodyworkers',
      'Wellness practitioners',
    ],
    geoMarkets: ['global'],
    offerTypes: ['guided programs'],
    seedCompetitors: [
      { name: 'ELUUMIS' },
      { name: 'joovv' },
      { url: 'https://mitoredlight.com' },
    ],
  };

  const output = buildLaneQueriesWithDiagnostics(noisyFingerprint, {
    locales: ['en-US'],
    lanes: ['category', 'alternatives', 'directories', 'social', 'people'],
    includePeople: true,
  });

  assert.ok(output.queries.length > 0, 'Expected sanitized lane queries to be produced.');
  assert.ok(
    output.queries.some((entry) => entry.lane === 'alternatives'),
    'Expected at least one alternatives query.'
  );
  assert.ok(
    output.queries.some((entry) => entry.lane === 'social'),
    'Expected at least one social query.'
  );
  assert.ok(
    output.queries.every((entry) => !/\bbest\s+free\b|\btop\s+pass\b/i.test(entry.query)),
    'Expected no "best free" or "top pass" patterns in generated queries.'
  );
  assert.ok(
    output.queries.every((entry) => !/who want|looking for|\s\/\s/i.test(entry.query)),
    'Expected no long audience-sentence leakage in generated queries.'
  );
  assert.ok(
    output.diagnostics.droppedKeywordCount > 0 || output.diagnostics.droppedQueryCount > 0,
    'Expected sanitizer diagnostics to report dropped noisy inputs.'
  );

  console.log('discovery-v3-query-lane-guardrails tests passed');
}

main();
