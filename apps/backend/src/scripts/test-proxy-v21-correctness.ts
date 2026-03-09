import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScraperProxyPool, runScriptJsonWithRetries } from '../services/scraper/script-runner';
import { executeWithProxyPolicy } from '../services/network/proxy-rotation';

const PROXY_ENV_KEYS = [
  'SCRAPER_PROXY_URL',
  'SCRAPER_PROXY_URLS',
  'PROXY_URL',
  'PROXY_URLS',
  'PROXY_LIST_PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SCRAPER_PROXY_ALLOW_DIRECT',
  'PROXY_POLICY_DDG_ALLOW_DIRECT',
  'PROXY_POLICY_SCRAPLING_ALLOW_DIRECT',
  'PROXY_POLICY_INSTAGRAM_ALLOW_DIRECT',
  'PROXY_POLICY_TIKTOK_ALLOW_DIRECT',
  'SCRAPER_PROXY_FORCE_DIRECT',
  'SCRAPER_PROXY_DISABLE_SELF_ROTATION',
] as const;

const originalEnv = new Map<string, string | undefined>(
  PROXY_ENV_KEYS.map((key) => [key, process.env[key]])
);

function restoreProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    const original = originalEnv.get(key);
    if (typeof original === 'string') process.env[key] = original;
    else delete process.env[key];
  }
}

function resetProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    delete process.env[key];
  }
}

function resolveBackendScript(relativeName: string): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'apps/backend/scripts', relativeName),
    path.join(cwd, 'scripts', relativeName),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(found, `Script not found: ${relativeName}`);
  return found as string;
}

function pythonProxyConfigFromModule(modulePath: string, envOverrides: Record<string, string | undefined>) {
  const inlineCode = `
import importlib.util, json, os, sys, types
pkg = types.ModuleType("camoufox")
sync = types.ModuleType("camoufox.sync_api")
class DummyCamoufox:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
sync.Camoufox = DummyCamoufox
pkg.sync_api = sync
sys.modules["camoufox"] = pkg
sys.modules["camoufox.sync_api"] = sync
spec = importlib.util.spec_from_file_location("mod", r"""${modulePath}""")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(json.dumps(mod._resolve_camoufox_proxy_config()))
`;
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (typeof value === 'string') childEnv[key] = value;
    else delete childEnv[key];
  }
  const output = execFileSync('python3', ['-c', inlineCode], { env: childEnv, encoding: 'utf8' }).trim();
  return JSON.parse(output || 'null');
}

function pythonProxyConfigErrorFromModule(
  modulePath: string,
  envOverrides: Record<string, string | undefined>
): string {
  try {
    pythonProxyConfigFromModule(modulePath, envOverrides);
    return '';
  } catch (error: any) {
    const stderr = String(error?.stderr || '').trim();
    const message = String(error?.message || error || '').trim();
    return [stderr, message].filter(Boolean).join('\n');
  }
}

async function run(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-v21-'));
  const markerPath = path.join(tmpDir, 'launched.marker');
  const probeScriptPath = path.join(tmpDir, 'probe.py');
  fs.writeFileSync(
    probeScriptPath,
    [
      'import json',
      'import os',
      'marker = os.environ.get("MARKER_PATH")',
      'if marker:',
      '    with open(marker, "w", encoding="utf-8") as fh:',
      '        fh.write("launched")',
      'print(json.dumps({',
      '  "SCRAPER_PROXY_URL": os.environ.get("SCRAPER_PROXY_URL"),',
      '  "SCRAPER_PROXY_FORCE_DIRECT": os.environ.get("SCRAPER_PROXY_FORCE_DIRECT"),',
      '  "SCRAPER_PROXY_DISABLE_SELF_ROTATION": os.environ.get("SCRAPER_PROXY_DISABLE_SELF_ROTATION"),',
      '  "HTTP_PROXY": os.environ.get("HTTP_PROXY"),',
      '  "HTTPS_PROXY": os.environ.get("HTTPS_PROXY"),',
      '  "ALL_PROXY": os.environ.get("ALL_PROXY"),',
      '  "http_proxy": os.environ.get("http_proxy"),',
      '  "https_proxy": os.environ.get("https_proxy"),',
      '  "all_proxy": os.environ.get("all_proxy"),',
      '}))',
    ].join('\n'),
    'utf8'
  );

  try {
    // 1) Default fail-fast for fail-closed scopes with empty proxy targets.
    resetProxyEnv();
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    const instagramPool = createScraperProxyPool(
      'instagram-scraper',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'instagram' }
    );

    let instagramError = '';
    try {
      await runScriptJsonWithRetries<any>({
        label: 'proxy-v21-instagram-failfast',
        executable: 'python3',
        scriptFileName: probeScriptPath,
        proxyPool: instagramPool,
        maxAttempts: 1,
        extraEnv: { MARKER_PATH: markerPath },
      });
    } catch (error: any) {
      instagramError = String(error?.message || error);
    }
    assert.match(instagramError, /fail-closed proxy policy blocked execution/i);
    assert.equal(fs.existsSync(markerPath), false, 'instagram fail-fast must block child launch');

    resetProxyEnv();
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    const tiktokPool = createScraperProxyPool(
      'tiktok-scraper',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'tiktok' }
    );
    let tiktokError = '';
    try {
      await runScriptJsonWithRetries<any>({
        label: 'proxy-v21-tiktok-failfast',
        executable: 'python3',
        scriptFileName: probeScriptPath,
        proxyPool: tiktokPool,
        maxAttempts: 1,
        extraEnv: { MARKER_PATH: markerPath },
      });
    } catch (error: any) {
      tiktokError = String(error?.message || error);
    }
    assert.match(tiktokError, /fail-closed proxy policy blocked execution/i);
    assert.equal(fs.existsSync(markerPath), false, 'tiktok fail-fast must block child launch');

    // 2) Connector override can explicitly re-enable direct fallback.
    resetProxyEnv();
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    process.env.PROXY_POLICY_INSTAGRAM_ALLOW_DIRECT = 'true';
    const instagramDirectPool = createScraperProxyPool(
      'instagram-scraper',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'instagram' }
    );
    const instagramDirect = await runScriptJsonWithRetries<any>({
      label: 'proxy-v22-instagram-direct-override',
      executable: 'python3',
      scriptFileName: probeScriptPath,
      proxyPool: instagramDirectPool,
      maxAttempts: 1,
      extraEnv: { MARKER_PATH: markerPath },
    });
    assert.equal(fs.existsSync(markerPath), true, 'instagram direct override should allow child launch');
    assert.equal(instagramDirect.parsed.SCRAPER_PROXY_URL, null);
    assert.equal(instagramDirect.parsed.SCRAPER_PROXY_FORCE_DIRECT, '1');

    // 3) Proxy-present execution still launches and injects SCRAPER_PROXY_URL.
    resetProxyEnv();
    process.env.PROXY_POLICY_INSTAGRAM_ALLOW_DIRECT = 'false';
    process.env.SCRAPER_PROXY_URLS = 'http://127.0.0.1:18080';
    const instagramPoolWithProxy = createScraperProxyPool(
      'instagram-scraper',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'instagram' }
    );
    const launched = await runScriptJsonWithRetries<any>({
      label: 'proxy-v21-instagram-with-proxy',
      executable: 'python3',
      scriptFileName: probeScriptPath,
      proxyPool: instagramPoolWithProxy,
      maxAttempts: 1,
      extraEnv: { MARKER_PATH: markerPath },
    });
    assert.equal(fs.existsSync(markerPath), true, 'child launch expected when proxy target exists');
    assert.match(String(launched.parsed.SCRAPER_PROXY_URL || ''), /127\.0\.0\.1:18080/);
    assert.equal(launched.parsed.SCRAPER_PROXY_FORCE_DIRECT, null);
    assert.equal(launched.parsed.SCRAPER_PROXY_DISABLE_SELF_ROTATION, '1');

    // 4) DDG remains fail-open by default.
    resetProxyEnv();
    const ddgPool = createScraperProxyPool(
      'ddg-search',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'ddg' }
    );
    const ddgDirect = await runScriptJsonWithRetries<any>({
      label: 'proxy-v21-ddg-fail-open',
      executable: 'python3',
      scriptFileName: probeScriptPath,
      proxyPool: ddgPool,
      maxAttempts: 1,
    });
    assert.equal(ddgDirect.parsed.SCRAPER_PROXY_URL, null);
    assert.equal(ddgDirect.parsed.SCRAPER_PROXY_FORCE_DIRECT, '1');
    assert.equal(ddgDirect.parsed.HTTP_PROXY, null);
    assert.equal(ddgDirect.parsed.HTTPS_PROXY, null);
    assert.equal(ddgDirect.parsed.ALL_PROXY, null);
    assert.equal(ddgDirect.parsed.http_proxy, null);
    assert.equal(ddgDirect.parsed.https_proxy, null);
    assert.equal(ddgDirect.parsed.all_proxy, null);

    // 4b) Child env isolation: inherited proxy envs must be cleared even with selected proxy target.
    resetProxyEnv();
    process.env.PROXY_POLICY_INSTAGRAM_ALLOW_DIRECT = 'false';
    process.env.SCRAPER_PROXY_URLS = 'http://127.0.0.1:19191';
    process.env.HTTP_PROXY = 'http://99.99.99.99:9999';
    process.env.HTTPS_PROXY = 'http://99.99.99.99:9999';
    process.env.ALL_PROXY = 'http://99.99.99.99:9999';
    const envIsolationPool = createScraperProxyPool(
      'instagram-env-isolation',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'instagram' }
    );
    const envIsolationRun = await runScriptJsonWithRetries<any>({
      label: 'proxy-v22-child-env-isolation',
      executable: 'python3',
      scriptFileName: probeScriptPath,
      proxyPool: envIsolationPool,
      maxAttempts: 1,
    });
    assert.match(String(envIsolationRun.parsed.SCRAPER_PROXY_URL || ''), /127\.0\.0\.1:19191/);
    assert.equal(envIsolationRun.parsed.HTTP_PROXY, null);
    assert.equal(envIsolationRun.parsed.HTTPS_PROXY, null);
    assert.equal(envIsolationRun.parsed.ALL_PROXY, null);
    assert.equal(envIsolationRun.parsed.http_proxy, null);
    assert.equal(envIsolationRun.parsed.https_proxy, null);
    assert.equal(envIsolationRun.parsed.all_proxy, null);

    // 4) Camoufox proxy helper wiring (with auth + force direct).
    const camoufoxInstagramPath = resolveBackendScript('camoufox_instagram_scraper.py');
    const camoufoxTikTokPath = resolveBackendScript('camoufox_tiktok_scraper.py');

    const instaProxy = pythonProxyConfigFromModule(camoufoxInstagramPath, {
      SCRAPER_PROXY_URL: 'http://user:pass@1.2.3.4:8080',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.equal(instaProxy.server, 'http://1.2.3.4:8080');
    assert.equal(instaProxy.username, 'user');
    assert.equal(instaProxy.password, 'pass');

    const instaDirect = pythonProxyConfigFromModule(camoufoxInstagramPath, {
      SCRAPER_PROXY_URL: 'http://user:pass@1.2.3.4:8080',
      SCRAPER_PROXY_FORCE_DIRECT: '1',
    });
    assert.equal(instaDirect, null);

    const tiktokProxy = pythonProxyConfigFromModule(camoufoxTikTokPath, {
      SCRAPER_PROXY_URL: '5.6.7.8:9090',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.equal(tiktokProxy.server, 'http://5.6.7.8:9090');
    assert.equal(tiktokProxy.username, undefined);
    assert.equal(tiktokProxy.password, undefined);

    const tiktokDirect = pythonProxyConfigFromModule(camoufoxTikTokPath, {
      SCRAPER_PROXY_URL: 'http://5.6.7.8:9090',
      SCRAPER_PROXY_FORCE_DIRECT: 'true',
    });
    assert.equal(tiktokDirect, null);

    const instaInvalidProxy = pythonProxyConfigErrorFromModule(camoufoxInstagramPath, {
      SCRAPER_PROXY_URL: 'http://:bad',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.match(instaInvalidProxy, /Invalid SCRAPER_PROXY_URL/i);

    const tiktokInvalidProxy = pythonProxyConfigErrorFromModule(camoufoxTikTokPath, {
      SCRAPER_PROXY_URL: 'http://:bad',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.match(tiktokInvalidProxy, /Invalid SCRAPER_PROXY_URL/i);

    // 5) Camoufox downloader proxy helper wiring (with auth + force direct).
    const camoufoxInstagramDownloaderPath = resolveBackendScript('camoufox_insta_downloader.py');
    const camoufoxTikTokDownloaderPath = resolveBackendScript('camoufox_tiktok_downloader.py');

    const instaDownloaderProxy = pythonProxyConfigFromModule(camoufoxInstagramDownloaderPath, {
      SCRAPER_PROXY_URL: 'http://user:pass@1.2.3.4:8080',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.equal(instaDownloaderProxy.server, 'http://1.2.3.4:8080');
    assert.equal(instaDownloaderProxy.username, 'user');
    assert.equal(instaDownloaderProxy.password, 'pass');

    const instaDownloaderDirect = pythonProxyConfigFromModule(camoufoxInstagramDownloaderPath, {
      SCRAPER_PROXY_URL: 'http://user:pass@1.2.3.4:8080',
      SCRAPER_PROXY_FORCE_DIRECT: '1',
    });
    assert.equal(instaDownloaderDirect, null);

    const tiktokDownloaderProxy = pythonProxyConfigFromModule(camoufoxTikTokDownloaderPath, {
      SCRAPER_PROXY_URL: '5.6.7.8:9090',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.equal(tiktokDownloaderProxy.server, 'http://5.6.7.8:9090');
    assert.equal(tiktokDownloaderProxy.username, undefined);
    assert.equal(tiktokDownloaderProxy.password, undefined);

    const tiktokDownloaderDirect = pythonProxyConfigFromModule(camoufoxTikTokDownloaderPath, {
      SCRAPER_PROXY_URL: 'http://5.6.7.8:9090',
      SCRAPER_PROXY_FORCE_DIRECT: 'true',
    });
    assert.equal(tiktokDownloaderDirect, null);

    const instaDownloaderInvalidProxy = pythonProxyConfigErrorFromModule(camoufoxInstagramDownloaderPath, {
      SCRAPER_PROXY_URL: 'http://:bad',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.match(instaDownloaderInvalidProxy, /Invalid SCRAPER_PROXY_URL/i);

    const tiktokDownloaderInvalidProxy = pythonProxyConfigErrorFromModule(camoufoxTikTokDownloaderPath, {
      SCRAPER_PROXY_URL: 'http://:bad',
      SCRAPER_PROXY_FORCE_DIRECT: undefined,
    });
    assert.match(tiktokDownloaderInvalidProxy, /Invalid SCRAPER_PROXY_URL/i);

    // 6) Shared TS proxy policy helper fail-fast and target injection.
    resetProxyEnv();
    process.env.PROXY_POLICY_INSTAGRAM_ALLOW_DIRECT = 'false';
    const helperFailFastPool = createScraperProxyPool(
      'instagram-helper-check',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'instagram' }
    );
    let helperOperationCalled = false;
    let helperFailFastError = '';
    try {
      await executeWithProxyPolicy({
        scope: 'instagram',
        label: 'proxy-v22-helper-failfast',
        proxyPool: helperFailFastPool,
        maxAttempts: 1,
        operation: async () => {
          helperOperationCalled = true;
          return true;
        },
      });
    } catch (error: any) {
      helperFailFastError = String(error?.message || error);
    }
    assert.equal(helperOperationCalled, false, 'shared helper must fail-fast before operation');
    assert.match(helperFailFastError, /fail-closed proxy policy blocked execution/i);

    resetProxyEnv();
    process.env.PROXY_POLICY_INSTAGRAM_ALLOW_DIRECT = 'false';
    process.env.SCRAPER_PROXY_URLS = 'http://127.0.0.1:19090';
    const helperProxyPool = createScraperProxyPool(
      'instagram-helper-check',
      ['SCRAPER_PROXY_URLS'],
      { policyScope: 'instagram' }
    );
    const helperProxy = await executeWithProxyPolicy({
      scope: 'instagram',
      label: 'proxy-v22-helper-with-proxy',
      proxyPool: helperProxyPool,
      maxAttempts: 1,
      operation: async ({ target }) => target.proxyUrl,
    });
    assert.match(String(helperProxy.value || ''), /127\.0\.0\.1:19090/);

    // 7) TikTok save path should surface fail-closed errors (no silent success).
    resetProxyEnv();
    process.env.PROXY_POLICY_TIKTOK_ALLOW_DIRECT = 'false';
    const { tiktokService } = await import('../services/scraper/tiktok-service');
    let tiktokSaveFailure = '';
    try {
      await tiktokService.scrapeAndSave('job-proxy-policy-test', 'proxy_policy_test_handle', 1);
    } catch (error: any) {
      tiktokSaveFailure = String(error?.message || error);
    }
    assert.match(tiktokSaveFailure, /fail-closed proxy policy blocked execution/i);

    console.log('Proxy V2.2 correctness checks passed.');
  } finally {
    restoreProxyEnv();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in test utility script
    }
  }
}

run().catch((error) => {
  restoreProxyEnv();
  console.error('Proxy V2.2 correctness checks failed:', error);
  process.exit(1);
});
