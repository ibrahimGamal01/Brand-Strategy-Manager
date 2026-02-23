import assert from 'node:assert/strict';
import { isBlockedHandle } from '../services/discovery/competitor-scorer-utils';

function run() {
  // Legitimate brands should remain eligible for scoring.
  assert.equal(isBlockedHandle('nike'), false);
  assert.equal(isBlockedHandle('google'), false);
  assert.equal(isBlockedHandle('netflix'), false);
  assert.equal(isBlockedHandle('ibm'), false);

  // Generic and low-signal handles should still be blocked.
  assert.equal(isBlockedHandle('quotes'), true);
  assert.equal(isBlockedHandle('startup'), true);
  assert.equal(isBlockedHandle('deals_daily'), true);
  assert.equal(isBlockedHandle('fanpage_alerts'), true);
  assert.equal(isBlockedHandle('123456789'), true);
  assert.equal(isBlockedHandle('___'), true);

  // eslint-disable-next-line no-console
  console.log('competitor-scorer-utils tests passed');
}

run();
