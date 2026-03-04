import assert from 'node:assert/strict';
import { runLaneQueriesWithBudgetForTest } from '../services/discovery/v3/discover-v3';
import type { LaneQuery } from '../services/discovery/v3/types';

function buildLaneQueries(total: number): LaneQuery[] {
  return Array.from({ length: total }, (_, index) => ({
    lane: 'alternatives',
    query: `biophoton alternatives ${index + 1}`,
    locale: 'en-US',
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const laneQueries = buildLaneQueries(12);
  const delayedExecutor = async (query: LaneQuery) => {
    await sleep(40);
    return [
      {
        lane: query.lane,
        query: query.query,
        locale: query.locale,
        provider: 'stub',
        item: {
          url: `https://example.com/${encodeURIComponent(query.query)}`,
          title: 'Stub result',
          snippet: 'Stub snippet',
          rank: 1,
        },
      },
    ];
  };

  const constrained = await runLaneQueriesWithBudgetForTest({
    laneQueries,
    perQueryCount: 6,
    queryConcurrency: 3,
    searchBudgetMs: 90,
    executeQuery: delayedExecutor,
  });

  assert.equal(constrained.budgetReached, true, 'Expected the constrained run to hit the wall-clock budget.');
  assert.ok(
    constrained.executedQueries < laneQueries.length,
    `Expected constrained run to stop early; executed=${constrained.executedQueries}`
  );
  assert.ok(
    constrained.warnings.includes('TIME_BUDGET_REACHED'),
    'Expected constrained run warnings to include TIME_BUDGET_REACHED.'
  );

  const relaxed = await runLaneQueriesWithBudgetForTest({
    laneQueries,
    perQueryCount: 6,
    queryConcurrency: 3,
    searchBudgetMs: 5_000,
    executeQuery: delayedExecutor,
  });

  assert.equal(relaxed.budgetReached, false, 'Expected the relaxed run not to hit the wall-clock budget.');
  assert.equal(
    relaxed.executedQueries,
    laneQueries.length,
    'Expected relaxed run to execute all lane queries.'
  );

  console.log('discovery-v3-time-budget tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
