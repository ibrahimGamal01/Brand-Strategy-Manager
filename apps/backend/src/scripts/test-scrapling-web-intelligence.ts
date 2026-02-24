import assert from 'node:assert/strict';
import { getTool } from '../services/ai/chat/tools/tool-registry';
import { validateScrapeUrl } from '../services/scraping/scrapling-security';
import { scraplingClient } from '../services/scraping/scrapling-client';

const allowed = validateScrapeUrl('https://example.com/path?q=1');
assert.equal(allowed.allowed, true);
assert.ok(allowed.normalizedUrl?.startsWith('https://example.com'));

const blockedLocal = validateScrapeUrl('http://localhost:3000/admin');
assert.equal(blockedLocal.allowed, false);
assert.match(String(blockedLocal.reason || ''), /Blocked hostname/i);

const blockedPrivate = validateScrapeUrl('http://10.1.2.3/internal');
assert.equal(blockedPrivate.allowed, false);
assert.match(String(blockedPrivate.reason || ''), /private IPv4/i);

assert.ok(getTool('web.fetch'), 'web.fetch tool should be registered');
assert.ok(getTool('web.crawl'), 'web.crawl tool should be registered');
assert.ok(getTool('web.extract'), 'web.extract tool should be registered');

assert.equal(typeof scraplingClient.isWorkerConfigured(), 'boolean');

console.log('Scrapling web intelligence foundation checks passed.');
